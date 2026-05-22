import { test, expect } from '../../fixtures/index.js';
import type { Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';
import { firefoxCannotReachStaging, FIREFOX_STAGING_SKIP_REASON } from '../../helpers/target.js';
import { readPersistAuthTokensCleared } from '../../helpers/auth-storage.js';

// Use serial mode so tests run in order and share the same browser context.
test.describe.serial('Logout Flow @identity @auth', () => {
  let context: BrowserContext;
  let page: Page;

  // Firefox UI traffic can't reach the staging frontend (see helper docs).
  test.skip(({ browserName }) => firefoxCannotReachStaging(browserName), FIREFOX_STAGING_SKIP_REASON);

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
      .waitForResponse((r) => r.url().includes('/api/v1/auth/logout') && r.request().method() === 'POST', { timeout: 8000 })
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

          // Logged out if persist:auth is gone, OR its token is cleared, OR
          // isLoggedIn is false, OR both direct token keys are empty.
          const tokenIsFalsy = !tokenFromPersist || tokenFromPersist === 'null' || tokenFromPersist === '';
          const isLoggedInFalsy = isLoggedIn === false || isLoggedIn === 'false' || isLoggedIn === null || isLoggedIn === 'null';
          const accessKeyIsFalsy = !accessTokenKey || accessTokenKey === '';
          const refreshKeyIsFalsy = !refreshTokenKey || refreshTokenKey === '';

          const loggedOut =
            !raw ||
            tokenIsFalsy ||
            isLoggedInFalsy ||
            (accessKeyIsFalsy && refreshKeyIsFalsy);

          return { loggedOut, rawPresent: !!raw, tokenFromPersist, isLoggedIn, accessTokenKey, refreshTokenKey };
        });
      }, { timeout: 20000 })
      .toMatchObject({ loggedOut: true });

    // Wait for redirect to login page
    await Promise.race([
      expect(page).toHaveURL(/login/i, { timeout: 15000 }).catch(() => {}),
      expect(page.locator(testIdSelector(TestIds.LOGIN_FORM))).toBeVisible({ timeout: 15000 }).catch(() => {}),
    ]);
    // If still on a protected route, force refresh to trigger auth redirect
    const currentUrl = page.url();
    if (!currentUrl.includes('login')) {
      // eslint-disable-next-line no-page-reload/no-page-reload -- Testing that auth state clears after browser refresh
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/login/i, { timeout: 10000 });
    }

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

    // Restore auth from localStorage to sessionStorage on each load — page.goto()
    // causes a full reload and sessionStorage starts empty.
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

    // Clear any stale state, then log in once for all tests in this suite.
    await page.context().clearCookies();
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 15000 });

    await loginPage.loginAndWait(username, password);

    // Save auth state to localStorage so it persists across page navigations
    // The init script will copy it back to sessionStorage on each page load
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should logout successfully @critical', async () => {
    // Start on protected route (using authenticated state)
    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    // Wait for React to hydrate: desktop shows the logout button directly;
    // mobile hides it in the MobileTopbar drawer behind a "Menu" button.
    const logoutButton = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON)).first();
    const menuButton = page.locator(testIdSelector(TestIds.NAV_MENU));
    await expect(logoutButton.or(menuButton)).toBeVisible({ timeout: 15000 });

    await clickLogout();
    await expectLoggedOut();
  });

  test('should clear session after logout', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    // Clear stale localStorage from beforeAll so init script does not restore old tokens
    await page.evaluate(() => {
      localStorage.removeItem('persist:auth');
      sessionStorage.clear();
    });

    // Re-login after previous test's logout
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 15000 });
    await loginPage.loginAndWait(username, password);

    // Persist new auth state so the init script can restore it across navigations
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    // Navigate to protected route and wait for logout button or menu button (mobile)
    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });
    const logoutButton = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON)).first();
    const menuButton = page.locator(testIdSelector(TestIds.NAV_MENU));
    await expect(logoutButton.or(menuButton)).toBeVisible({ timeout: 15000 });

    await clickLogout();
    await expectLoggedOut();

    // Verify session storage settles into a tokens-cleared terminal state.
    // BaseClient's logout cleanup re-dispatches the auth-clear action on a
    // staggered timer schedule (0/50/200/500/1000ms) and the Redux persistence
    // subscriber re-writes `persist:auth` on each dispatch — so a single
    // non-polled snapshot races that schedule. Poll until storage settles.
    await expect.poll(() => readPersistAuthTokensCleared(page), { timeout: 10000 }).toBe(true);
  });

  test('should redirect to login when accessing protected route after logout', async () => {
    // Retired (2026-05-22): this test "logs out" by clearing browser storage
    // (sessionStorage + localStorage `persist:auth`). That is only a valid
    // logout simulation for the legacy token-in-storage BaseClient SPA. The
    // retargeted apps are BFF-fronted — the session is an httpOnly
    // `__Host-bff-*` cookie that JavaScript cannot clear, so clearing storage
    // does NOT end the session and the SPA stays authenticated. Real BFF
    // logout (the logout button → `/bff/logout`) is covered by the other tests
    // in this file and by tests/*/bff-no-token-in-browser.spec.ts.
    test.skip(true, 'BaseClient-era storage-clear logout simulation — invalid for BFF apps; real logout covered by the logout-button tests above + bff-no-token-in-browser.');

    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    // Clear stale storage from previous test's logout
    await page.evaluate(() => {
      localStorage.removeItem('persist:auth');
      sessionStorage.clear();
    });

    // Re-login
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 15000 });
    await loginPage.loginAndWait(username, password);

    // Navigate to protected route and confirm we are authenticated
    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/quiz-templates/, { timeout: 10000 });

    // Simulate auth expiry by clearing all auth state
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem('persist:auth');
      localStorage.removeItem('userProfile');
    });

    // eslint-disable-next-line no-page-reload/no-page-reload -- Testing that auth state clears after browser refresh
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Verify redirect to login page
    await Promise.race([
      expect(page).toHaveURL(/login/i, { timeout: 15000 }),
      expect(page.locator(testIdSelector(TestIds.LOGIN_FORM))).toBeVisible({ timeout: 15000 }),
    ]);
  });
});
