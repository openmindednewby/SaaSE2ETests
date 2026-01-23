import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Online Menu CRUD with Activation State
 *
 * Tests the integration of CRUD operations with the new activation/deactivation feature:
 * - Creating menus (should start inactive)
 * - Editing menus (should preserve activation state)
 * - Deleting menus (both active and inactive)
 * - Activation state management across operations
 */
test.describe.serial('Menu CRUD with Activation State @online-menus @crud', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    menusPage = new OnlineMenusPage(page);
  });

  test.beforeEach(async () => {
    await menusPage.goto();
  });

  test.afterAll(async () => {
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

  test('should create menu with inactive status by default @critical', async () => {
    testMenuName = `CRUD Test Menu ${Date.now()}`;

    await menusPage.createMenu(testMenuName, 'Menu for CRUD testing');
    await menusPage.expectMenuInList(testMenuName);

    // New menus should be inactive by default
    await menusPage.expectMenuActive(testMenuName, false);
  });

  test('should allow activating a newly created menu', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.expectMenuActive(testMenuName, false);

    await menusPage.activateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, true);
  });

  test('should be able to delete an active menu', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Ensure menu is active
    const isActive = await menusPage.isMenuActive(testMenuName);
    if (!isActive) {
      await menusPage.activateMenu(testMenuName);
      await menusPage.expectMenuActive(testMenuName, true);
    }

    // Create a new menu for deletion test
    const deleteTestMenuName = `Delete Active Menu ${Date.now()}`;
    await menusPage.createMenu(deleteTestMenuName, 'Menu to test deleting while active');
    await menusPage.expectMenuInList(deleteTestMenuName);

    // Activate it
    await menusPage.activateMenu(deleteTestMenuName);
    await menusPage.expectMenuActive(deleteTestMenuName, true);

    // Delete the active menu
    await menusPage.deleteMenu(deleteTestMenuName);
    await menusPage.expectMenuNotInList(deleteTestMenuName);
  });

  test('should be able to delete an inactive menu', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Create a new menu for deletion test
    const deleteTestMenuName = `Delete Inactive Menu ${Date.now()}`;
    await menusPage.createMenu(deleteTestMenuName, 'Menu to test deleting while inactive');
    await menusPage.expectMenuInList(deleteTestMenuName);

    // Ensure it's inactive
    await menusPage.expectMenuActive(deleteTestMenuName, false);

    // Delete the inactive menu
    await menusPage.deleteMenu(deleteTestMenuName);
    await menusPage.expectMenuNotInList(deleteTestMenuName);
  });

  test('should list all menus with their correct activation states', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Create two more menus with different states
    const activeMenuName = `Active Menu ${Date.now()}`;
    const inactiveMenuName = `Inactive Menu ${Date.now()}`;

    await menusPage.createMenu(activeMenuName, 'This will be active');
    await menusPage.createMenu(inactiveMenuName, 'This will stay inactive');

    // Activate the first one
    await menusPage.activateMenu(activeMenuName);

    // Verify all three menus exist with correct states
    await menusPage.expectMenuInList(testMenuName);
    await menusPage.expectMenuInList(activeMenuName);
    await menusPage.expectMenuInList(inactiveMenuName);

    const testMenuActive = await menusPage.isMenuActive(testMenuName);
    const activeMenuActive = await menusPage.isMenuActive(activeMenuName);
    const inactiveMenuActive = await menusPage.isMenuActive(inactiveMenuName);

    expect(activeMenuActive).toBe(true);
    expect(inactiveMenuActive).toBe(false);

    // Cleanup the extra menus
    await menusPage.deactivateMenu(activeMenuName);
    await menusPage.deleteMenu(activeMenuName, false);
    await menusPage.deleteMenu(inactiveMenuName, false);
  });

  test('should deactivate menu before final cleanup', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check if menu is active
    const isActive = await menusPage.isMenuActive(testMenuName);

    if (isActive) {
      // Deactivate it for cleanup
      await menusPage.deactivateMenu(testMenuName);
      await menusPage.expectMenuActive(testMenuName, false);
    }

    // Menu is now ready for cleanup in afterAll
    const finalState = await menusPage.isMenuActive(testMenuName);
    expect(finalState).toBe(false);
  });
});
