import { chromium, FullConfig } from '@playwright/test';
import { AuthHelper } from '../helpers/auth-helper.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

/**
 * Check if a service is available by making a simple request
 */
async function isServiceAvailable(url: string): Promise<boolean> {
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
    // Login via API to get tokens
    const authHelper = new AuthHelper();
    const tokens = await authHelper.loginViaAPI(username, password);

    console.log('✅ API authentication successful');

    // Check if frontend is available
    console.log(`🔍 Checking frontend at ${baseURL}...`);
    const frontendAvailable = await isServiceAvailable(baseURL);

    if (!frontendAvailable) {
      console.warn(`\n⚠️  Warning: Frontend is not available at ${baseURL}`);
      console.warn('   Make sure the frontend is running:');
      console.warn('   cd C:\\desktopContents\\projects\\SaaS\\OnlineMenuSaaS\\clients\\OnlineMenuClientApp');
      console.warn('   npm run start:dev\n');

      // Still save the tokens for API-based tests
      fs.writeFileSync(authFile, JSON.stringify({
        cookies: [],
        origins: [{
          origin: baseURL,
          localStorage: [
            { name: 'userProfile', value: JSON.stringify(tokens.userInfo) }
          ]
        }]
      }));
      return;
    }

    console.log('✅ Frontend is available');

    // Launch browser to set storage state
    const browser = await chromium.launch();
    const context = await browser.newContext();
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
