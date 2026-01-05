import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { AuthHelper } from '../helpers/auth-helper.js';

// Extend base test with authentication utilities
export const test = base.extend<{
  loginPage: LoginPage;
  authHelper: AuthHelper;
}>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  authHelper: async ({}, use) => {
    const authHelper = new AuthHelper();
    await use(authHelper);
  },
});

export { expect };
