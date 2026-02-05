import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Online Menu Status Display
 *
 * Tests that the isActive field properly displays across various scenarios:
 * - New menus show correct initial status
 * - Status updates after activation/deactivation
 * - Multiple menus display independent statuses
 * - Status persists after page reload
 */
test.describe.serial('Menu Status Display @online-menus @ui', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let menu1Name: string;
  let menu2Name: string;
  let menu3Name: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
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

    menusPage = new OnlineMenusPage(page);
  });

  test.beforeEach(async () => {
    await menusPage.goto();
  });

  test.afterAll(async () => {
    // Cleanup all test menus
    try {
      await menusPage.goto();
      await menusPage.deactivateAllMenus();

      for (const menuName of [menu1Name, menu2Name, menu3Name]) {
        if (menuName && await menusPage.menuExists(menuName)) {
          await menusPage.deleteMenu(menuName, false);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create multiple menus for status testing', async () => {
    menu1Name = `Status Test Menu 1 ${Date.now()}`;
    menu2Name = `Status Test Menu 2 ${Date.now()}`;
    menu3Name = `Status Test Menu 3 ${Date.now()}`;

    // Ensure clean state
    await menusPage.deactivateAllMenus();

    // Create three menus
    await menusPage.createMenu(menu1Name, 'First menu for status testing');
    await menusPage.expectMenuInList(menu1Name);

    await menusPage.createMenu(menu2Name, 'Second menu for status testing');
    await menusPage.expectMenuInList(menu2Name);

    await menusPage.createMenu(menu3Name, 'Third menu for status testing');
    await menusPage.expectMenuInList(menu3Name);
  });

  test('should show newly created menus as inactive by default @critical', async () => {
    // All menus should start as inactive
    await menusPage.expectMenuActive(menu1Name, false);
    await menusPage.expectMenuActive(menu2Name, false);
    await menusPage.expectMenuActive(menu3Name, false);
  });

  test('should display different statuses for different menus', async () => {
    // Activate only menu1
    await menusPage.activateMenu(menu1Name);
    await menusPage.expectMenuActive(menu1Name, true);

    // Menu2 and Menu3 should still be inactive
    await menusPage.expectMenuActive(menu2Name, false);
    await menusPage.expectMenuActive(menu3Name, false);
  });

  test('should update status display immediately after activation', async () => {
    // Menu1 is active, activate Menu2
    await menusPage.expectMenuActive(menu1Name, true);

    const status2Before = await menusPage.getMenuStatus(menu2Name);
    expect(status2Before.toLowerCase()).toContain('inactive');

    await menusPage.activateMenu(menu2Name);

    // Status should update immediately (web-first assertion auto-retries)
    await menusPage.expectMenuActive(menu2Name, true);

    const status2After = await menusPage.getMenuStatus(menu2Name);
    expect(status2After.toLowerCase()).toContain('active');
  });

  test('should update status display immediately after deactivation', async () => {
    // Menu1 and Menu2 are active, deactivate Menu1
    await menusPage.expectMenuActive(menu1Name, true);

    const status1Before = await menusPage.getMenuStatus(menu1Name);
    expect(status1Before.toLowerCase()).toContain('active');

    await menusPage.deactivateMenu(menu1Name);

    // Status should update immediately
    await menusPage.expectMenuActive(menu1Name, false);

    const status1After = await menusPage.getMenuStatus(menu1Name);
    expect(status1After.toLowerCase()).toContain('inactive');
  });

  test('should persist status after page reload @critical', async () => {
    // Current state: Menu1 inactive, Menu2 active, Menu3 inactive
    await menusPage.expectMenuActive(menu1Name, false);
    await menusPage.expectMenuActive(menu2Name, true);
    await menusPage.expectMenuActive(menu3Name, false);

    // Reload the page
    await menusPage.goto();

    // Status should persist
    await menusPage.expectMenuActive(menu1Name, false);
    await menusPage.expectMenuActive(menu2Name, true);
    await menusPage.expectMenuActive(menu3Name, false);
  });

  test('should show correct status badges for all menus simultaneously', async () => {
    // Activate Menu1 and Menu3, keep Menu2 active
    await menusPage.activateMenu(menu1Name);
    await menusPage.activateMenu(menu3Name);

    // All three menus should show active status
    await menusPage.expectMenuActive(menu1Name, true);
    await menusPage.expectMenuActive(menu2Name, true);
    await menusPage.expectMenuActive(menu3Name, true);

    // Verify status text for all menus
    const status1 = await menusPage.getMenuStatus(menu1Name);
    const status2 = await menusPage.getMenuStatus(menu2Name);
    const status3 = await menusPage.getMenuStatus(menu3Name);

    expect(status1.toLowerCase()).toContain('active');
    expect(status2.toLowerCase()).toContain('active');
    expect(status3.toLowerCase()).toContain('active');
  });

  test('should reflect mixed active/inactive states correctly', async () => {
    // Deactivate Menu2 to create mixed state
    await menusPage.deactivateMenu(menu2Name);

    // Menu1 and Menu3 active, Menu2 inactive
    await menusPage.expectMenuActive(menu1Name, true);
    await menusPage.expectMenuActive(menu2Name, false);
    await menusPage.expectMenuActive(menu3Name, true);

    const status1 = await menusPage.getMenuStatus(menu1Name);
    const status2 = await menusPage.getMenuStatus(menu2Name);
    const status3 = await menusPage.getMenuStatus(menu3Name);

    expect(status1.toLowerCase()).toContain('active');
    expect(status2.toLowerCase()).toContain('inactive');
    expect(status3.toLowerCase()).toContain('active');
  });

  test('should maintain status consistency across rapid changes', async () => {
    // Rapidly change Menu1 status multiple times
    await menusPage.deactivateMenu(menu1Name);
    await menusPage.expectMenuActive(menu1Name, false);

    await menusPage.activateMenu(menu1Name);
    await menusPage.expectMenuActive(menu1Name, true);

    await menusPage.deactivateMenu(menu1Name);
    await menusPage.expectMenuActive(menu1Name, false);

    // Final state should be consistent
    const finalStatus = await menusPage.getMenuStatus(menu1Name);
    expect(finalStatus.toLowerCase()).toContain('inactive');
  });
});
