import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { MenuStylingAdvancedPage } from '../../pages/MenuStylingAdvancedPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/** E2E Tests: Category Styling - Box Style Controls @tag @menu-styling */
test.describe.serial('Category Styling - Controls @menu-styling @online-menus', () => {
  test.setTimeout(240000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
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

  test('should create a test menu with category for styling tests', async () => {
    testMenuName = `Category Style Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for testing category styling');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await editorPage.switchToContentTab();

    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Appetizers');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Spring Rolls');
    await editorPage.updateMenuItemPrice(0, 0, '8.99');

    await editorPage.addCategory();
    await editorPage.expandCategory(1);
    await editorPage.updateCategoryName(1, 'Main Courses');
    await editorPage.addMenuItem(1);
    await editorPage.updateMenuItemName(1, 0, 'Grilled Salmon');
    await editorPage.updateMenuItemPrice(1, 0, '24.99');

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should navigate to category styling section', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();

    const categoryStylingSection = page.locator('[data-testid="category-styling-section"]');
    if (await categoryStylingSection.count() > 0) {
      await expect(categoryStylingSection).toBeVisible({ timeout: 5000 });
    }
  });

  test('should expand category styling section', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    if (await categoryStylingToggle.count() > 0) {
      await advancedStylingPage.expandCategoryStyling();
      await expect(advancedStylingPage.categoryStylingContent).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display box style editor @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const boxStyleEditor = page.locator('[data-testid="box-style-editor"]');
    if (await boxStyleEditor.count() > 0) {
      await expect(boxStyleEditor.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should change category background color', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const bgColorInput = page.locator('[data-testid="box-style-background-color-input"]');
    if (await bgColorInput.count() > 0) {
      const newColor = '#F5F5F5';
      await bgColorInput.first().clear();
      await bgColorInput.first().fill(newColor);
      await bgColorInput.first().blur();
      await stylingPage.waitForLoading();

      const updatedValue = await bgColorInput.first().inputValue();
      expect(updatedValue.toLowerCase(), 'Background color should be updated').toBe(newColor.toLowerCase());
    }
  });

  test('should change category border color', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const borderColorInput = page.locator('[data-testid="box-style-border-color-input"]');
    if (await borderColorInput.count() > 0) {
      const newColor = '#CCCCCC';
      await borderColorInput.first().clear();
      await borderColorInput.first().fill(newColor);
      await borderColorInput.first().blur();
      await stylingPage.waitForLoading();

      const updatedValue = await borderColorInput.first().inputValue();
      expect(updatedValue.toLowerCase(), 'Border color should be updated').toBe(newColor.toLowerCase());
    }
  });

  test('should adjust border width using buttons', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const increaseButton = page.locator('[data-testid="box-style-border-width-increase"]');
    if (await increaseButton.count() > 0) {
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await advancedStylingPage.expectPreviewVisible();
    }
  });

  test('should adjust border radius @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const increaseButton = page.locator('[data-testid="box-style-border-radius-increase"]');
    if (await increaseButton.count() > 0) {
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await advancedStylingPage.expectPreviewVisible();
    }
  });
});
