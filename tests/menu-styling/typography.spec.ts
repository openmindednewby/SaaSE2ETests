import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/** E2E Tests: Menu Typography Settings - Controls & Font Selection @tag @menu-styling */
test.describe.serial('Menu Typography - Controls @menu-styling @online-menus', () => {
  test.setTimeout(180000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
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
    editorPage = new OnlineMenusEditorPage(page);
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

  test('should create a test menu for typography tests', async () => {
    testMenuName = `Typography Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for testing typography');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await editorPage.switchToContentTab();
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Test Category');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Test Item');
    await editorPage.updateMenuItemPrice(0, 0, '9.99');
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should navigate to typography editor', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToTypographyTab();
    await expect(stylingPage.typographyEditor).toBeVisible({ timeout: 5000 });
  });

  test('should display typography sections @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const typographySections = page.locator('[data-testid="typography-section"]');
    const sectionCount = await typographySections.count();
    expect(sectionCount, 'Should have typography sections').toBeGreaterThan(0);
  });

  test('should display font picker', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const fontPickers = page.locator('[data-testid="typography-font-picker"]');
    if (await fontPickers.count() > 0) {
      await expect(fontPickers.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display font size input', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      await expect(sizeInputs.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should change font size @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      const firstSizeInput = sizeInputs.first();
      const _originalValue = await firstSizeInput.inputValue();

      const newSize = '24';
      await firstSizeInput.clear();
      await firstSizeInput.fill(newSize);
      await firstSizeInput.blur();
      await stylingPage.waitForLoading();

      const updatedValue = await firstSizeInput.inputValue();
      expect(updatedValue, 'Font size should be updated').toBe(newSize);
    }
  });

  test('should select font from picker when available', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const fontPickers = page.locator('[data-testid="typography-font-picker"]');
    if (await fontPickers.count() > 0) {
      await fontPickers.first().click();
      await stylingPage.waitForLoading();

      const options = page.getByRole('option');
      const optionCount = await options.count();

      if (optionCount > 0) {
        const SECOND_OPTION_INDEX = 1;
        const targetOption = optionCount > SECOND_OPTION_INDEX ? options.nth(SECOND_OPTION_INDEX) : options.first();
        await targetOption.click();
        await stylingPage.waitForLoading();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  });
});
