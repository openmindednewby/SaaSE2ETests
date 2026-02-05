import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { AuthHelper } from '../helpers/auth-helper.js';

/**
 * Copy auth state from localStorage to sessionStorage.
 * This is needed because:
 * - The app stores auth state in sessionStorage under 'persist:auth' (Redux persist format)
 * - Playwright's storageState only persists localStorage
 * - We save tokens to localStorage in global-setup.ts
 * - Tests need tokens in sessionStorage to work
 */
async function restoreAuthToSessionStorage(page: Page) {
  await page.addInitScript(() => {
    try {
      // Copy the persist:auth key (Redux persist format) - this is the PRIMARY auth storage
      const persistAuth = localStorage.getItem('persist:auth');
      if (persistAuth && !sessionStorage.getItem('persist:auth')) {
        sessionStorage.setItem('persist:auth', persistAuth);
      }

      // Also copy individual tokens for backwards compatibility
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      if (accessToken && !sessionStorage.getItem('accessToken')) {
        sessionStorage.setItem('accessToken', accessToken);
      }
      if (refreshToken && !sessionStorage.getItem('refreshToken')) {
        sessionStorage.setItem('refreshToken', refreshToken);
      }
    } catch (e) {
      // Silently ignore errors in init script
    }
  });
}

// Extend base test with authentication utilities
export const test = base.extend<{
  loginPage: LoginPage;
  authHelper: AuthHelper;
  authenticatedPage: Page;
}>({
  // Override the default page fixture to automatically restore auth state
  // This ensures ALL tests get auth restored from localStorage to sessionStorage
  page: async ({ page }, use) => {
    await restoreAuthToSessionStorage(page);
    await use(page);
  },

  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  authHelper: async ({}, use) => {
    const authHelper = new AuthHelper();
    await use(authHelper);
  },

  // Authenticated page fixture - kept for backwards compatibility
  // Now equivalent to the default page fixture
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },
});

export { expect };
