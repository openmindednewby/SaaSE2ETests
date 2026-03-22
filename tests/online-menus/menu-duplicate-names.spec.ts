import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/**
 * E2E Tests for Duplicate Category/Item Names (BUG-MENU-007/008)
 *
 * Previously, categories and items with the same name caused React key
 * collisions because names were used as keys. The fix uses unique IDs
 * instead of names for React keys.
 *
 * These tests verify:
 * 1. Multiple categories with the same name render correctly
 * 2. Multiple items with the same name within a category render correctly
 * 3. Editing one duplicate does not affect the other
 * 4. Duplicate-named content persists correctly after save
 * 5. Public viewer renders all duplicate-named categories
 */
test.describe.serial('Menu Duplicate Names @online-menus @duplicate-names', () => {
  test.setTimeout(180000); // 3 minutes for comprehensive tests

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage
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

    // Save auth state
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
    // Cleanup: delete test menu
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

  test('should create menu with duplicate category names (BUG-MENU-007) @critical', async () => {
    testMenuName = `Duplicate Names Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    // Create a new menu
    await menusPage.createMenu(testMenuName, 'Menu for testing duplicate name rendering');
    await menusPage.expectMenuInList(testMenuName);

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add first category with name "Specials"
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Specials');

    // Add an item to first category
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Chef Special');
    await editorPage.updateMenuItemPrice(0, 0, '15.99');

    // Add second category with the SAME name "Specials"
    await editorPage.addCategory();
    await editorPage.expandCategory(1);
    await editorPage.updateCategoryName(1, 'Specials');

    // Add a different item to second category
    await editorPage.addMenuItem(1);
    await editorPage.updateMenuItemName(1, 0, 'Daily Special');
    await editorPage.updateMenuItemPrice(1, 0, '12.99');

    // Verify both categories exist and have the same name
    const cat0Name = await editorPage.getCategoryNameValue(0);
    const cat1Name = await editorPage.getCategoryNameValue(1);
    expect(cat0Name, 'First category should be named Specials').toBe('Specials');
    expect(cat1Name, 'Second category should also be named Specials').toBe('Specials');

    // Verify both categories are visible (no React key collision)
    const categoryCount = await editorPage.getCategoryCount();
    expect(categoryCount, 'Should have 2 categories with duplicate names').toBe(2);

    // Save the menu
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should render both duplicate-named categories after reload', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to Content tab
    await editorPage.switchToContentTab();

    // Verify both categories persisted
    const categoryCount = await editorPage.getCategoryCount();
    expect(
      categoryCount,
      'Both duplicate-named categories should persist after reload'
    ).toBe(2);

    // Verify names are still the same
    await editorPage.expandCategory(0);
    const cat0Name = await editorPage.getCategoryNameValue(0);
    expect(cat0Name).toBe('Specials');

    await editorPage.expandCategory(1);
    const cat1Name = await editorPage.getCategoryNameValue(1);
    expect(cat1Name).toBe('Specials');

    // Verify items are in correct categories
    const item0Name = await editorPage.getMenuItemNameValue(0, 0);
    expect(item0Name, 'First category should contain Chef Special').toBe('Chef Special');

    const item1Name = await editorPage.getMenuItemNameValue(1, 0);
    expect(item1Name, 'Second category should contain Daily Special').toBe('Daily Special');
  });

  test('should handle duplicate item names within a category (BUG-MENU-008)', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Already in the editor from the previous test, expand category 0
    await editorPage.expandCategory(0);

    // Add a second item with the SAME name as the first
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 1, 'Chef Special');
    await editorPage.updateMenuItemPrice(0, 1, '18.99');

    // Verify both items exist
    const itemCount = await editorPage.getItemCount(0);
    expect(
      itemCount,
      'Should have 2 items with the same name in category'
    ).toBe(2);

    // Verify both items have their distinct prices
    const price0 = await editorPage.getMenuItemPriceValue(0, 0);
    const price1 = await editorPage.getMenuItemPriceValue(0, 1);
    expect(price0, 'First item should have price 15.99').toBe('15.99');
    expect(price1, 'Second item should have price 18.99').toBe('18.99');

    // Save the menu
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should edit one duplicate without affecting the other', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Expand first category
    await editorPage.expandCategory(0);

    // Rename the second item (index 1) from "Chef Special" to "Premium Special"
    await editorPage.updateMenuItemName(0, 1, 'Premium Special');

    // Verify first item name is unchanged
    const firstItemName = await editorPage.getMenuItemNameValue(0, 0);
    expect(
      firstItemName,
      'Editing one duplicate should not affect the other'
    ).toBe('Chef Special');

    // Verify second item was renamed
    const secondItemName = await editorPage.getMenuItemNameValue(0, 1);
    expect(secondItemName).toBe('Premium Special');

    // Save
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should render duplicate categories correctly in public view @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Use the menu editor's Preview tab to verify duplicate categories render
    // correctly. This is more reliable than opening a separate public page,
    // which requires complex auth setup and is prone to cross-project
    // interference under 12-worker concurrency (deactivateAllMenus from
    // another browser project can deactivate this project's test menu).
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu to access the Preview tab
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to the Preview tab
    const previewTab = menusPage.menuEditor.getByRole('tab', { name: /preview/i });
    await previewTab.click();

    // Wait for the live preview panel to render
    const livePreview = page.locator(testIdSelector(TestIds.LIVE_PREVIEW_PANEL));
    await expect(livePreview).toBeVisible({ timeout: 15000 });

    // The preview uses PreviewCategorySection components (not PUBLIC_MENU_CATEGORY testIds).
    // Count the number of category headings containing "Specials" within the preview.
    // Each category renders its name as a heading-level text in the preview frame.
    const specialsHeadings = livePreview.getByText('Specials', { exact: true });
    const categoryCount = await specialsHeadings.count();

    // After BUG-MENU-007 fix, both duplicate-named categories should render
    expect(
      categoryCount,
      'Preview should render both duplicate-named categories'
    ).toBeGreaterThanOrEqual(2);
  });
});
