import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Menu Editor - Categories and Items
 *
 * These tests verify the menu editor's category and item management functionality,
 * specifically testing for regressions of focus retention bugs:
 *
 * 1. Focus Retention - Typing in category/item fields should NOT lose focus
 * 2. Category Persistence - Categories and items should persist after save/reload
 * 3. Full CRUD - Create, Read, Update, Delete operations for categories and items
 */

test.describe.serial('Menu Editor Categories - Focus Retention @online-menus @categories', () => {
  test.setTimeout(180000); // 3 minutes for comprehensive tests

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
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

  test.afterAll(async () => {
    // Cleanup: delete test menu if it exists
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

    // Create a new menu
    await menusPage.createMenu(testMenuName, 'Menu for testing category focus retention');
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should retain focus while typing in Category Name field @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add a category
    await menusPage.addCategory();

    // Expand the category to access inputs
    await menusPage.expandCategory(0);

    // Get the category name input
    const categoryNameInput = menusPage.getCategoryNameInput(0);
    await expect(categoryNameInput).toBeVisible({ timeout: 5000 });

    // Clear and focus the input
    await categoryNameInput.clear();
    await categoryNameInput.focus();

    // Type a full category name character by character
    // This tests focus retention - if focus is lost, characters will be missed
    const testCategoryName = 'Appetizers';
    for (const char of testCategoryName) {
      await categoryNameInput.type(char, { delay: 50 });
    }

    // Verify the input still has focus
    const isFocused = await categoryNameInput.evaluate((el) => document.activeElement === el);
    expect(isFocused, 'Category name input should retain focus while typing').toBe(true);

    // Verify the complete text was entered
    const inputValue = await categoryNameInput.inputValue();
    expect(inputValue, 'All characters should be entered without focus loss').toBe(testCategoryName);
  });

  test('should retain focus while typing in Menu Item Name field @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Add a menu item to the category
    await menusPage.addMenuItem(0);

    // Get the menu item name input
    const itemNameInput = menusPage.getMenuItemNameInput(0, 0);
    await expect(itemNameInput).toBeVisible({ timeout: 5000 });

    // Clear and focus the input
    await itemNameInput.clear();
    await itemNameInput.focus();

    // Type a full item name character by character
    const testItemName = 'Bruschetta';
    for (const char of testItemName) {
      await itemNameInput.type(char, { delay: 50 });
    }

    // Verify the input still has focus
    const isFocused = await itemNameInput.evaluate((el) => document.activeElement === el);
    expect(isFocused, 'Item name input should retain focus while typing').toBe(true);

    // Verify the complete text was entered
    const inputValue = await itemNameInput.inputValue();
    expect(inputValue, 'All characters should be entered without focus loss').toBe(testItemName);
  });

  test('should retain focus while typing in Menu Item Price field @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Get the menu item price input
    const priceInput = menusPage.getMenuItemPriceInput(0, 0);
    await expect(priceInput).toBeVisible({ timeout: 5000 });

    // Clear and focus the input
    await priceInput.clear();
    await priceInput.focus();

    // Type a price character by character
    const testPrice = '12.99';
    for (const char of testPrice) {
      await priceInput.type(char, { delay: 50 });
    }

    // Verify the input still has focus
    const isFocused = await priceInput.evaluate((el) => document.activeElement === el);
    expect(isFocused, 'Price input should retain focus while typing').toBe(true);

    // Verify the complete text was entered
    const inputValue = await priceInput.inputValue();
    expect(inputValue, 'All characters should be entered without focus loss').toBe(testPrice);
  });

  test('should save menu with category and item', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Save the menu
    await menusPage.saveMenuEditor();

    // Verify menu is in the list
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist categories and items after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to Content tab
    await menusPage.switchToContentTab();

    // Verify category count
    const categoryCount = await menusPage.getCategoryCount();
    expect(categoryCount, 'Menu should have 1 category after reload').toBeGreaterThanOrEqual(1);

    // Expand category to see items
    await menusPage.expandCategory(0);

    // Verify category name persisted
    const categoryName = await menusPage.getCategoryNameValue(0);
    expect(categoryName, 'Category name should persist after reload').toBe('Appetizers');

    // Verify item count
    const itemCount = await menusPage.getItemCount(0);
    expect(itemCount, 'Category should have 1 item after reload').toBeGreaterThanOrEqual(1);

    // Verify item name persisted
    const itemName = await menusPage.getMenuItemNameValue(0, 0);
    expect(itemName, 'Item name should persist after reload').toBe('Bruschetta');

    // Verify item price persisted
    const itemPrice = await menusPage.getMenuItemPriceValue(0, 0);
    expect(itemPrice, 'Item price should persist after reload').toBe('12.99');
  });
});

test.describe.serial('Menu Editor - Full CRUD for Categories @online-menus @categories', () => {
  test.setTimeout(240000); // 4 minutes for full CRUD tests

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
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

  test.afterAll(async () => {
    // Cleanup: delete test menu if it exists
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

    // Create a new menu
    await menusPage.createMenu(testMenuName, 'Menu for CRUD testing');
    await menusPage.expectMenuInList(testMenuName);

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add first category
    await menusPage.addCategory();
    await menusPage.expandCategory(0);
    await menusPage.updateCategoryName(0, 'Starters');

    // Add items to first category
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 0, 'Spring Rolls');
    await menusPage.updateMenuItemPrice(0, 0, '8.99');

    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 1, 'Soup of the Day');
    await menusPage.updateMenuItemPrice(0, 1, '6.50');

    // Add second category
    await menusPage.addCategory();
    await menusPage.expandCategory(1);
    await menusPage.updateCategoryName(1, 'Main Courses');

    // Add items to second category
    await menusPage.addMenuItem(1);
    await menusPage.updateMenuItemName(1, 0, 'Grilled Salmon');
    await menusPage.updateMenuItemPrice(1, 0, '24.99');

    // Add third category
    await menusPage.addCategory();
    await menusPage.expandCategory(2);
    await menusPage.updateCategoryName(2, 'Desserts');

    await menusPage.addMenuItem(2);
    await menusPage.updateMenuItemName(2, 0, 'Chocolate Cake');
    await menusPage.updateMenuItemPrice(2, 0, '7.99');

    // Verify category count before save
    const categoryCount = await menusPage.getCategoryCount();
    expect(categoryCount, 'Should have 3 categories before save').toBe(3);

    // Save the menu
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should edit existing category name', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Expand first category
    await menusPage.expandCategory(0);

    // Verify current name
    const currentName = await menusPage.getCategoryNameValue(0);
    expect(currentName).toBe('Starters');

    // Update category name
    await menusPage.updateCategoryName(0, 'Appetizers & Starters');

    // Verify new name
    const newName = await menusPage.getCategoryNameValue(0);
    expect(newName).toBe('Appetizers & Starters');

    // Save
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should delete a menu item from category', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Expand first category
    await menusPage.expandCategory(0);

    // Get initial item count
    const initialItemCount = await menusPage.getItemCount(0);
    expect(initialItemCount, 'Should have 2 items initially').toBe(2);

    // Delete the second item (Soup of the Day)
    await menusPage.deleteMenuItem(0, 1);

    // Verify item count decreased
    const newItemCount = await menusPage.getItemCount(0);
    expect(newItemCount, 'Should have 1 item after deletion').toBe(1);

    // Verify the correct item remains
    const remainingItemName = await menusPage.getMenuItemNameValue(0, 0);
    expect(remainingItemName, 'Spring Rolls should remain').toBe('Spring Rolls');

    // Save
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should delete a category', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Get initial category count
    const initialCount = await menusPage.getCategoryCount();
    expect(initialCount, 'Should have 3 categories initially').toBe(3);

    // Delete the second category (Main Courses - now at index 1)
    await menusPage.deleteCategory(1);

    // Verify category count decreased
    const newCount = await menusPage.getCategoryCount();
    expect(newCount, 'Should have 2 categories after deletion').toBe(2);

    // Save
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should verify persistence after all CRUD operations', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to Content tab
    await menusPage.switchToContentTab();

    // Verify category count (should be 2 after deletion)
    const categoryCount = await menusPage.getCategoryCount();
    expect(categoryCount, 'Should have 2 categories after reload').toBe(2);

    // Expand first category and verify
    await menusPage.expandCategory(0);
    const firstCategoryName = await menusPage.getCategoryNameValue(0);
    expect(firstCategoryName, 'First category should be Appetizers & Starters').toBe('Appetizers & Starters');

    // Verify first category has 1 item
    const firstCategoryItemCount = await menusPage.getItemCount(0);
    expect(firstCategoryItemCount, 'First category should have 1 item').toBe(1);

    // Verify item name
    const firstItemName = await menusPage.getMenuItemNameValue(0, 0);
    expect(firstItemName, 'Item should be Spring Rolls').toBe('Spring Rolls');

    // Expand second category (was Desserts, now at index 1)
    await menusPage.expandCategory(1);
    const secondCategoryName = await menusPage.getCategoryNameValue(1);
    expect(secondCategoryName, 'Second category should be Desserts').toBe('Desserts');

    // Cancel editor
    await menusPage.cancelMenuEditor();
  });
});

test.describe('Menu Editor - Multiple Category Focus Switching @online-menus @categories', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
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

    // Create test menu
    testMenuName = `Focus Switch Test ${Date.now()}`;
    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Menu for focus switching tests');
  });

  test.afterAll(async () => {
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
    await menusPage.addCategory();
    await menusPage.addCategory();

    // Fill first category
    await menusPage.expandCategory(0);
    await menusPage.updateCategoryName(0, 'First Category');
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 0, 'First Item');
    await menusPage.updateMenuItemPrice(0, 0, '10.00');

    // Collapse first and expand second
    await menusPage.collapseCategory(0);
    await menusPage.expandCategory(1);

    // Fill second category
    await menusPage.updateCategoryName(1, 'Second Category');
    await menusPage.addMenuItem(1);
    await menusPage.updateMenuItemName(1, 0, 'Second Item');
    await menusPage.updateMenuItemPrice(1, 0, '20.00');

    // Go back to first category and verify data retained
    await menusPage.collapseCategory(1);
    await menusPage.expandCategory(0);

    const firstCategoryName = await menusPage.getCategoryNameValue(0);
    expect(firstCategoryName, 'First category name should be retained').toBe('First Category');

    const firstItemName = await menusPage.getMenuItemNameValue(0, 0);
    expect(firstItemName, 'First item name should be retained').toBe('First Item');

    const firstItemPrice = await menusPage.getMenuItemPriceValue(0, 0);
    expect(firstItemPrice, 'First item price should be retained').toBe('10');

    // Verify second category data
    await menusPage.collapseCategory(0);
    await menusPage.expandCategory(1);

    const secondCategoryName = await menusPage.getCategoryNameValue(1);
    expect(secondCategoryName, 'Second category name should be retained').toBe('Second Category');

    const secondItemName = await menusPage.getMenuItemNameValue(1, 0);
    expect(secondItemName, 'Second item name should be retained').toBe('Second Item');

    // Save and verify persistence
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);

    // Reload and verify
    await menusPage.goto();
    await menusPage.editMenu(testMenuName);
    await menusPage.switchToContentTab();

    await menusPage.expandCategory(0);
    const reloadedFirstName = await menusPage.getCategoryNameValue(0);
    expect(reloadedFirstName).toBe('First Category');

    await menusPage.cancelMenuEditor();
  });
});
