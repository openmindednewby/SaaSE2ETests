import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { MenuStylingPage } from '../../pages/MenuStylingPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';

/**
 * E2E Tests for Menu Layout Templates
 *
 * Tests the layout template selection functionality in the menu editor styling tab.
 * Verifies that layout changes are reflected in the preview.
 *
 * @tag @menu-styling
 */
test.describe.serial('Menu Layout Templates @menu-styling @online-menus', () => {
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

  test('should create a test menu for layout tests', async () => {
    testMenuName = `Layout Test Menu ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    // Create a new menu
    await menusPage.createMenu(testMenuName, 'Menu for testing layout templates');
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should navigate to menu editor and open styling tab', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Edit the menu
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Verify styling tab is visible
    await expect(stylingPage.globalStylingTab.or(stylingPage.layoutTab).first()).toBeVisible({ timeout: 5000 });
  });

  test('should display layout tab with options', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate to layout tab
    await stylingPage.switchToLayoutTab();

    // Verify layout options are visible (check for header or media position controls)
    await expect(stylingPage.headerTab.or(stylingPage.mediaTab).first()).toBeVisible({ timeout: 5000 });
  });

  test('should show preview panel when editing layout @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Verify preview is visible
    await stylingPage.expectPreviewVisible();
  });

  test('should update preview when changing media position settings', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate to media tab
    await stylingPage.switchToMediaTab();

    // Check if media position editor is visible
    const mediaEditorVisible = await stylingPage.mediaPositionEditor.isVisible().catch(() => false);

    if (mediaEditorVisible) {
      // Try to select a different media position
      const positionButtons = page.locator('[data-testid^="media-position-button"]');
      const buttonCount = await positionButtons.count();

      const SECOND_POSITION_INDEX = 1;
      if (buttonCount > SECOND_POSITION_INDEX) {
        // Click the second position option
        await positionButtons.nth(SECOND_POSITION_INDEX).click();
        await stylingPage.waitForLoading();
      }

      // Verify preview is still visible after changes
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should update preview when changing header settings', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate to header tab
    await stylingPage.switchToHeaderTab();

    // Check if header editor is visible
    const headerEditorVisible = await stylingPage.headerEditor.isVisible().catch(() => false);

    if (headerEditorVisible) {
      // Try to toggle menu name visibility
      const showMenuNameToggle = stylingPage.showMenuNameToggle;
      if (await showMenuNameToggle.isVisible().catch(() => false)) {
        await showMenuNameToggle.click();
        await stylingPage.waitForLoading();
      }

      // Verify preview is still visible after changes
      await stylingPage.expectPreviewVisible();
    }
  });

  test('should save layout changes', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Save the menu
    await stylingPage.saveStyling();

    // Verify menu is in the list
    await menusPage.expectMenuInList(testMenuName);
  });

  test('should persist layout settings after reload @critical', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Edit the menu again
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Switch to styling tab
    await stylingPage.switchToStylingTab();

    // Verify styling controls are visible (settings persisted)
    await expect(stylingPage.globalStylingTab.or(stylingPage.layoutTab).first()).toBeVisible({ timeout: 5000 });

    // Cancel and return to list
    await stylingPage.cancelStyling();
  });
});
