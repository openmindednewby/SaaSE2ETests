import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/**
 * E2E Tests for Menu Editor - Multiple Category Focus Switching
 *
 * Tests that data is maintained when switching focus between categories,
 * and that category data persists after save and reload.
 */
test.describe('Menu Editor - Multiple Category Focus Switching @online-menus @categories', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
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
    editorPage = new OnlineMenusEditorPage(page);

    // Create test menu
    testMenuName = `Focus Switch Test ${Date.now()}`;
    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Menu for focus switching tests');
  });

  test.afterAll(async () => {
    test.setTimeout(60000); // Firefox cleanup can be slow under concurrency
    try {
      await menusPage.goto();
      if (testMenuName && await menusPage.menuExists(testMenuName)) {
        const isActive = await menusPage.isMenuActive(testMenuName);
        if (isActive) {
          await menusPage.deactivateMenu(testMenuName);
        }
        await menusPage.deleteMenu(testMenuName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should maintain data when switching between categories', async () => {
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add two categories
    await editorPage.addCategory();
    await editorPage.addCategory();

    // Fill first category
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'First Category');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'First Item');
    await editorPage.updateMenuItemPrice(0, 0, '10.00');

    // Collapse first and expand second
    await editorPage.collapseCategory(0);
    await editorPage.expandCategory(1);

    // Fill second category
    await editorPage.updateCategoryName(1, 'Second Category');
    await editorPage.addMenuItem(1);
    await editorPage.updateMenuItemName(1, 0, 'Second Item');
    await editorPage.updateMenuItemPrice(1, 0, '20.00');

    // Go back to first category and verify data retained
    await editorPage.collapseCategory(1);
    await editorPage.expandCategory(0);

    const firstCategoryName = await editorPage.getCategoryNameValue(0);
    expect(firstCategoryName, 'First category name should be retained').toBe('First Category');

    const firstItemName = await editorPage.getMenuItemNameValue(0, 0);
    expect(firstItemName, 'First item name should be retained').toBe('First Item');

    const firstItemPrice = await editorPage.getMenuItemPriceValue(0, 0);
    expect(firstItemPrice, 'First item price should be retained').toBe('10');

    // Verify second category data
    await editorPage.collapseCategory(0);
    await editorPage.expandCategory(1);

    const secondCategoryName = await editorPage.getCategoryNameValue(1);
    expect(secondCategoryName, 'Second category name should be retained').toBe('Second Category');

    const secondItemName = await editorPage.getMenuItemNameValue(1, 0);
    expect(secondItemName, 'Second item name should be retained').toBe('Second Item');

    // Save and verify persistence
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);

    // Reload and verify
    await menusPage.goto();
    await menusPage.editMenu(testMenuName);
    await editorPage.switchToContentTab();

    await editorPage.expandCategory(0);
    const reloadedFirstName = await editorPage.getCategoryNameValue(0);
    expect(reloadedFirstName).toBe('First Category');

    await editorPage.cancelMenuEditor();
  });
});
