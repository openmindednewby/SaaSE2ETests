import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { AuthHelper } from '../helpers/auth-helper.js';

/**
 * Copy auth tokens from localStorage to sessionStorage.
 * This is needed because:
 * - The app stores tokens in sessionStorage
 * - Playwright's storageState only persists localStorage
 * - We save tokens to localStorage in auth.setup.ts
 * - Tests need tokens in sessionStorage to work
 */
async function restoreAuthToSessionStorage(page: Page) {
  await page.addInitScript(() => {
    // When the page loads, copy tokens from localStorage to sessionStorage
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    if (accessToken) sessionStorage.setItem('accessToken', accessToken);
    if (refreshToken) sessionStorage.setItem('refreshToken', refreshToken);
  });
}

// Extend base test with authentication utilities
export const test = base.extend<{
  loginPage: LoginPage;
  authHelper: AuthHelper;
  authenticatedPage: Page;
}>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  authHelper: async ({}, use) => {
    const authHelper = new AuthHelper();
    await use(authHelper);
  },

  // Authenticated page fixture - restores auth tokens before each test
  authenticatedPage: async ({ page }, use) => {
    await restoreAuthToSessionStorage(page);
    await use(page);
  },
});

export { expect };
