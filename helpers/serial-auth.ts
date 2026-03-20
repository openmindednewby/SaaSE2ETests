/**
 * Shared authentication setup for serial test suites.
 *
 * Serial test suites (`test.describe.serial`) manage their own BrowserContext
 * and Page in `beforeAll` / `afterAll`.  Every billing, tenant-themes, and
 * similar suite needs the same boilerplate:
 *
 *   1. Create a new context + page
 *   2. Register an `addInitScript` that copies `persist:auth` from
 *      localStorage to sessionStorage (so Redux-persist picks it up)
 *   3. Log in through the UI via `LoginPage`
 *   4. Persist the auth tokens back to localStorage for subsequent navigations
 *
 * This helper extracts that pattern into a single reusable function.
 */

import { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';

import { getProjectUsers } from '../fixtures/test-data.js';
import { LoginPage } from '../pages/LoginPage.js';

export interface AuthenticatedContext {
  context: BrowserContext;
  page: Page;
}

/**
 * Create a new BrowserContext + Page, authenticate through the login UI,
 * and persist auth tokens for later navigations.
 *
 * @param browser  Playwright `Browser` instance (from the `{ browser }` fixture)
 * @param testInfo Playwright `TestInfo` (used to resolve per-project user credentials)
 * @returns An authenticated `{ context, page }` pair.  The caller is responsible
 *          for closing the context in `afterAll`.
 */
export async function createAuthenticatedContext(
  browser: Browser,
  testInfo: TestInfo,
): Promise<AuthenticatedContext> {
  const { admin: adminUser } = getProjectUsers(testInfo.project.name);

  const context = await browser.newContext();
  const page = await context.newPage();

  // Before any navigation, copy persist:auth from localStorage to
  // sessionStorage so the app picks up Redux-persisted auth state.
  await page.addInitScript(() => {
    try {
      const persistAuth = localStorage.getItem('persist:auth');
      if (persistAuth && !sessionStorage.getItem('persist:auth')) {
        sessionStorage.setItem('persist:auth', persistAuth);
      }
    } catch {
      // ignore
    }
  });

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.loginAndWait(adminUser.username, adminUser.password);

  // After successful login, persist tokens from sessionStorage back to
  // localStorage so that subsequent page.goto() calls (which trigger the
  // addInitScript above) can restore them.
  await page.evaluate(() => {
    const persistAuth = sessionStorage.getItem('persist:auth');
    if (persistAuth) {
      localStorage.setItem('persist:auth', persistAuth);
    }
  });

  return { context, page };
}
