import { BrowserContext, expect, Page, test } from '@playwright/test';
import * as path from 'path';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';
import { OnlineMenusContentPage } from '../../pages/OnlineMenusContentPage.js';

/**
 * E2E Tests for Upload Error Handling
 *
 * These tests verify proper error handling during content upload.
 */
test.describe('Menu Content Upload Error Handling @online-menus @content-upload', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let contentPage: OnlineMenusContentPage;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
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
    contentPage = new OnlineMenusContentPage(page);

    // Create a test menu for error handling tests
    testMenuName = `Error Handling Test ${Date.now()}`;
    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Menu for testing error handling');
    await menusPage.editMenu(testMenuName);
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Error Test Category');
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Error Test Item');
    await editorPage.saveMenuEditor();
  });

  test.afterAll(async () => {
    test.setTimeout(60000); // Firefox cleanup can be slow under concurrency
    // Cleanup
    try {
      await menusPage.goto();
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

  test('should handle cancelled file selection gracefully', async () => {
    // Edit the menu
    await menusPage.goto();
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Expand the category
    await editorPage.expandCategory(0);

    // Get the image picker
    const imagePicker = contentPage.getMenuItemImagePicker(0, 0);
    const uploadButton = imagePicker.locator('[data-testid="content-uploader-button"]');

    // Verify upload button is visible
    await expect(uploadButton).toBeVisible({ timeout: 5000 });

    // Set up file chooser listener that will cancel
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });

    // Click upload button
    await uploadButton.click();

    // Cancel the file chooser by setting no files
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([]); // Empty array cancels selection

    // Verify upload button is still visible (no crash)
    await expect(uploadButton).toBeVisible({ timeout: 5000 });

    // Verify no error message appeared
    const errorMessage = imagePicker.locator('[data-testid="content-uploader-error"]');
    await expect(errorMessage).not.toBeVisible({ timeout: 2000 });

    // Cancel the editor
    await editorPage.cancelMenuEditor();
  });
});

/**
 * E2E Tests for Multiple Image Uploads
 *
 * Tests uploading images to multiple menu items and categories.
 */
test.describe('Multiple Content Uploads @online-menus @content-upload', () => {
  test.setTimeout(240000); // 4 minutes for multiple uploads

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let editorPage: OnlineMenusEditorPage;
  let contentPage: OnlineMenusContentPage;
  let testMenuName: string;

  const testImagePath = path.resolve(__dirname, '..', '..', 'fixtures', 'files', 'test-image.png');

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
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
    contentPage = new OnlineMenusContentPage(page);
  });

  test.afterAll(async () => {
    test.setTimeout(60000); // Firefox cleanup can be slow under concurrency
    // Cleanup
    try {
      await menusPage.goto();
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

  // eslint-disable-next-line no-empty-pattern
  test('should upload images to multiple menu items', async ({}, testInfo) => {
    test.skip(testInfo.project.name.includes('firefox'), 'Firefox file chooser handling is unreliable for image uploads');
    testMenuName = `Multiple Uploads Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.createMenu(testMenuName, 'Menu for testing multiple uploads');

    // Edit and add structure
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add a category
    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Multi-Upload Category');

    // Add multiple menu items
    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Item 1');
    await editorPage.updateMenuItemPrice(0, 0, '10.00');

    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 1, 'Item 2');
    await editorPage.updateMenuItemPrice(0, 1, '15.00');

    // Upload images to both items
    await contentPage.uploadImageToMenuItem(0, 0, testImagePath);
    await contentPage.expectMenuItemImageVisible(0, 0);

    await contentPage.uploadImageToMenuItem(0, 1, testImagePath);
    await contentPage.expectMenuItemImageVisible(0, 1);

    // Also upload an image to the category
    await contentPage.uploadImageToCategory(0, testImagePath);
    await contentPage.expectCategoryImageVisible(0);

    // Save the menu
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);

    // Reload and verify all images persisted
    await menusPage.editMenu(testMenuName);
    await editorPage.expandCategory(0);

    // Firefox has issues with React Query state updates for dynamically loaded images
    const browserName = page.context().browser()?.browserType().name() ?? '';
    if (browserName === 'firefox') {
      await menusPage.goto();
      await menusPage.editMenu(testMenuName);
      await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
      await editorPage.expandCategory(0);
    }

    // Verify images are visible
    await contentPage.expectMenuItemImageVisible(0, 0);
    await contentPage.expectMenuItemImageVisible(0, 1);
    await contentPage.expectCategoryImageVisible(0);

    // On Firefox, React Native Web has inconsistent rendering for multiple concurrent images
    if (browserName !== 'firefox') {
      await contentPage.expectImageLoaded(0, 0);
      await contentPage.expectImageLoaded(0, 1);
    }

    // Cancel without changes
    await editorPage.cancelMenuEditor();
  });
});
