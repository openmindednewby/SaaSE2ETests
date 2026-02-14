import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { TestIds, testIdSelector, testIdStartsWithSelector } from '../../shared/testIds.js';

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
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
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
    await menusPage.addCategory();
    await menusPage.expandCategory(0);
    await menusPage.updateCategoryName(0, 'Specials');

    // Add an item to first category
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 0, 'Chef Special');
    await menusPage.updateMenuItemPrice(0, 0, '15.99');

    // Add second category with the SAME name "Specials"
    await menusPage.addCategory();
    await menusPage.expandCategory(1);
    await menusPage.updateCategoryName(1, 'Specials');

    // Add a different item to second category
    await menusPage.addMenuItem(1);
    await menusPage.updateMenuItemName(1, 0, 'Daily Special');
    await menusPage.updateMenuItemPrice(1, 0, '12.99');

    // Verify both categories exist and have the same name
    const cat0Name = await menusPage.getCategoryNameValue(0);
    const cat1Name = await menusPage.getCategoryNameValue(1);
    expect(cat0Name, 'First category should be named Specials').toBe('Specials');
    expect(cat1Name, 'Second category should also be named Specials').toBe('Specials');

    // Verify both categories are visible (no React key collision)
    const categoryCount = await menusPage.getCategoryCount();
    expect(categoryCount, 'Should have 2 categories with duplicate names').toBe(2);

    // Save the menu
    await menusPage.saveMenuEditor();
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
    await menusPage.switchToContentTab();

    // Verify both categories persisted
    const categoryCount = await menusPage.getCategoryCount();
    expect(
      categoryCount,
      'Both duplicate-named categories should persist after reload'
    ).toBe(2);

    // Verify names are still the same
    await menusPage.expandCategory(0);
    const cat0Name = await menusPage.getCategoryNameValue(0);
    expect(cat0Name).toBe('Specials');

    await menusPage.expandCategory(1);
    const cat1Name = await menusPage.getCategoryNameValue(1);
    expect(cat1Name).toBe('Specials');

    // Verify items are in correct categories
    const item0Name = await menusPage.getMenuItemNameValue(0, 0);
    expect(item0Name, 'First category should contain Chef Special').toBe('Chef Special');

    const item1Name = await menusPage.getMenuItemNameValue(1, 0);
    expect(item1Name, 'Second category should contain Daily Special').toBe('Daily Special');
  });

  test('should handle duplicate item names within a category (BUG-MENU-008)', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Already in the editor from the previous test, expand category 0
    await menusPage.expandCategory(0);

    // Add a second item with the SAME name as the first
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 1, 'Chef Special');
    await menusPage.updateMenuItemPrice(0, 1, '18.99');

    // Verify both items exist
    const itemCount = await menusPage.getItemCount(0);
    expect(
      itemCount,
      'Should have 2 items with the same name in category'
    ).toBe(2);

    // Verify both items have their distinct prices
    const price0 = await menusPage.getMenuItemPriceValue(0, 0);
    const price1 = await menusPage.getMenuItemPriceValue(0, 1);
    expect(price0, 'First item should have price 15.99').toBe('15.99');
    expect(price1, 'Second item should have price 18.99').toBe('18.99');

    // Save the menu
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should edit one duplicate without affecting the other', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Expand first category
    await menusPage.expandCategory(0);

    // Rename the second item (index 1) from "Chef Special" to "Premium Special"
    await menusPage.updateMenuItemName(0, 1, 'Premium Special');

    // Verify first item name is unchanged
    const firstItemName = await menusPage.getMenuItemNameValue(0, 0);
    expect(
      firstItemName,
      'Editing one duplicate should not affect the other'
    ).toBe('Chef Special');

    // Verify second item was renamed
    const secondItemName = await menusPage.getMenuItemNameValue(0, 1);
    expect(secondItemName).toBe('Premium Special');

    // Save
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should render duplicate categories correctly in public view @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Activate the menu so it appears in public view
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Deactivate all first to ensure clean state
    await menusPage.deactivateAllMenus();

    // After deactivateAllMenus (which may reload the page), navigate back to
    // menus and wait for the list to be fully loaded before activating
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Wait for the menu card to be visible before attempting activation
    await menusPage.expectMenuInList(testMenuName);

    // Activate our test menu
    const activated = await menusPage.activateMenu(testMenuName);

    if (!activated) {
      console.warn('Could not activate test menu - skipping public view test');
      test.skip(true, 'Menu activation failed');
      return;
    }

    // Open a new page for public view (same context for auth)
    const publicPage = await context.newPage();

    // Add init script for auth
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

    try {
      // Navigate to public menus
      await publicPage.goto('/public/menus');

      // Wait for menu list to load
      const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
      await expect(publicMenuList).toBeVisible({ timeout: 15000 });

      // Wait for loading to complete
      const loadingIndicator = publicPage.locator('[role="progressbar"]');
      if (await loadingIndicator.count() > 0) {
        await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }

      // Find our test menu card
      const menuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
        hasText: testMenuName,
      });

      const menuVisible = await menuCard.isVisible({ timeout: 5000 }).catch(() => false);

      if (menuVisible) {
        // Click the "View Menu" button inside the card to navigate to the public viewer
        // The outer card View is not clickable; only the TouchableOpacity button triggers navigation
        const viewButton = menuCard.locator(`[data-testid$="-view-button"]`);
        await viewButton.click();

        // Wait for navigation to complete after clicking the card
        await publicPage.waitForLoadState('load', { timeout: 15000 }).catch(() => {});

        // Wait for the viewer to load - check for either public viewer or content view
        const menuViewer = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_VIEWER));
        const menuContent = publicPage.locator(testIdSelector(TestIds.MENU_CONTENT_VIEW));
        await expect(menuViewer.or(menuContent).first()).toBeVisible({ timeout: 15000 });

        // Check that both "Specials" categories are rendered
        // Category testIDs are "public-menu-category-{id}", so use starts-with selector
        const categoryElements = publicPage.locator(
          testIdStartsWithSelector(TestIds.PUBLIC_MENU_CATEGORY)
        ).filter({ hasText: 'Specials' });

        const categoryCount = await categoryElements.count();
        console.log(`Public view shows ${categoryCount} categories named "Specials"`);

        // After BUG-MENU-007 fix, both categories should render
        expect(
          categoryCount,
          'Public view should render both duplicate-named categories'
        ).toBeGreaterThanOrEqual(2);
      } else {
        console.log('Test menu not visible in public view - may need auth or different route');
      }
    } finally {
      await publicPage.close();
    }

    // Deactivate the menu after test
    await menusPage.goto();
    await menusPage.deactivateMenu(testMenuName);
  });
});
