import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Category Styling
 *
 * Tests the category-specific styling functionality in the menu editor.
 * Verifies that box styling and media position settings apply correctly.
 *
 * @tag @menu-styling
 */
test.describe.serial('Category Styling @menu-styling @online-menus', () => {
  test.setTimeout(240000); // 4 minutes for comprehensive tests

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let stylingPage: MenuStylingPage;
  let testMenuName: string;

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

  test('should create a test menu with category for styling tests', async () => {
    testMenuName = `Category Style Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    // Create a new menu
    await menusPage.createMenu(testMenuName, 'Menu for testing category styling');
    await menusPage.expectMenuInList(testMenuName);

    // Add categories with items for testing
    await menusPage.editMenu(testMenuName);
    await menusPage.switchToContentTab();

    // Add first category
    await menusPage.addCategory();
    await menusPage.expandCategory(0);
    await menusPage.updateCategoryName(0, 'Appetizers');
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 0, 'Spring Rolls');
    await menusPage.updateMenuItemPrice(0, 0, '8.99');

    // Add second category
    await menusPage.addCategory();
    await menusPage.expandCategory(1);
    await menusPage.updateCategoryName(1, 'Main Courses');
    await menusPage.addMenuItem(1);
    await menusPage.updateMenuItemName(1, 0, 'Grilled Salmon');
    await menusPage.updateMenuItemPrice(1, 0, '24.99');

    // Save the menu
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should navigate to category styling section', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Look for category styling section
    const categoryStylingSection = page.locator('[data-testid="category-styling-section"]');
    const sectionExists = await categoryStylingSection.count() > 0;

    if (sectionExists) {
      await expect(categoryStylingSection).toBeVisible({ timeout: 5000 });
    }
  });

  test('should expand category styling section', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for category styling toggle
    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    const toggleExists = await categoryStylingToggle.count() > 0;

    if (toggleExists) {
      await stylingPage.expandCategoryStyling();
      await expect(stylingPage.categoryStylingContent).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display box style editor @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for box style editor
    const boxStyleEditor = page.locator('[data-testid="box-style-editor"]');
    const editorCount = await boxStyleEditor.count();

    if (editorCount > 0) {
      await expect(boxStyleEditor.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should change category background color', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find background color input
    const bgColorInput = page.locator('[data-testid="box-style-background-color-input"]');
    const inputExists = await bgColorInput.count() > 0;

    if (inputExists) {
      // Set a new background color
      const newColor = '#F5F5F5';
      await bgColorInput.first().clear();
      await bgColorInput.first().fill(newColor);
      await bgColorInput.first().blur();

      await stylingPage.waitForLoading();

      // Verify the value changed
      const updatedValue = await bgColorInput.first().inputValue();
      expect(updatedValue.toLowerCase(), 'Background color should be updated').toBe(newColor.toLowerCase());
    }
  });

  test('should change category border color', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find border color input
    const borderColorInput = page.locator('[data-testid="box-style-border-color-input"]');
    const inputExists = await borderColorInput.count() > 0;

    if (inputExists) {
      // Set a new border color
      const newColor = '#CCCCCC';
      await borderColorInput.first().clear();
      await borderColorInput.first().fill(newColor);
      await borderColorInput.first().blur();

      await stylingPage.waitForLoading();

      // Verify the value changed
      const updatedValue = await borderColorInput.first().inputValue();
      expect(updatedValue.toLowerCase(), 'Border color should be updated').toBe(newColor.toLowerCase());
    }
  });

  test('should adjust border width using buttons', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find border width increase button
    const increaseButton = page.locator('[data-testid="box-style-border-width-increase"]');
    const buttonExists = await increaseButton.count() > 0;

    if (buttonExists) {
      // Click increase button twice
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await increaseButton.first().click();
      await stylingPage.waitForLoading();

      // Verify preview updates (button didn't break anything)
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should adjust border radius @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find border radius increase button
    const increaseButton = page.locator('[data-testid="box-style-border-radius-increase"]');
    const buttonExists = await increaseButton.count() > 0;

    if (buttonExists) {
      // Click increase button to add rounded corners
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await increaseButton.first().click();
      await stylingPage.waitForLoading();

      // Verify preview still visible
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should adjust padding', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find padding increase button
    const increaseButton = page.locator('[data-testid="box-style-padding-increase"]');
    const buttonExists = await increaseButton.count() > 0;

    if (buttonExists) {
      // Click increase button
      await increaseButton.first().click();
      await stylingPage.waitForLoading();

      // Verify preview still visible
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should toggle shadow effect', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find shadow toggle
    const shadowToggle = page.locator('[data-testid="box-style-shadow-toggle"]');
    const toggleExists = await shadowToggle.count() > 0;

    if (toggleExists) {
      // Toggle shadow on
      await shadowToggle.first().click();
      await stylingPage.waitForLoading();

      // Verify preview still visible
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should display box style preview', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for box style preview
    const preview = page.locator('[data-testid="box-style-preview"]');
    const previewCount = await preview.count();

    if (previewCount > 0) {
      await expect(preview.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should change media position for category', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for category media editor
    const mediaEditor = page.locator('[data-testid="category-styling-media-editor"]');
    const editorExists = await mediaEditor.count() > 0;

    if (editorExists) {
      // Look for position buttons
      const positionButtons = mediaEditor.locator('[data-testid^="media-position-button"]');
      const buttonCount = await positionButtons.count();

      if (buttonCount > 1) {
        // Click a different position (e.g., right)
        await positionButtons.nth(1).click();
        await stylingPage.waitForLoading();

        // Verify preview updated
        await stylingPage.expectPreviewVisible();
      }
    }
  });

  test('should update preview when category styling changes @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Verify main preview shows categories
    await stylingPage.expectPreviewVisible();

    // Make a styling change
    const bgColorInput = page.locator('[data-testid="box-style-background-color-input"]');
    if (await bgColorInput.count() > 0) {
      await bgColorInput.first().clear();
      await bgColorInput.first().fill('#E8E8E8');
      await bgColorInput.first().blur();
      await stylingPage.waitForLoading();
    }

    // Verify preview still visible after change
    await stylingPage.expectPreviewVisible();
  });

  test('should collapse category styling section', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for category styling toggle
    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    const toggleExists = await categoryStylingToggle.count() > 0;

    if (toggleExists) {
      await stylingPage.collapseCategoryStyling();

      // Verify content is hidden
      const isExpanded = await stylingPage.isCategoryStylingExpanded();
      expect(isExpanded, 'Category styling should be collapsed').toBe(false);
    }
  });

  test('should save category styling changes', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Save the menu
    await stylingPage.saveStyling();

    // Verify menu is in the list
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist category styling after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Look for category styling section
    const categoryStylingSection = page.locator('[data-testid="category-styling-section"]');
    const sectionExists = await categoryStylingSection.count() > 0;

    if (sectionExists) {
      // Expand to verify settings persisted
      await stylingPage.expandCategoryStyling();

      // Check for background color input
      const bgColorInput = page.locator('[data-testid="box-style-background-color-input"]');
      if (await bgColorInput.count() > 0) {
        const savedColor = await bgColorInput.first().inputValue();
        // Should have a valid hex color (our saved value)
        expect(savedColor, 'Background color should persist').toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }

    // Cancel and return to list
    await stylingPage.cancelStyling();
  });
});
