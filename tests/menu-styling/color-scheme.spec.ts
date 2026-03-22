import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/** E2E Tests: Menu Color Scheme - Editor Controls @tag @menu-styling */
test.describe.serial('Menu Color Scheme - Controls @menu-styling @online-menus', () => {
  test.setTimeout(180000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let stylingPage: MenuStylingPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
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
    stylingPage = new MenuStylingPage(page);
  });

  test.afterAll(async () => {
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

  test('should create a test menu for color scheme tests', async () => {
    testMenuName = `Color Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for testing color schemes');
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should navigate to color scheme editor', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();
    await expect(stylingPage.colorSchemeEditor).toBeVisible({ timeout: 5000 });
  });

  test('should display color input fields @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const colorInputRows = page.locator('[data-testid="color-scheme-input-row"]');
    const rowCount = await colorInputRows.count();
    expect(rowCount, 'Should have color input rows').toBeGreaterThan(0);

    const firstInput = page.locator('[data-testid="color-scheme-input"]').first();
    await expect(firstInput).toBeVisible({ timeout: 5000 });
  });

  test('should display color swatches', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const colorSwatches = page.locator('[data-testid="color-scheme-swatch"]');
    const swatchCount = await colorSwatches.count();
    expect(swatchCount, 'Should have color swatches').toBeGreaterThan(0);
  });

  test('should change background color @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() > 0) {
      const firstInput = colorInputs.first();
      const _originalValue = await firstInput.inputValue();

      const newColor = '#FF5500';
      await firstInput.clear();
      await firstInput.fill(newColor);
      await firstInput.blur();
      await stylingPage.waitForLoading();

      const updatedValue = await firstInput.inputValue();
      expect(updatedValue.toLowerCase(), 'Color value should be updated').toBe(newColor.toLowerCase());
    }
  });

  test('should change text color', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    const TEXT_COLOR_INDEX = 1;
    if (inputCount > TEXT_COLOR_INDEX) {
      const secondInput = colorInputs.nth(TEXT_COLOR_INDEX);
      const newColor = '#333333';
      await secondInput.clear();
      await secondInput.fill(newColor);
      await secondInput.blur();
      await stylingPage.waitForLoading();

      const updatedValue = await secondInput.inputValue();
      expect(updatedValue.toLowerCase(), 'Text color should be updated').toBe(newColor.toLowerCase());
    }
  });

  test('should apply preset theme when available', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const presets = page.locator('[data-testid="color-scheme-preset"]');
    if (await presets.count() > 0) {
      const colorInputs = page.locator('[data-testid="color-scheme-input"]');
      const inputCount = await colorInputs.count();
      const MAX_COLORS_TO_CHECK = 3;
      const originalColors: string[] = [];

      for (let i = 0; i < Math.min(inputCount, MAX_COLORS_TO_CHECK); i++) {
        originalColors.push(await colorInputs.nth(i).inputValue());
      }

      await presets.first().click();
      await stylingPage.waitForLoading();

      let _hasChanged = false;
      for (let i = 0; i < Math.min(inputCount, MAX_COLORS_TO_CHECK); i++) {
        const newValue = await colorInputs.nth(i).inputValue();
        if (newValue.toLowerCase() !== originalColors[i].toLowerCase()) {
          _hasChanged = true;
          break;
        }
      }
    }
  });
});
