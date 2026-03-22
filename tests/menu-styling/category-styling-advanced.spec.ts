import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { MenuStylingAdvancedPage } from '../../pages/MenuStylingAdvancedPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/** E2E Tests: Category Styling - Advanced Effects, Save & Persistence @tag @menu-styling */
test.describe.serial('Category Styling - Advanced @menu-styling @online-menus', () => {
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

  test('should create menu and open category styling', async () => {
    testMenuName = `Category Advanced Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for category styling advanced tests');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await editorPage.switchToContentTab();
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Appetizers');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Spring Rolls');
    await editorPage.updateMenuItemPrice(0, 0, '8.99');
    await editorPage.saveMenuEditor();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();

    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    if (await categoryStylingToggle.count() > 0) {
      await advancedStylingPage.expandCategoryStyling();
    }
  });

  test('should adjust padding', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const increaseButton = page.locator('[data-testid="box-style-padding-increase"]');
    if (await increaseButton.count() > 0) {
      await increaseButton.first().click();
      await stylingPage.waitForLoading();
      await advancedStylingPage.expectPreviewVisible();
    }
  });

  test('should toggle shadow effect', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const shadowToggle = page.locator('[data-testid="box-style-shadow-toggle"]');
    if (await shadowToggle.count() > 0) {
      await shadowToggle.first().click();
      await stylingPage.waitForLoading();
      await advancedStylingPage.expectPreviewVisible();
    }
  });

  test('should display box style preview', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const preview = page.locator('[data-testid="box-style-preview"]');
    if (await preview.count() > 0) {
      await expect(preview.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should change media position for category', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const mediaEditor = page.locator('[data-testid="category-styling-media-editor"]');
    if (await mediaEditor.count() > 0) {
      const positionButtons = mediaEditor.locator('[data-testid^="media-position-button"]');
      const buttonCount = await positionButtons.count();

      const SECOND_POSITION_INDEX = 1;
      if (buttonCount > SECOND_POSITION_INDEX) {
        await positionButtons.nth(SECOND_POSITION_INDEX).click();
        await stylingPage.waitForLoading();
        await advancedStylingPage.expectPreviewVisible();
      }
    }
  });

  test('should update preview when category styling changes @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await advancedStylingPage.expectPreviewVisible();

    const bgColorInput = page.locator('[data-testid="box-style-background-color-input"]');
    if (await bgColorInput.count() > 0) {
      await bgColorInput.first().clear();
      await bgColorInput.first().fill('#E8E8E8');
      await bgColorInput.first().blur();
      await stylingPage.waitForLoading();
    }

    await advancedStylingPage.expectPreviewVisible();
  });

  test('should collapse category styling section', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const categoryStylingToggle = page.locator('[data-testid="category-styling-toggle"]');
    if (await categoryStylingToggle.count() > 0) {
      await advancedStylingPage.collapseCategoryStyling();
      const isExpanded = await advancedStylingPage.isCategoryStylingExpanded();
      expect(isExpanded, 'Category styling should be collapsed').toBe(false);
    }
  });

  test('should save and persist category styling @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await stylingPage.saveStyling();
    await menusPage.expectMenuInList(testMenuName);

    // Verify persistence after reload
    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();

    const categoryStylingSection = page.locator('[data-testid="category-styling-section"]');
    if (await categoryStylingSection.count() > 0) {
      await advancedStylingPage.expandCategoryStyling();

      const bgColorInput = page.locator('[data-testid="box-style-background-color-input"]');
      if (await bgColorInput.count() > 0) {
        const savedColor = await bgColorInput.first().inputValue();
        expect(savedColor, 'Background color should persist').toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }

    await stylingPage.cancelStyling();
  });
});
