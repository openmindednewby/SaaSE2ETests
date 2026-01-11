import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Logout Flow @identity @auth', () => {
  let context: BrowserContext;
  let page: Page;

  async function openLogoutMenu() {
    const logoutButton = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON));
    if (await logoutButton.first().isVisible({ timeout: 300 }).catch(() => false)) return;

    // Prefer the MobileTopbar "Menu" button first (opens drawer that contains Logout),
    // because the left collapsed sidebar menu can open a different overlay.
    const candidates = [
      page.getByRole('button', { name: /^menu$/i }),
      page.getByRole('button', { name: /open menu/i }),
      page.locator(testIdSelector(TestIds.NAV_MENU)),
      page.getByRole('button', { name: /menu/i }),
      page.getByText(/^menu$/i),
    ];

    for (const candidate of candidates) {
      if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
        await candidate.click({ force: true });
        if (await logoutButton.first().isVisible({ timeout: 5000 }).catch(() => false)) return;
      }
    }
  }

  async function clickLogout() {
    const logoutApi = page
      .waitForResponse((r) => r.url().includes('/api/auth/logout') && r.request().method() === 'POST', { timeout: 8000 })
      .catch(() => null);

    const logoutButtons = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON));
    const initialCount = await logoutButtons.count().catch(() => 0);
    if (initialCount > 0) {
      for (let i = 0; i < initialCount; i++) {
        const candidate = logoutButtons.nth(i);
        if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) {
          await candidate.click({ force: true });
          await logoutApi;
          return;
        }
      }
    }

    // Some mobile layouts trigger logout from an icon-only sidebar without a visible "Logout" label.
    // Prefer our explicit testID first; if it's not visible, try common "open menu" affordances.
    await openLogoutMenu();
    const afterMenuCount = await logoutButtons.count().catch(() => 0);
    if (afterMenuCount > 0) {
      for (let i = 0; i < afterMenuCount; i++) {
        const candidate = logoutButtons.nth(i);
        if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
          await candidate.click({ force: true });
          await logoutApi;
          return;
        }
      }
    }

    // Fallback to role-based selector if testID isn't present
    const logoutByRole = page.getByRole('button', { name: /logout|sign out/i }).first();
    await expect(logoutByRole, 'Expected logout button to exist in authenticated UI').toBeVisible({ timeout: 5000 });
    await logoutByRole.click({ force: true });
    await logoutApi;
  }

  async function expectLoggedOut() {
    // Wait for logout to propagate to storage/UI
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const raw = sessionStorage.getItem('persist:auth');
          const accessTokenKey = sessionStorage.getItem('accessToken');
          const refreshTokenKey = sessionStorage.getItem('refreshToken');
          let parsed: any = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { _parseError: true };
            }
          }

          const tokenFromPersist = parsed?.accessToken ?? null;
          const isLoggedIn = parsed?.isLoggedIn ?? null;

          const loggedOut =
            (!raw || !tokenFromPersist) &&
            !accessTokenKey &&
            !refreshTokenKey;

          return { loggedOut, rawPresent: !!raw, tokenFromPersist, isLoggedIn, accessTokenKey, refreshTokenKey };
        });
      }, { timeout: 20000 })
      .toMatchObject({ loggedOut: true });

    // Depending on navigation strategy, URL may or may not change; login form should be visible either way.
    const loginForm = page.locator(testIdSelector(TestIds.LOGIN_FORM));
    await expect(loginForm).toBeVisible({ timeout: 10000 });
  }

  test.beforeAll(async ({ browser }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      throw new Error('TEST_USER_USERNAME or TEST_USER_PASSWORD not set');
    }

    // Create a new browser context for this test suite
    context = await browser.newContext();
    page = await context.newPage();

    // Login once for all tests in this suite
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should logout successfully @critical', async () => {
    // Start on protected route (using authenticated state)
    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    await clickLogout();
    await expectLoggedOut();
  });

  test('should clear session after logout', async () => {
    // Login again for this test (since previous test logged out)
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    await clickLogout();
    await expectLoggedOut();

    // Verify session is cleared
    const persisted = await page.evaluate(() => sessionStorage.getItem('persist:auth'));
    if (persisted) {
      const parsed = JSON.parse(persisted);
      expect(parsed.accessToken).toBeFalsy();
      expect(parsed.refreshToken).toBeFalsy();
      expect(parsed.isLoggedIn).toBeFalsy();
    } else {
      // Storage key removed is also a valid "cleared session" state.
      expect(persisted).toBeNull();
    }
  });

  test('should redirect to login when accessing protected route after logout', async () => {
    // Login again for this test
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    // Clear auth manually to simulate logout
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem('userProfile');
      localStorage.removeItem('persist:auth');
    });

    // Refresh the page
    await page.reload();

    // Should redirect to login
    await expect(page).toHaveURL(/login/i, { timeout: 10000 });
  });
});
