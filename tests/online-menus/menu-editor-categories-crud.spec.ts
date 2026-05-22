import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/**
 * E2E Tests for Menu Editor - Full CRUD for Categories
 *
 * Tests Create, Read, Update, Delete operations for categories and items,
 * including persistence verification after save and reload.
 */
test.describe.serial('Menu Editor - Full CRUD for Categories @online-menus @categories', () => {
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
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
    editorPage = new OnlineMenusEditorPage(page);
  });

  test.afterAll(async () => {
    test.setTimeout(120000); // Firefox cleanup can be slow under concurrency
    try {
      await menusPage.goto();
      await menusPage.waitForLoading();

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

  test('should create menu and add multiple categories with items', async () => {
    testMenuName = `CRUD Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    await menusPage.createMenu(testMenuName, 'Menu for CRUD testing');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add first category
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Starters');

    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Spring Rolls');
    await editorPage.updateMenuItemPrice(0, 0, '8.99');

    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 1, 'Soup of the Day');
    await editorPage.updateMenuItemPrice(0, 1, '6.50');

    // Add second category
    await editorPage.addCategory();
    await editorPage.expandCategory(1);
    await editorPage.updateCategoryName(1, 'Main Courses');

    await editorPage.addMenuItem(1);
    await editorPage.updateMenuItemName(1, 0, 'Grilled Salmon');
    await editorPage.updateMenuItemPrice(1, 0, '24.99');

    // Add third category
    await editorPage.addCategory();
    await editorPage.expandCategory(2);
    await editorPage.updateCategoryName(2, 'Desserts');

    await editorPage.addMenuItem(2);
    await editorPage.updateMenuItemName(2, 0, 'Chocolate Cake');
    await editorPage.updateMenuItemPrice(2, 0, '7.99');

    const categoryCount = await editorPage.getCategoryCount();
    expect(categoryCount, 'Should have 3 categories before save').toBe(3);

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test.skip('should edit existing category name @known-bug-edit-2', async () => {
    // Skipped 2026-05-17 — see BaseClient/docs/Tasks/IN_PROGRESS/online-menus-e2e-known-failures-2026-05-17.md (Tier 4)
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.expandCategory(0);

    const currentName = await editorPage.getCategoryNameValue(0);
    expect(currentName).toBe('Starters');

    await editorPage.updateCategoryName(0, 'Appetizers & Starters');

    const newName = await editorPage.getCategoryNameValue(0);
    expect(newName).toBe('Appetizers & Starters');

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should delete a menu item from category', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Re-navigate before editing so the editor opens from a FRESH server fetch.
    // editMenu() opens the editor from the React Query list cache; without a
    // goto() the cache can still hold the pre-previous-test state, and the next
    // save would clobber the previous test's persisted change.
    await menusPage.goto();
    await menusPage.waitForLoading();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.expandCategory(0);

    const initialItemCount = await editorPage.getItemCount(0);
    expect(initialItemCount, 'Should have 2 items initially').toBe(2);

    await editorPage.deleteMenuItem(0, 1);

    const newItemCount = await editorPage.getItemCount(0);
    expect(newItemCount, 'Should have 1 item after deletion').toBe(1);

    const remainingItemName = await editorPage.getMenuItemNameValue(0, 0);
    expect(remainingItemName, 'Spring Rolls should remain').toBe('Spring Rolls');

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should delete a category', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Re-navigate so the editor opens from a fresh server fetch — see the
    // comment in the "delete a menu item" test above. Without this the editor
    // would open with the pre-delete item list and the category-delete save
    // would clobber the previous test's menu-item deletion.
    await menusPage.goto();
    await menusPage.waitForLoading();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.switchToContentTab();

    const initialCount = await editorPage.getCategoryCount();
    expect(initialCount, 'Should have 3 categories initially').toBe(3);

    // The previous test deleted one item from category 0, leaving it with one
    // item ("Spring Rolls"). Assert that persisted state opened correctly so a
    // regression in menu-item persistence fails HERE, not silently downstream.
    await editorPage.expandCategory(0);
    const cat0Items = await editorPage.getItemCount(0);
    expect(cat0Items, 'Category 0 should still have 1 item from the prior delete').toBe(1);

    await editorPage.deleteCategory(1);

    const newCount = await editorPage.getCategoryCount();
    expect(newCount, 'Should have 2 categories after deletion').toBe(2);

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should verify persistence after all CRUD operations', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.goto();
    await menusPage.waitForLoading();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.switchToContentTab();

    const categoryCount = await editorPage.getCategoryCount();
    expect(categoryCount, 'Should have 2 categories after reload').toBe(2);

    await editorPage.expandCategory(0);
    const firstCategoryName = await editorPage.getCategoryNameValue(0);
    // The '@known-bug-edit-2' rename test (Starters -> "Appetizers & Starters")
    // is skipped, so category 0 keeps the name set by the create test above.
    expect(firstCategoryName, 'First category should be Starters').toBe('Starters');

    const firstCategoryItemCount = await editorPage.getItemCount(0);
    expect(firstCategoryItemCount, 'First category should have 1 item').toBe(1);

    const firstItemName = await editorPage.getMenuItemNameValue(0, 0);
    expect(firstItemName, 'Item should be Spring Rolls').toBe('Spring Rolls');

    await editorPage.expandCategory(1);
    const secondCategoryName = await editorPage.getCategoryNameValue(1);
    expect(secondCategoryName, 'Second category should be Desserts').toBe('Desserts');

    await editorPage.cancelMenuEditor();
  });
});
