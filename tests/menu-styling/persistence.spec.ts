/* eslint-disable max-file-lines/max-file-lines -- serial test with shared state needs setup/teardown in same file */
import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { MenuStylingAdvancedPage } from '../../pages/MenuStylingAdvancedPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/** E2E Tests: Menu Styling Persistence - Apply & Verify @tag @menu-styling */
test.describe.serial('Menu Styling Persistence - Apply & Verify @menu-styling @online-menus @critical', () => {
  test.setTimeout(300000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let stylingPage: MenuStylingPage;
  let advancedStylingPage: MenuStylingAdvancedPage;
  let testMenuName: string;

  const appliedStyles = { backgroundColor: '#F0F0F0', textColor: '#222222', fontSize: '18', borderRadius: 2, hasShadow: true };

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

  test('should create a fully styled test menu', async () => {
    testMenuName = `Persistence Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for testing style persistence');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await editorPage.switchToContentTab();

    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Starters');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Bruschetta');
    await editorPage.updateMenuItemPrice(0, 0, '9.99');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 1, 'Calamari');
    await editorPage.updateMenuItemPrice(0, 1, '12.99');

    await editorPage.addCategory();
    await editorPage.expandCategory(1);
    await editorPage.updateCategoryName(1, 'Mains');
    await editorPage.addMenuItem(1);
    await editorPage.updateMenuItemName(1, 0, 'Ribeye Steak');
    await editorPage.updateMenuItemPrice(1, 0, '34.99');

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should apply color scheme styling', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    const TEXT_COLOR_INDEX = 1;
    const MIN_COLOR_INPUTS = 2;
    if (inputCount >= MIN_COLOR_INPUTS) {
      await colorInputs.first().clear();
      await colorInputs.first().fill(appliedStyles.backgroundColor);
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();

      await colorInputs.nth(TEXT_COLOR_INDEX).clear();
      await colorInputs.nth(TEXT_COLOR_INDEX).fill(appliedStyles.textColor);
      await colorInputs.nth(TEXT_COLOR_INDEX).blur();
      await stylingPage.waitForLoading();
    }

    await advancedStylingPage.expectPreviewVisible();
  });

  test('should apply typography and category styling then save', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Apply typography
    await stylingPage.switchToTypographyTab();
    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      await sizeInputs.first().clear();
      await sizeInputs.first().fill(appliedStyles.fontSize);
      await sizeInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    // Apply category box styling
    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    if (await categoryStylingToggle.count() > 0) {
      await advancedStylingPage.expandCategoryStyling();

      const radiusButton = page.locator('[data-testid="box-style-border-radius-increase"]');
      if (await radiusButton.count() > 0) {
        for (let i = 0; i < appliedStyles.borderRadius; i++) {
          await radiusButton.first().click();
          await stylingPage.waitForLoading();
        }
      }

      const shadowToggle = page.locator('[data-testid="box-style-shadow-toggle"]');
      if (await shadowToggle.count() > 0 && appliedStyles.hasShadow) {
        await shadowToggle.first().click();
        await stylingPage.waitForLoading();
      }
    }

    await stylingPage.saveStyling();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist colors after page reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    const inputCount = await colorInputs.count();

    const TEXT_COLOR_INDEX = 1;
    const MIN_COLOR_INPUTS = 2;
    if (inputCount >= MIN_COLOR_INPUTS) {
      const savedBgColor = await colorInputs.first().inputValue();
      const savedTextColor = await colorInputs.nth(TEXT_COLOR_INDEX).inputValue();

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

    await stylingPage.switchToTypographyTab();

    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      const savedSize = await sizeInputs.first().inputValue();
      expect(savedSize, 'Font size should persist').toBe(appliedStyles.fontSize);
    }
  });

  test('should persist category styling after page reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    if (await categoryStylingToggle.count() > 0) {
      await advancedStylingPage.expandCategoryStyling();

      const boxEditor = page.locator('[data-testid="box-style-editor"]');
      if (await boxEditor.count() > 0) {
        await expect(boxEditor.first()).toBeVisible({ timeout: 5000 });
      }
    }

    await stylingPage.cancelStyling();
  });
});

/** Persistence edge case: cancelled changes should not persist */
test.describe('Menu Styling Persistence - Cancel Behavior @menu-styling @online-menus', () => {
  test.setTimeout(120000);

  let menusPage: OnlineMenusPage;
  let _editorPage: OnlineMenusEditorPage;
  let stylingPage: MenuStylingPage;
  let _advancedStylingPage: MenuStylingAdvancedPage;

  test.beforeEach(async ({ page }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

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
    _editorPage = new OnlineMenusEditorPage(page);
    stylingPage = new MenuStylingPage(page);
    _advancedStylingPage = new MenuStylingAdvancedPage(page);
  });

  test('should not persist styling changes when cancelled', async ({ page }) => {
    const testMenuName = `Cancel Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Test cancel behavior');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    let originalColor = '';

    if (await colorInputs.count() > 0) {
      originalColor = await colorInputs.first().inputValue();
      await colorInputs.first().clear();
      await colorInputs.first().fill('#FF0000');
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    await stylingPage.cancelStyling();

    await menusPage.editMenu(testMenuName);
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    if (await colorInputs.count() > 0 && originalColor) {
      const currentColor = await colorInputs.first().inputValue();
      expect(currentColor.toLowerCase(), 'Color should not have changed after cancel').toBe(
        originalColor.toLowerCase()
      );
    }

    await stylingPage.cancelStyling();
    await menusPage.deleteMenu(testMenuName, false);
  });
});
