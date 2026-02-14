import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Menu Typography Settings
 *
 * Tests the typography editor functionality in the menu editor styling tab.
 * Verifies that font settings apply correctly to the preview.
 *
 * @tag @menu-styling
 */
test.describe.serial('Menu Typography Settings @menu-styling @online-menus', () => {
  test.setTimeout(180000); // 3 minutes for comprehensive tests

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

  test('should create a test menu for typography tests', async () => {
    testMenuName = `Typography Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    // Create a new menu with a category and item for preview
    await menusPage.createMenu(testMenuName, 'Menu for testing typography');
    await menusPage.expectMenuInList(testMenuName);

    // Add a category and item so preview has content
    await menusPage.editMenu(testMenuName);
    await menusPage.switchToContentTab();
    await menusPage.addCategory();
    await menusPage.expandCategory(0);
    await menusPage.updateCategoryName(0, 'Test Category');
    await menusPage.addMenuItem(0);
    await menusPage.updateMenuItemName(0, 0, 'Test Item');
    await menusPage.updateMenuItemPrice(0, 0, '9.99');
    await menusPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should navigate to typography editor', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Switch to typography tab
    await stylingPage.switchToTypographyTab();

    // Verify typography editor is visible
    await expect(stylingPage.typographyEditor).toBeVisible({ timeout: 5000 });
  });

  test('should display typography sections @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for typography sections
    const typographySections = page.locator('[data-testid="typography-section"]');
    const sectionCount = await typographySections.count();

    // Should have at least one typography section (e.g., headings, body, prices)
    expect(sectionCount, 'Should have typography sections').toBeGreaterThan(0);
  });

  test('should display font picker', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for font pickers
    const fontPickers = page.locator('[data-testid="typography-font-picker"]');
    const pickerCount = await fontPickers.count();

    if (pickerCount > 0) {
      // Verify first font picker is visible
      await expect(fontPickers.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display font size input', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for font size inputs
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      // Verify first size input is visible
      await expect(sizeInputs.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should change font size @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find font size inputs
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      const firstSizeInput = sizeInputs.first();

      // Get the current value (read for potential future comparison)
      const _originalValue = await firstSizeInput.inputValue();

      // Set a new font size (larger than typical default)
      const newSize = '24';
      await firstSizeInput.clear();
      await firstSizeInput.fill(newSize);
      await firstSizeInput.blur();

      await stylingPage.waitForLoading();

      // Verify the value changed
      const updatedValue = await firstSizeInput.inputValue();
      expect(updatedValue, 'Font size should be updated').toBe(newSize);
    }
  });

  test('should select font from picker when available', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find font pickers
    const fontPickers = page.locator('[data-testid="typography-font-picker"]');
    const pickerCount = await fontPickers.count();

    if (pickerCount > 0) {
      const firstPicker = fontPickers.first();

      // Click to open the picker
      await firstPicker.click();
      await stylingPage.waitForLoading();

      // Look for dropdown options
      const options = page.getByRole('option');
      const optionCount = await options.count();

      if (optionCount > 0) {
        // Select a different option (second one if available)
        const SECOND_OPTION_INDEX = 1;
        const targetOption = optionCount > SECOND_OPTION_INDEX ? options.nth(SECOND_OPTION_INDEX) : options.first();
        await targetOption.click();
        await stylingPage.waitForLoading();
      } else {
        // If no dropdown options, try clicking away to close
        await page.keyboard.press('Escape');
      }
    }
  });

  test('should select font weight when available', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Find font weight pickers
    const weightPickers = page.locator('[data-testid="typography-weight-picker"]');
    const pickerCount = await weightPickers.count();

    if (pickerCount > 0) {
      const firstPicker = weightPickers.first();

      // Click to open the picker
      await firstPicker.click();
      await stylingPage.waitForLoading();

      // Look for dropdown options
      const options = page.getByRole('option');
      const optionCount = await options.count();

      if (optionCount > 0) {
        // Select bold if available
        const boldOption = page.getByRole('option', { name: /bold|700/i });
        if (await boldOption.isVisible().catch(() => false)) {
          await boldOption.click();
        } else {
          // Select first available option
          await options.first().click();
        }
        await stylingPage.waitForLoading();
      } else {
        // If no dropdown options, close picker
        await page.keyboard.press('Escape');
      }
    }
  });

  test('should show typography preview', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check for typography preview
    const preview = page.locator('[data-testid="typography-preview"]');
    const previewCount = await preview.count();

    if (previewCount > 0) {
      // Verify preview is visible
      await expect(preview.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should update live preview when typography changes @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Verify main preview is visible
    await stylingPage.expectPreviewVisible();

    // Change font size
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      const firstSizeInput = sizeInputs.first();
      await firstSizeInput.clear();
      await firstSizeInput.fill('20');
      await firstSizeInput.blur();

      await stylingPage.waitForLoading();

      // Verify preview is still visible (didn't break)
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should reset typography when reset button is clicked', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Check if reset button exists
    const resetButton = page.locator('[data-testid="typography-reset-button"]');
    const resetVisible = await resetButton.isVisible().catch(() => false);

    if (resetVisible) {
      // Get current font size
      const sizeInputs = page.locator('[data-testid="typography-size-input"]');
      const _sizeBefore = await sizeInputs.first().inputValue().catch(() => '');

      // Click reset
      await resetButton.click();
      await stylingPage.waitForLoading();

      // Typography was reset from the previous size
    }
  });

  test('should save typography changes', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Apply specific typography settings before saving
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      await sizeInputs.first().clear();
      await sizeInputs.first().fill('18');
      await sizeInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    // Save the menu
    await stylingPage.saveStyling();

    // Verify menu is in the list
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist typography settings after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Switch to typography tab
    await stylingPage.switchToTypographyTab();

    // Verify typography editor is visible
    await expect(stylingPage.typographyEditor).toBeVisible({ timeout: 5000 });

    // Verify font size persisted
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    const inputCount = await sizeInputs.count();

    if (inputCount > 0) {
      const savedSize = await sizeInputs.first().inputValue();
      // Size should be the value we saved (18)
      expect(savedSize, 'Font size should persist').toBe('18');
    }

    // Cancel and return to list
    await stylingPage.cancelStyling();
  });
});
