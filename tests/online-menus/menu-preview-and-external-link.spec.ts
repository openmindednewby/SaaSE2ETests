import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusPublicPage } from '../../pages/OnlineMenusPublicPage.js';

/**
 * E2E Tests for Menu Preview and Open External Link Features
 *
 * Tests the new menu card actions:
 * - Preview button: Opens a modal showing the menu preview
 * - Open External Link button: Opens the public menu URL in a new tab (active menus only)
 */
test.describe.serial('Menu Preview and External Link @online-menus @preview', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let publicPage: OnlineMenusPublicPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Create a new browser context for this test suite
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
    // This ensures auth persists across page navigations
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

    // Login as tenant admin
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

    // Initialize page objects
    menusPage = new OnlineMenusPage(page);
    publicPage = new OnlineMenusPublicPage(page);
  });

  test.beforeEach(async () => {
    await menusPage.goto();
  });

  test.afterAll(async () => {
    test.setTimeout(60000); // Firefox cleanup can be slow under concurrency
    // Cleanup - deactivate first if active, then delete
    try {
      await menusPage.goto();
      await menusPage.deactivateAllMenus();
      if (testMenuName && await menusPage.menuExists(testMenuName)) {
        await menusPage.deleteMenu(testMenuName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create menu for preview and external link tests', async () => {
    testMenuName = `Preview Test Menu ${Date.now()}`;
    await menusPage.createMenu(testMenuName, 'Menu for testing preview and external link');
    await menusPage.expectMenuInList(testMenuName);

    // New menus should be inactive by default
    await menusPage.expectMenuActive(testMenuName, false);
  });

  // ============================================
  // Preview Modal Tests
  // ============================================

  test('should open preview modal when clicking preview button on inactive menu', async () => {
    expect(testMenuName, 'Test menu name not set; did the create test run?').toBeTruthy();
    await menusPage.expectMenuInList(testMenuName);

    // Ensure menu is inactive
    await menusPage.expectMenuActive(testMenuName, false);

    // Click preview button
    await publicPage.openPreview(testMenuName);

    // Verify modal is visible
    await publicPage.expectPreviewModalVisible();
  });

  test('should show menu name in preview modal', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Open preview (modal may still be open from previous test, but let's ensure it's open)
    const previewBtn = publicPage.getPreviewButton(testMenuName);

    // Close any existing modal first
    if (await publicPage.previewModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await publicPage.closePreview();
    }

    await previewBtn.click();
    await publicPage.expectPreviewModalVisible();

    // Verify the menu name appears in the modal
    await expect(publicPage.previewModal).toContainText(testMenuName, { timeout: 5000 });
  });

  test('should close preview modal when clicking close button', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Open preview if not already open
    if (!await publicPage.previewModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await publicPage.openPreview(testMenuName);
      await publicPage.expectPreviewModalVisible();
    }

    // Close the modal
    await publicPage.closePreview();

    // Verify modal is closed
    await publicPage.expectPreviewModalNotVisible();
  });

  test('should open preview modal for active menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Activate the menu
    await menusPage.activateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, true);

    // Open preview
    await publicPage.openPreview(testMenuName);

    // Verify modal is visible
    await publicPage.expectPreviewModalVisible();

    // Close the modal
    await publicPage.closePreview();
    await publicPage.expectPreviewModalNotVisible();
  });

  // ============================================
  // Open External Link Tests
  // ============================================

  test('should have open external button enabled for active menu @critical', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Ensure menu is active (should still be active from previous test)
    const isActive = await menusPage.isMenuActive(testMenuName);
    if (!isActive) {
      await menusPage.activateMenu(testMenuName);
      await menusPage.expectMenuActive(testMenuName, true);
    }

    // Check that the open external button is enabled
    const isEnabled = await publicPage.isOpenExternalButtonEnabled(testMenuName);
    expect(isEnabled, 'Open external button should be enabled for active menu').toBe(true);
  });

  test('should open new tab with public menu URL when clicking open external on active menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Ensure menu is active
    const isActive = await menusPage.isMenuActive(testMenuName);
    if (!isActive) {
      await menusPage.activateMenu(testMenuName);
      await menusPage.expectMenuActive(testMenuName, true);
    }

    // Click open external and get the new page
    const newPage = await publicPage.openExternalLink(testMenuName);

    // Verify a new tab was opened
    expect(newPage, 'New tab should open when clicking open external on active menu').not.toBeNull();

    if (newPage) {
      // Verify the URL contains the expected pattern for public menu
      const url = newPage.url();
      expect(url).toMatch(/\/public\/menu\//);

      // Close the new tab
      await newPage.close();
    }
  });

  test('should have open external button disabled for inactive menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Deactivate the menu
    await menusPage.deactivateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, false);

    // Check that the open external button is disabled
    const isEnabled = await publicPage.isOpenExternalButtonEnabled(testMenuName);
    expect(isEnabled, 'Open external button should be disabled for inactive menu').toBe(false);
  });

  test('should not open new tab when clicking open external on inactive menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Ensure menu is inactive (should still be inactive from previous test)
    await menusPage.expectMenuActive(testMenuName, false);

    // Try to click open external
    const newPage = await publicPage.openExternalLink(testMenuName);

    // Verify no new tab was opened
    expect(newPage, 'No new tab should open when clicking open external on inactive menu').toBeNull();
  });

  // ============================================
  // Combined Workflow Tests
  // ============================================

  test('should allow preview and external link after activating menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Activate the menu
    await menusPage.activateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, true);

    // Test preview works
    await publicPage.openPreview(testMenuName);
    await publicPage.expectPreviewModalVisible();
    await publicPage.closePreview();
    await publicPage.expectPreviewModalNotVisible();

    // Test external link works
    const newPage = await publicPage.openExternalLink(testMenuName);
    expect(newPage, 'External link should work for active menu').not.toBeNull();

    if (newPage) {
      await newPage.close();
    }
  });

  test('should disable external link but keep preview after deactivating menu', async () => {
    expect(testMenuName, 'Test menu name not set').toBeTruthy();

    // Deactivate the menu
    await menusPage.deactivateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, false);

    // Test preview still works for inactive menu
    await publicPage.openPreview(testMenuName);
    await publicPage.expectPreviewModalVisible();
    await publicPage.closePreview();
    await publicPage.expectPreviewModalNotVisible();

    // Test external link is disabled for inactive menu
    const isEnabled = await publicPage.isOpenExternalButtonEnabled(testMenuName);
    expect(isEnabled, 'Open external should be disabled after deactivation').toBe(false);
  });
});
