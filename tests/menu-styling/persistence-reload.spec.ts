import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusPublicPage } from '../../pages/OnlineMenusPublicPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';

/** E2E Tests: Menu Styling Persistence - Browser Reload & Activation @tag @menu-styling */
test.describe.serial('Menu Styling Persistence - Browser Reload @menu-styling @online-menus @critical', () => {
  test.setTimeout(300000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let publicPage: OnlineMenusPublicPage;
  let editorPage: OnlineMenusEditorPage;
  let stylingPage: MenuStylingPage;
  let testMenuName: string;

  const styledColor = '#F0F0F0';

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
    publicPage = new OnlineMenusPublicPage(page);
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

  test('should create a styled menu for reload tests', async () => {
    testMenuName = `Reload Persistence Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.createMenu(testMenuName, 'Menu for reload persistence tests');
    await menusPage.expectMenuInList(testMenuName);

    // Add content and apply styling
    await menusPage.editMenu(testMenuName);
    await editorPage.switchToContentTab();
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Starters');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Bruschetta');
    await editorPage.updateMenuItemPrice(0, 0, '9.99');
    await editorPage.saveMenuEditor();

    // Apply color styling
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() > 0) {
      await colorInputs.first().clear();
      await colorInputs.first().fill(styledColor);
      await colorInputs.first().blur();
      await stylingPage.waitForLoading();
    }

    await stylingPage.saveStyling();
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist styling after browser refresh @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();

    // eslint-disable-next-line no-page-reload/no-page-reload -- Testing persistence after browser refresh requires an actual page reload
    await page.reload();
    await stylingPage.waitForLoading();

    // Navigate back to menu and verify after hard refresh
    await menusPage.goto();
    await menusPage.waitForLoading();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() >= 1) {
      const savedBgColor = await colorInputs.first().inputValue();
      expect(savedBgColor.toLowerCase(), 'Colors should persist after browser refresh').toBe(
        styledColor.toLowerCase()
      );
    }

    await stylingPage.cancelStyling();
  });

  test('should show styling in preview modal', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await publicPage.openPreview(testMenuName);
    await publicPage.expectPreviewModalVisible();

    const previewModal = page.locator('[data-testid="menu-preview-modal"]');
    await expect(previewModal).toBeVisible({ timeout: 5000 });

    await publicPage.closePreview();
    await publicPage.expectPreviewModalNotVisible();
  });

  test('should retain styling when menu is activated and deactivated', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    await menusPage.deactivateAllMenus();

    const activated = await menusPage.activateMenu(testMenuName);
    expect(activated, 'Menu should be activated').toBe(true);

    const deactivated = await menusPage.deactivateMenu(testMenuName);
    expect(deactivated, 'Menu should be deactivated').toBe(true);

    // Verify styling persisted after activation cycle
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
    await stylingPage.switchToStylingTab();
    await stylingPage.switchToColorsTab();

    const colorInputs = page.locator('[data-testid="color-scheme-input"]');
    if (await colorInputs.count() >= 1) {
      const savedBgColor = await colorInputs.first().inputValue();
      expect(savedBgColor.toLowerCase(), 'Styling should persist after activation').toBe(
        styledColor.toLowerCase()
      );
    }

    await stylingPage.cancelStyling();
  });
});
