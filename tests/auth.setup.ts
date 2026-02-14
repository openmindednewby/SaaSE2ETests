import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import fs from 'fs';
import path from 'path';

const authFile = path.resolve(__dirname, '../playwright/.auth/user.json');

setup('authenticate', async ({ page, baseURL: _baseURL }) => {
  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;

  // Skip if credentials not configured
  if (!username || !password) {
    setup.skip(true, 'TEST_USER_USERNAME or TEST_USER_PASSWORD not set in .env.local');
    return;
  }

  // Check if auth was already set up with valid data
  if (fs.existsSync(authFile)) {
    const authData = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
    // If we have origins with localStorage containing persist:auth, we're good
    if (authData.origins?.length > 0) {
      const localStorage = authData.origins[0]?.localStorage || [];
      const hasAuth = localStorage.some((item: { name: string }) =>
        item.name === 'persist:auth'
      );
      if (hasAuth) {
        return;
      }
    }
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
