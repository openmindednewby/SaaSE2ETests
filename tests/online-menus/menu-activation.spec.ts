import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Online Menu Activation/Deactivation
 *
 * Tests the new Phase 1 backend features:
 * - PATCH /TenantMenus/{id}/activate endpoint
 * - PATCH /TenantMenus/{id}/deactivate endpoint
 * - isActive field on menus
 */
test.describe.serial('Menu Activation and Deactivation @online-menus @crud', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Create a new browser context for this test suite
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
    // This ensures auth persists across page navigations
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

    // Login as tenant admin
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    // Save auth state to localStorage so it persists across page navigations
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    // Initialize page objects
    menusPage = new OnlineMenusPage(page);
  });

  test.beforeEach(async () => {
    await menusPage.goto();
  });

  async function ensureNoActiveMenus() {
    await menusPage.deactivateAllMenus();
    await menusPage.refetchMenusList();
  }

  test.afterAll(async () => {
    // Cleanup - deactivate first if active, then delete
    try {
      await menusPage.goto();
      await menusPage.deactivateAllMenus();
      if (testMenuName && await menusPage.menuExists(testMenuName)) {
        await menusPage.deleteMenu(testMenuName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create menu for activation tests', async () => {
    testMenuName = `Activation Test Menu ${Date.now()}`;
    await menusPage.goto();
    await ensureNoActiveMenus();
    await menusPage.createMenu(testMenuName, 'Menu for testing activation/deactivation');
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should activate a menu @critical', async () => {
    expect(testMenuName, 'Test menu name not set; did the create test run?').toBeTruthy();
    await menusPage.expectMenuInList(testMenuName);

    // Ensure starting from clean state
    await ensureNoActiveMenus();

    // Activate the menu
    const activated = await menusPage.activateMenu(testMenuName);
    expect(activated, 'Menu activation should succeed').toBe(true);

    // Verify it shows as active
    await menusPage.expectMenuActive(testMenuName, true);
  });

  test('should show correct status badge when active', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Menu should already be active from previous test
    await menusPage.expectMenuActive(testMenuName, true);

    // Verify status text contains "active"
    const status = await menusPage.getMenuStatus(testMenuName);
    expect(status.toLowerCase()).toContain('active');
  });

  test('should deactivate an active menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Menu should already be active from previous test
    await menusPage.expectMenuActive(testMenuName, true);

    // Deactivate the menu
    const deactivated = await menusPage.deactivateMenu(testMenuName);
    expect(deactivated, 'Menu deactivation should succeed').toBe(true);

    // Verify it shows as inactive
    await menusPage.expectMenuActive(testMenuName, false);
  });

  test('should show correct status badge when inactive', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Menu should be inactive from previous test
    await menusPage.expectMenuActive(testMenuName, false);

    // Verify status text contains "inactive"
    const status = await menusPage.getMenuStatus(testMenuName);
    expect(status.toLowerCase()).toContain('inactive');
  });

  test('should re-activate a deactivated menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Menu should be inactive from previous test
    await menusPage.expectMenuActive(testMenuName, false);

    // Re-activate the menu
    const activated = await menusPage.activateMenu(testMenuName);
    expect(activated, 'Menu re-activation should succeed').toBe(true);

    // Verify it shows as active again
    await menusPage.expectMenuActive(testMenuName, true);
  });

  test('should handle multiple activation/deactivation cycles', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Menu should be active from previous test
    await menusPage.expectMenuActive(testMenuName, true);

    // Cycle through deactivate -> activate -> deactivate
    // Use refresh after each state change to ensure UI is fully updated
    await menusPage.deactivateMenu(testMenuName);
    await menusPage.refresh();
    await menusPage.expectMenuActive(testMenuName, false);

    await menusPage.activateMenu(testMenuName);
    await menusPage.refresh();
    await menusPage.expectMenuActive(testMenuName, true);

    await menusPage.deactivateMenu(testMenuName);
    await menusPage.refresh();
    await menusPage.expectMenuActive(testMenuName, false);
  });
});
