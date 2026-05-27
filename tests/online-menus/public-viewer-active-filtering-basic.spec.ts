import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { TestIds, testIdSelector, testIdStartsWithSelector } from '../../shared/testIds.js';
import { paymentsConfigured, PAYMENTS_SKIP_REASON } from '../../helpers/feature-gates.js';

/**
 * E2E Tests for Public Menu Viewer Active Filtering - Basic Visibility
 *
 * Tests that the public menu list only shows active menus and that
 * deactivated menus are immediately hidden from public users.
 *
 * Re-enabled 2026-05-27. The original failure (was @known-bug-multicreate-3)
 * was that the lead test creates TWO menus (active + inactive) while the
 * free plan caps tenants at 1 menu. Now gated on paymentsConfigured() in
 * beforeAll the same way the other multi-menu suites are.
 */
test.describe.serial('Public Viewer Active Filtering - Basic @online-menus @public-viewer @critical', () => {
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let activeMenuName: string;
  let inactiveMenuName: string;
  let publicPage: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    // Gate the entire describe on payments being configured. This suite needs
    // two menus to exist concurrently (active + inactive) and the free plan
    // caps tenants at 1 menu. test.skip() inside beforeAll marks every test in
    // the describe as skipped, which is the cleanest way to communicate the
    // intent without leaving the suite reporting failures.
    test.skip(!paymentsConfigured(), PAYMENTS_SKIP_REASON);

    test.setTimeout(120000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();

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

    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    menusPage = new OnlineMenusPage(page);

    // Clean slate: drop any menus left by an earlier chunk (free-tier 2-menu cap).

    await menusPage.deleteAllMenus();

    publicPage = await context.newPage();
    await publicPage.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth')) {
          sessionStorage.setItem('persist:auth', persistAuth);
        }
      } catch {
        // ignore
      }
    });

    const publicLoginPage = new LoginPage(publicPage);
    await publicLoginPage.goto();
    await publicLoginPage.loginAndWait(adminUser.username, adminUser.password);

    await publicPage.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });
  });

  test.beforeEach(async () => {
    test.setTimeout(90000);
    await menusPage.goto();
  });

  test.afterAll(async () => {
    test.setTimeout(120000); // Firefox cleanup can be slow under concurrency
    try {
      await menusPage.goto();
      await menusPage.deactivateAllMenus();

      for (const menuName of [activeMenuName, inactiveMenuName]) {
        if (menuName && await menusPage.menuExists(menuName)) {
          await menusPage.deleteMenu(menuName, false);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    await publicPage?.close().catch(() => {});
    await context?.close();
  });

  test('should create test menus with different activation states', async () => {
    // Re-enabled 2026-05-27 (was @known-bug-multicreate-3). Whole describe is
    // now gated on paymentsConfigured() in beforeAll for the free-tier cap.
    activeMenuName = `Active Public Menu ${Date.now()}`;
    inactiveMenuName = `Inactive Public Menu ${Date.now() + 1}`;

    await menusPage.deactivateAllMenus();

    await menusPage.createMenu(activeMenuName, 'This menu will be active and visible to public');
    await menusPage.expectMenuInList(activeMenuName);

    await menusPage.createMenu(inactiveMenuName, 'This menu will be inactive and hidden from public');
    await menusPage.expectMenuInList(inactiveMenuName);

    await menusPage.expectMenuActive(activeMenuName, false);
    await menusPage.expectMenuActive(inactiveMenuName, false);
  });

  test('should activate only one menu', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    await menusPage.activateMenu(activeMenuName);
    await menusPage.expectMenuActive(activeMenuName, true);

    await menusPage.expectMenuActive(inactiveMenuName, false);
  });

  test('should show only active menu in public menu list @critical', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    await publicPage.goto('/public/menus');

    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    await expect(publicMenuList).toBeVisible({ timeout: 10000 });

    const loadingIndicator = publicPage.locator('[role="progressbar"]');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const activeMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: activeMenuName,
    });
    await expect(activeMenuCard).toBeVisible({ timeout: 5000 });

    const inactiveMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: inactiveMenuName,
    });
    await expect(inactiveMenuCard).not.toBeVisible({ timeout: 5000 });
  });

  test('should hide menu from public list immediately after deactivation', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();

    await menusPage.expectMenuActive(activeMenuName, true);

    await menusPage.deactivateMenu(activeMenuName);
    await menusPage.expectMenuActive(activeMenuName, false);

    await publicPage.goto('/public/menus');

    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    await expect(publicMenuList).toBeVisible({ timeout: 10000 });

    const loadingIndicator = publicPage.locator('[role="progressbar"]');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const deactivatedMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: activeMenuName,
    });
    await expect(deactivatedMenuCard).not.toBeVisible({ timeout: 5000 });

    const inactiveMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: inactiveMenuName,
    });
    await expect(inactiveMenuCard).not.toBeVisible({ timeout: 5000 });
  });
});
