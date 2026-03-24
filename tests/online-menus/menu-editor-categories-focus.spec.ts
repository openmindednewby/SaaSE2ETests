import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/**
 * E2E Tests for Menu Editor - Focus Retention
 *
 * These tests verify that the menu editor's category and item input fields
 * retain focus while typing, specifically testing for regressions of focus
 * retention bugs where typing would lose focus mid-keystroke.
 */
test.describe.serial('Menu Editor Categories - Focus Retention @online-menus @categories', () => {
  test.setTimeout(180000); // 3 minutes for comprehensive tests

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
  });

  test.afterAll(async () => {
    test.setTimeout(60000); // Firefox cleanup can be slow under concurrency
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

  test('should create a test menu for category tests', async () => {
    testMenuName = `Category Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    await menusPage.createMenu(testMenuName, 'Menu for testing category focus retention');
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should retain focus while typing in Category Name field @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.addCategory();
    await editorPage.expandCategory(0);

    const categoryNameInput = editorPage.getCategoryNameInput(0);
    await expect(categoryNameInput).toBeVisible({ timeout: 5000 });

    await categoryNameInput.clear();
    await categoryNameInput.focus();

    // Type a full category name character by character to test focus retention
    const testCategoryName = 'Appetizers';
    for (const char of testCategoryName) {
      await categoryNameInput.type(char, { delay: 50 });
    }

    const isFocused = await categoryNameInput.evaluate((el) => document.activeElement === el);
    expect(isFocused, 'Category name input should retain focus while typing').toBe(true);

    const inputValue = await categoryNameInput.inputValue();
    expect(inputValue, 'All characters should be entered without focus loss').toBe(testCategoryName);
  });

  test('should retain focus while typing in Menu Item Name field @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await editorPage.addMenuItem(0);

    const itemNameInput = editorPage.getMenuItemNameInput(0, 0);
    await expect(itemNameInput).toBeVisible({ timeout: 5000 });

    await itemNameInput.clear();
    await itemNameInput.focus();

    const testItemName = 'Bruschetta';
    for (const char of testItemName) {
      await itemNameInput.type(char, { delay: 50 });
    }

    const isFocused = await itemNameInput.evaluate((el) => document.activeElement === el);
    expect(isFocused, 'Item name input should retain focus while typing').toBe(true);

    const inputValue = await itemNameInput.inputValue();
    expect(inputValue, 'All characters should be entered without focus loss').toBe(testItemName);
  });

  test('should retain focus while typing in Menu Item Price field @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const priceInput = editorPage.getMenuItemPriceInput(0, 0);
    await expect(priceInput).toBeVisible({ timeout: 5000 });

    await priceInput.clear();
    await priceInput.focus();

    const testPrice = '12.99';
    for (const char of testPrice) {
      await priceInput.type(char, { delay: 50 });
    }

    const isFocused = await priceInput.evaluate((el) => document.activeElement === el);
    expect(isFocused, 'Price input should retain focus while typing').toBe(true);

    const inputValue = await priceInput.inputValue();
    expect(inputValue, 'All characters should be entered without focus loss').toBe(testPrice);
  });

  test('should save menu with category and item', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist categories and items after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.goto();
    await menusPage.waitForLoading();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.switchToContentTab();

    const categoryCount = await editorPage.getCategoryCount();
    expect(categoryCount, 'Menu should have 1 category after reload').toBeGreaterThanOrEqual(1);

    await editorPage.expandCategory(0);

    const categoryName = await editorPage.getCategoryNameValue(0);
    expect(categoryName, 'Category name should persist after reload').toBe('Appetizers');

    const itemCount = await editorPage.getItemCount(0);
    expect(itemCount, 'Category should have 1 item after reload').toBeGreaterThanOrEqual(1);

    const itemName = await editorPage.getMenuItemNameValue(0, 0);
    expect(itemName, 'Item name should persist after reload').toBe('Bruschetta');

    const itemPrice = await editorPage.getMenuItemPriceValue(0, 0);
    expect(itemPrice, 'Item price should persist after reload').toBe('12.99');
  });
});
