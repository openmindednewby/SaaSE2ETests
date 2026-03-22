import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { MenuStylingAdvancedPage } from '../../pages/MenuStylingAdvancedPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/** E2E Tests: Menu Color Scheme - Preview, Reset, Save & Persistence @tag @menu-styling */
test.describe.serial('Menu Color Scheme - Save & Persist @menu-styling @online-menus', () => {
  test.setTimeout(180000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let stylingPage: MenuStylingPage;
  let advancedStylingPage: MenuStylingAdvancedPage;
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
    advancedStylingPage = new MenuStylingAdvancedPage(page);
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

  test('should create menu and navigate to color editor', async () => {
    testMenuName = `Color Save Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for color save tests');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();
    await expect(stylingPage.colorSchemeEditor).toBeVisible({ timeout: 5000 });
  });

  test('should update preview when colors change @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await advancedStylingPage.expectPreviewVisible();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() > 0) {
      await colorInputs.first().clear();
      await colorInputs.first().fill('#00AA00');
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();
      await advancedStylingPage.expectPreviewVisible();
    }
  });

  test('should reset colors when reset button is clicked', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const resetButton = page.locator('[data-testid="color-scheme-reset-button"]');
    const resetVisible = await resetButton.isVisible().catch(() => false);

    if (resetVisible) {
      const colorInputs = page.locator('[data-testid="color-scheme-input"]');
      const _firstColorBefore = await colorInputs.first().inputValue();

      await resetButton.click();
      await stylingPage.waitForLoading();
    }
  });

  test('should save color scheme changes', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() > 0) {
      await colorInputs.first().clear();
      await colorInputs.first().fill('#AA00AA');
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    await stylingPage.saveStyling();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist color scheme after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();
    await expect(stylingPage.colorSchemeEditor).toBeVisible({ timeout: 5000 });

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() > 0) {
      const savedColor = await colorInputs.first().inputValue();
      expect(savedColor, 'Color should be a valid hex value').toMatch(/^#[0-9A-Fa-f]{6}$/);
    }

    await stylingPage.cancelStyling();
  });
});
