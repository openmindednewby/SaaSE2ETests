import { chromium, FullConfig } from '@playwright/test';
import { AuthHelper } from '../helpers/auth-helper.js';
import path from 'path';
import fs from 'fs';
import * as https from 'node:https';
import { loadE2EEnv } from './env-loader.js';
import { installHostOverride } from './host-override.js';
import { isIgnoreHttpsErrors } from '../helpers/http-agent.js';

// Load environment variables (target picked via E2E_TARGET env var, default 'local')
loadE2EEnv();

// Install Node-side DNS override if E2E_HOST_OVERRIDE_IP is set. Must run
// BEFORE any HTTP traffic so axios / APIRequestContext / fetch all see the
// patched lookup. No-op when the env var is unset (local / prod targets).
installHostOverride();

/**
 * Check if a service is available by making a simple request.
 *
 * When `E2E_IGNORE_HTTPS_ERRORS` is true OR `E2E_HOST_OVERRIDE_IP` is set
 * (typically `E2E_TARGET=staging` against Traefik's self-signed default cert),
 * we use a one-off https.request fall-back that disables cert verification.
 * Undici/fetch doesn't expose a per-call cert-trust knob without pulling in
 * `undici` as a direct dep, and `NODE_TLS_REJECT_UNAUTHORIZED=0` is too broad.
 */
async function isServiceAvailable(url: string): Promise<boolean> {
  if (isIgnoreHttpsErrors() && url.startsWith('https://')) {
    return isHttpsServiceAvailableIgnoreCert(url);
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function isHttpsServiceAvailableIgnoreCert(url: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    try {
      const parsed = new URL(url);
      const req = https.request(
        {
          host: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          rejectUnauthorized: false,
          timeout: 5000,
        },
        res => {
          resolve((res.statusCode ?? 500) < 500);
          res.resume();
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || process.env.BASE_URL || 'http://localhost:8082';
  const identityApiUrl = process.env.IDENTITY_API_URL || 'http://localhost:5002';

  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;

  // Ensure auth directory exists
  const authDir = path.resolve(__dirname, '../playwright/.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Create empty auth file if it doesn't exist (allows tests to run without auth)
  const authFile = path.join(authDir, 'user.json');
  if (!fs.existsSync(authFile)) {
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
  }

  if (!username || !password) {
    console.warn('\n⚠️  Warning: TEST_USER_USERNAME or TEST_USER_PASSWORD not set.');
    console.warn('   Tests requiring authentication will be skipped.');
    console.warn('   Set credentials in .env.local to enable auth tests.\n');
    return;
  }

  // Check if IdentityService is available
  console.log(`\n🔍 Checking IdentityService at ${identityApiUrl}...`);
  const identityAvailable = await isServiceAvailable(identityApiUrl);

  if (!identityAvailable) {
    console.warn(`\n⚠️  Warning: IdentityService is not available at ${identityApiUrl}`);
    console.warn('   Make sure the IdentityService is running:');
    console.warn('   cd C:\\desktopContents\\projects\\SaaS\\IdentityService');
    console.warn('   docker-compose up');
    console.warn('\n   Tests requiring authentication will be skipped.\n');
    return;
  }

  console.log('✅ IdentityService is available');
  console.log('🔐 Authenticating test user...');

  try {
    // KI-2 fix: reuse the canary-minted superUser token when present.
    // global-setup.canary.ts runs BEFORE this and stashes the token in
    // E2E_CANARY_ACCESS_TOKEN/_REFRESH_TOKEN — doing a second /auth/login
    // here would be the same superUser hitting identity-api's per-user rate
    // limiter twice in the first few seconds of a run, which is exactly the
    // pattern that produced the intermittent 429s on staging.
    const cachedAccess = process.env.E2E_CANARY_ACCESS_TOKEN;
    const cachedRefresh = process.env.E2E_CANARY_REFRESH_TOKEN;

    let tokens: { accessToken: string | null; refreshToken: string | null; userInfo: unknown | null };
    if (cachedAccess && cachedAccess.length > 0) {
      tokens = {
        accessToken: cachedAccess,
        refreshToken: cachedRefresh && cachedRefresh.length > 0 ? cachedRefresh : null,
        // userInfo is best-effort: the storage state accepts null. The app
        // re-hydrates from /me once a token is present so a missing userInfo
        // on disk is invisible to the test.
        userInfo: null,
      };
      console.log('✅ Reusing canary-minted superUser token (no fresh /auth/login)');
    } else {
      const authHelper = new AuthHelper();
      const fresh = await authHelper.loginViaAPI(username, password);
      tokens = { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, userInfo: fresh.userInfo };
      console.log('✅ API authentication successful');
    }

    // Check if frontend is available
    console.log(`🔍 Checking frontend at ${baseURL}...`);
    const frontendAvailable = await isServiceAvailable(baseURL);

    if (!frontendAvailable) {
      console.warn(`\n⚠️  Warning: Frontend is not available at ${baseURL}`);
      console.warn('   Make sure the frontend is running:');
      console.warn('   cd C:\\desktopContents\\projects\\SaaS\\OnlineMenuSaaS\\clients\\OnlineMenuClientApp');
      console.warn('   npm run start:dev\n');

      // Save tokens for API-based tests (include persist:auth so auth.setup.ts can skip)
      const authState = {
        accessToken: tokens.accessToken || null,
        refreshToken: tokens.refreshToken || null,
        isLoggedIn: Boolean(tokens.accessToken),
        user: tokens.userInfo || null,
        userInfo: tokens.userInfo || null,
        loading: false,
        refreshingUserInfo: false,
      };
      fs.writeFileSync(authFile, JSON.stringify({
        cookies: [],
        origins: [{
          origin: baseURL,
          localStorage: [
            { name: 'persist:auth', value: JSON.stringify(authState) },
            { name: 'userProfile', value: JSON.stringify(tokens.userInfo) }
          ]
        }]
      }));
      return;
    }

    console.log('✅ Frontend is available');

    // Launch browser to set storage state. When targeting an environment with
    // a self-signed cert (staging) the browser context must trust it too —
    // playwright.config.ts sets ignoreHTTPSErrors at the test fixture level
    // but globalSetup's own context lives outside that.
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // Navigate to the app
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Set tokens in storage matching the app's Redux persist pattern
    // The app stores auth state in sessionStorage under 'persist:auth' key
    await page.evaluate((tokenData) => {
      // Create the auth state object matching Redux persist format
      const authState = {
        accessToken: tokenData.accessToken || null,
        refreshToken: tokenData.refreshToken || null,
        isLoggedIn: Boolean(tokenData.accessToken),
        user: tokenData.userInfo || null,
        userInfo: tokenData.userInfo || null,
        loading: false,
        refreshingUserInfo: false,
      };

      // Store in sessionStorage as persist:auth (primary auth storage)
      sessionStorage.setItem('persist:auth', JSON.stringify(authState));

      // Also store individual tokens for backwards compatibility
      sessionStorage.setItem('accessToken', tokenData.accessToken || '');
      sessionStorage.setItem('refreshToken', tokenData.refreshToken || '');

      // Copy to localStorage for Playwright persistence across tests
      localStorage.setItem('persist:auth', JSON.stringify(authState));
      if (tokenData.userInfo) {
        localStorage.setItem('userProfile', JSON.stringify(tokenData.userInfo));
      }
    }, tokens);

    // Save storage state for reuse in tests
    await context.storageState({ path: authFile });

    await browser.close();
    console.log('✅ Global setup complete - authentication state saved\n');
  } catch (error: any) {
    const errorMessage = error?.message || String(error);

    if (errorMessage.includes('ECONNREFUSED')) {
      console.error(`\n❌ Connection refused. Services are not running.`);
      console.error('   Start the required services and try again.\n');
    } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error(`\n❌ Authentication failed. Check your credentials in .env.local`);
      console.error(`   Username: ${username}`);
      console.error('   Password: ********\n');
    } else {
      console.error('\n❌ Global setup failed:', errorMessage, '\n');
    }

    // Don't throw - allow tests to run (they'll skip if auth is required)
  }
}

export default globalSetup;
