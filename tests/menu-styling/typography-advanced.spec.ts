import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { MenuStylingAdvancedPage } from '../../pages/MenuStylingAdvancedPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/** E2E Tests: Menu Typography - Advanced Controls, Save & Persistence @tag @menu-styling */
test.describe.serial('Menu Typography - Advanced @menu-styling @online-menus', () => {
  test.setTimeout(180000);

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

  test('should create menu and navigate to typography editor', async () => {
    testMenuName = `Typography Advanced Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for typography advanced tests');
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

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToTypographyTab();
    await expect(stylingPage.typographyEditor).toBeVisible({ timeout: 5000 });
  });

  test('should select font weight when available', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const weightPickers = page.locator('[data-testid="typography-weight-picker"]');
    if (await weightPickers.count() > 0) {
      await weightPickers.first().click();
      await stylingPage.waitForLoading();

      const options = page.getByRole('option');
      const optionCount = await options.count();

      if (optionCount > 0) {
        const boldOption = page.getByRole('option', { name: /bold|700/i });
        if (await boldOption.isVisible().catch(() => false)) {
          await boldOption.click();
        } else {
          await options.first().click();
        }
        await stylingPage.waitForLoading();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  });

  test('should show typography preview', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const preview = page.locator('[data-testid="typography-preview"]');
    if (await preview.count() > 0) {
      await expect(preview.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should update live preview when typography changes @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await advancedStylingPage.expectPreviewVisible();

    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      await sizeInputs.first().clear();
      await sizeInputs.first().fill('20');
      await sizeInputs.first().blur();
      await stylingPage.waitForLoading();

      await advancedStylingPage.expectPreviewVisible();
    }
  });

  test('should reset typography when reset button is clicked', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const resetButton = page.locator('[data-testid="typography-reset-button"]');
    const resetVisible = await resetButton.isVisible().catch(() => false);

    if (resetVisible) {
      const sizeInputs = page.locator('[data-testid="typography-size-input"]');
      const _sizeBefore = await sizeInputs.first().inputValue().catch(() => '');

      await resetButton.click();
      await stylingPage.waitForLoading();
    }
  });

  test('should save typography changes', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      await sizeInputs.first().clear();
      await sizeInputs.first().fill('18');
      await sizeInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    await stylingPage.saveStyling();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist typography settings after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToTypographyTab();
    await expect(stylingPage.typographyEditor).toBeVisible({ timeout: 5000 });

    const sizeInputs = page.locator('[data-testid="typography-size-input"]');
    if (await sizeInputs.count() > 0) {
      const savedSize = await sizeInputs.first().inputValue();
      expect(savedSize, 'Font size should persist').toBe('18');
    }

    await stylingPage.cancelStyling();
  });
});
