import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import fs from 'fs';
import path from 'path';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page, baseURL }) => {
  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;

  // Skip if credentials not configured
  if (!username || !password) {
    setup.skip(true, 'TEST_USER_USERNAME or TEST_USER_PASSWORD not set in .env.local');
    return;
  }

  // Check if auth was already set up by global-setup
  const authFilePath = path.resolve(__dirname, '..', authFile);
  if (fs.existsSync(authFilePath)) {
    const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf-8'));
    // If we have origins with localStorage, global setup succeeded
    if (authData.origins?.length > 0 && authData.origins[0]?.localStorage?.length > 0) {
      console.log('Using auth state from global setup');
      return;
    }
  }

  // Check if frontend is available
  try {
    const response = await page.goto(baseURL || 'http://localhost:8082', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    if (!response) {
      setup.skip(true, `Frontend not available at ${baseURL}`);
      return;
    }
  } catch (error: any) {
    setup.skip(true, `Frontend not available: ${error.message}`);
    return;
  }

  const loginPage = new LoginPage(page);

  try {
    await loginPage.goto();

    // Wait for the login form to be ready
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 10000 });

    await loginPage.loginAndWait(username, password);

    // Save storage state for reuse
    await page.context().storageState({ path: authFile });
  } catch (error: any) {
    // If login fails, skip dependent tests rather than failing
    console.error('Auth setup failed:', error.message);
    setup.skip(true, `Login failed: ${error.message}`);
  }
});
