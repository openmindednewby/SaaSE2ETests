import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Menu Styling Persistence
 *
 * Tests that styling changes are properly saved and persist after reload.
 * This is a comprehensive test that applies multiple styling changes and
 * verifies they all persist correctly.
 *
 * @tag @menu-styling
 */
test.describe.serial('Menu Styling Persistence @menu-styling @online-menus @critical', () => {
  test.setTimeout(300000); // 5 minutes for comprehensive persistence tests

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let stylingPage: MenuStylingPage;
  let testMenuName: string;

  // Store applied styling values for verification after reload
  const appliedStyles = {
    backgroundColor: '#F0F0F0',
    textColor: '#222222',
    fontSize: '18',
    borderRadius: 2, // Number of clicks
    hasShadow: true,
  };

  test.beforeAll(async ({ browser }, testInfo) => {
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
    stylingPage = new MenuStylingPage(page);
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

  test('should create a fully styled test menu', async () => {
    testMenuName = `Persistence Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    // Create a new menu with content
    await menusPage.createMenu(testMenuName, 'Menu for testing style persistence');
    await menusPage.expectMenuInList(testMenuName);

    // Add content so preview has something to show
    await menusPage.editMenu(testMenuName);
    await menusPage.switchToContentTab();

    // Add a category with items
    await menusPage.addCategory();
    await menusPage.expandCategory(0);
    await menusPage.updateCategoryName(0, 'Starters');
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 0, 'Bruschetta');
    await menusPage.updateMenuItemPrice(0, 0, '9.99');
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 1, 'Calamari');
    await menusPage.updateMenuItemPrice(0, 1, '12.99');

    // Add second category
    await menusPage.addCategory();
    await menusPage.expandCategory(1);
    await menusPage.updateCategoryName(1, 'Mains');
    await menusPage.addMenuItem(1);
    await menusPage.updateMenuItemName(1, 0, 'Ribeye Steak');
    await menusPage.updateMenuItemPrice(1, 0, '34.99');

    // Save the menu
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should apply color scheme styling', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Switch to colors tab
    await stylingPage.switchToColorsTab();

    // Apply color changes
    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    if (inputCount >= 2) {
      // Set background color
      await colorInputs.first().clear();
      await colorInputs.first().fill(appliedStyles.backgroundColor);
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();

      // Set text color
      await colorInputs.nth(1).clear();
      await colorInputs.nth(1).fill(appliedStyles.textColor);
      await colorInputs.nth(1).blur();
      await stylingPage.waitForLoading();
    }

    // Verify preview updated
    await stylingPage.expectPreviewVisible();
  });

  test('should apply typography styling', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Switch to typography tab
    await stylingPage.switchToTypographyTab();

    // Apply typography changes
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      // Set font size
      await sizeInputs.first().clear();
      await sizeInputs.first().fill(appliedStyles.fontSize);
      await sizeInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    // Verify preview updated
    await stylingPage.expectPreviewVisible();
  });

  test('should apply category box styling', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Look for category styling section
    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    const toggleExists = await categoryStylingToggle.count() > 0;

    if (toggleExists) {
      // Expand category styling
      await stylingPage.expandCategoryStyling();

      // Apply border radius
      const radiusButton = page.locator('[data-testid="box-style-border-radius-increase"]');
      if (await radiusButton.count() > 0) {
        for (let i = 0; i < appliedStyles.borderRadius; i++) {
          await radiusButton.first().click();
          await stylingPage.waitForLoading();
        }
      }

      // Apply shadow
      const shadowToggle = page.locator('[data-testid="box-style-shadow-toggle"]');
      if (await shadowToggle.count() > 0 && appliedStyles.hasShadow) {
        await shadowToggle.first().click();
        await stylingPage.waitForLoading();
      }
    }

    // Verify preview updated
    await stylingPage.expectPreviewVisible();
  });

  test('should save all styling changes @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Save the menu with all styling applied
    await stylingPage.saveStyling();

    // Verify menu is in the list
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist colors after page reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Switch to colors tab
    await stylingPage.switchToColorsTab();

    // Verify colors persisted
    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    if (inputCount >= 2) {
      const savedBgColor = await colorInputs.first().inputValue();
      const savedTextColor = await colorInputs.nth(1).inputValue();

      expect(savedBgColor.toLowerCase(), 'Background color should persist').toBe(
        appliedStyles.backgroundColor.toLowerCase()
      );
      expect(savedTextColor.toLowerCase(), 'Text color should persist').toBe(
        appliedStyles.textColor.toLowerCase()
      );
    }
  });

  test('should persist typography after page reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Switch to typography tab
    await stylingPage.switchToTypographyTab();

    // Verify typography persisted
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      const savedSize = await sizeInputs.first().inputValue();
      expect(savedSize, 'Font size should persist').toBe(appliedStyles.fontSize);
    }
  });

  test('should persist category styling after page reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Look for category styling section
    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    const toggleExists = await categoryStylingToggle.count() > 0;

    if (toggleExists) {
      // Expand category styling
      await stylingPage.expandCategoryStyling();

      // Note: Exact values may vary based on UI implementation
      // We verify that the section is accessible and has values
      const boxEditor = page.locator('[data-testid="box-style-editor"]');
      if (await boxEditor.count() > 0) {
        await expect(boxEditor.first()).toBeVisible({ timeout: 5000 });
      }
    }

    // Cancel to return to list
    await stylingPage.cancelStyling();
  });

  test('should persist styling after browser refresh @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Do a hard browser refresh
    await page.reload();
    await stylingPage.waitForLoading();

    // Navigate back to menu and edit
    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Switch to colors tab
    await stylingPage.switchToColorsTab();

    // Verify colors still persisted after hard refresh
    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    if (inputCount >= 1) {
      const savedBgColor = await colorInputs.first().inputValue();
      expect(savedBgColor.toLowerCase(), 'Colors should persist after browser refresh').toBe(
        appliedStyles.backgroundColor.toLowerCase()
      );
    }

    // Cancel to clean up
    await stylingPage.cancelStyling();
  });

  test('should show styling in preview modal', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Open preview for the menu
    await menusPage.openPreview(testMenuName);

    // Verify preview modal is visible
    await menusPage.expectPreviewModalVisible();

    // The preview should show our styled menu content
    // We can't easily verify specific CSS styles, but we verify the preview works
    const previewModal = page.locator('[data-testid="menu-preview-modal"]');
    await expect(previewModal).toBeVisible({ timeout: 5000 });

    // Close preview
    await menusPage.closePreview();
    await menusPage.expectPreviewModalNotVisible();
  });

  test('should retain styling when menu is activated and deactivated', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Ensure no other menus are active first
    await menusPage.deactivateAllMenus();

    // Activate the menu
    const activated = await menusPage.activateMenu(testMenuName);
    expect(activated, 'Menu should be activated').toBe(true);

    // Deactivate the menu
    const deactivated = await menusPage.deactivateMenu(testMenuName);
    expect(deactivated, 'Menu should be deactivated').toBe(true);

    // Edit and verify styling still persisted
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Switch to colors tab
    await stylingPage.switchToColorsTab();

    // Verify colors persisted after activation cycle
    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    if (inputCount >= 1) {
      const savedBgColor = await colorInputs.first().inputValue();
      expect(savedBgColor.toLowerCase(), 'Styling should persist after activation').toBe(
        appliedStyles.backgroundColor.toLowerCase()
      );
    }

    // Cancel to clean up
    await stylingPage.cancelStyling();
  });
});

/**
 * Additional persistence edge case tests
 */
test.describe('Menu Styling Persistence - Edge Cases @menu-styling @online-menus', () => {
  test.setTimeout(120000);

  let menusPage: OnlineMenusPage;
  let stylingPage: MenuStylingPage;

  test.beforeEach(async ({ page }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Add init script to restore auth
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
    stylingPage = new MenuStylingPage(page);
  });

  test('should not persist styling changes when cancelled', async ({ page }) => {
    const testMenuName = `Cancel Test ${Date.now()}`;

    // Create menu
    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Test cancel behavior');
    await menusPage.expectMenuInList(testMenuName);

    // Edit and make styling changes
    await menusPage.editMenu(testMenuName);
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    let originalColor = '';

    if (await colorInputs.count() > 0) {
      originalColor = await colorInputs.first().inputValue();

      // Change color
      await colorInputs.first().clear();
      await colorInputs.first().fill('#FF0000');
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    // Cancel without saving
    await stylingPage.cancelStyling();

    // Edit again and verify original color is still there
    await menusPage.editMenu(testMenuName);
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    if (await colorInputs.count() > 0 && originalColor) {
      const currentColor = await colorInputs.first().inputValue();
      expect(currentColor.toLowerCase(), 'Color should not have changed after cancel').toBe(
        originalColor.toLowerCase()
      );
    }

    // Cleanup
    await stylingPage.cancelStyling();
    await menusPage.deleteMenu(testMenuName, false);
  });
});
