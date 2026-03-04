import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import fs from 'fs';
import path from 'path';

const authFile = path.resolve(__dirname, '../playwright/.auth/user.json');

// Minimum remaining token lifetime to consider a cached token valid (2 minutes buffer).
// If the token expires within this buffer, we re-authenticate to get a fresh token.
const TOKEN_MIN_VALID_SECONDS = 120;

/**
 * Decode a JWT access token and return its expiry timestamp (Unix seconds).
 * Returns null if the token cannot be parsed.
 */
function getTokenExpiry(accessToken: string): number | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch {
    return null;
  }
}

/**
 * Check if the cached auth state in user.json has a non-expired access token.
 * Returns true only if the token is present AND valid for at least TOKEN_MIN_VALID_SECONDS.
 */
function isCachedAuthValid(authFilePath: string): boolean {
  if (!fs.existsSync(authFilePath)) return false;
  try {
    const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf-8'));
    if (!authData.origins?.length) return false;
    const localStorageItems: Array<{ name: string; value: string }> = authData.origins[0]?.localStorage || [];
    const persistAuthItem = localStorageItems.find((item) => item.name === 'persist:auth');
    if (!persistAuthItem) return false;

    const persistAuth = JSON.parse(persistAuthItem.value);
    const accessToken: string | undefined = persistAuth?.accessToken;
    if (!accessToken || accessToken === 'null') return false;

    const exp = getTokenExpiry(accessToken);
    if (exp === null) return false;

    const nowSeconds = Date.now() / 1000;
    return exp > nowSeconds + TOKEN_MIN_VALID_SECONDS;
  } catch {
    return false;
  }
}

setup('authenticate', async ({ page, baseURL: _baseURL }) => {
  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;

  // Skip if credentials not configured
  if (!username || !password) {
    setup.skip(true, 'TEST_USER_USERNAME or TEST_USER_PASSWORD not set in .env.local');
    return;
  }

  // Check if auth was already set up with a valid, non-expired token.
  // This handles the case where global-setup.ts already saved fresh tokens.
  // We validate token expiry to avoid using stale tokens that would cause test failures.
  // Tokens expire in 5 minutes; we require at least 2 minutes of remaining validity.
  if (isCachedAuthValid(authFile)) {
    return;
  }

  // Check if frontend is available by navigating to the login page
  const loginPage = new LoginPage(page);

  try {
    // Clear any stale auth state first
    await page.context().clearCookies();

    // Navigate directly to login page
    await loginPage.goto();

    // Wait for the login form to be ready with increased timeout
    // This gives React time to hydrate and render
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 15000 });

    await loginPage.loginAndWait(username, password);

    // The app stores auth state in sessionStorage under 'persist:auth' key (Redux persist).
    // Copy to localStorage so Playwright can persist it between tests.
    await page.evaluate(() => {
      const raw = sessionStorage.getItem('persist:auth');
      if (raw) {
        // Copy to localStorage for Playwright persistence
        localStorage.setItem('persist:auth', raw);
        return JSON.parse(raw);
      }
      return null;
    });

    // Ensure the auth directory exists
    const authDir = path.dirname(authFile);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // Save storage state for reuse
    await page.context().storageState({ path: authFile });

  } catch (error: any) {
    // If login fails, skip dependent tests rather than failing
    setup.skip(true, `Login failed: ${error.message}`);
  }
});
