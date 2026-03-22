import { BrowserContext, expect, Page, test } from '@playwright/test';
import * as path from 'path';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';
import { OnlineMenusContentPage } from '../../pages/OnlineMenusContentPage.js';

/**
 * E2E Tests for Create Menu with Content
 *
 * Tests the two-step create process: create menu first, then update with contents.
 * This tests the bug fix where creating a new menu with category and image would
 * lose the category because the create API only supported name/description.
 */
test.describe('Create Menu with Category and Image @online-menus @content-upload', () => {
  test.setTimeout(180000); // 3 minutes for upload tests

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

    context = await browser.newContext();
    page = await context.newPage();

    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth)
        localStorage.setItem('persist:auth', persistAuth);
    });

    menusPage = new OnlineMenusPage(page);
    editorPage = new OnlineMenusEditorPage(page);
    contentPage = new OnlineMenusContentPage(page);
  });

  test.afterAll(async () => {
    // Cleanup: delete test menu if it exists
    try {
      await menusPage.goto();
      await menusPage.waitForLoading();

      if (testMenuName && await menusPage.menuExists(testMenuName)) {
        const isActive = await menusPage.isMenuActive(testMenuName);
        if (isActive)
          await menusPage.deactivateMenu(testMenuName);
        await menusPage.deleteMenu(testMenuName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  // eslint-disable-next-line no-empty-pattern
  test('create new menu with category and image persists correctly', async ({}, testInfo) => {
    test.skip(testInfo.project.name.includes('firefox'), 'Firefox file chooser handling is unreliable for image uploads');
    // This test verifies the bug fix for the two-step create process:
    // 1. Create menu (POST with name/description only)
    // 2. Immediately update with contents (PUT with categories/items)

    testMenuName = `Create With Content Test ${Date.now()}`;

    await menusPage.goto();
    await menusPage.waitForLoading();

    // Step 1: Create a new menu (just name, no description needed for this test)
    await menusPage.createMenu(testMenuName);
    await menusPage.expectMenuInList(testMenuName);

    // Step 2: Edit the menu to add a category with an image
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Add a category
    await editorPage.addCategory();
    await editorPage.expandCategory(0);

    // Set category name
    const categoryName = 'Test Category With Image';
    await editorPage.updateCategoryName(0, categoryName);

    // Upload an image to the category
    await contentPage.uploadImageToCategory(0, testImagePath);
    await contentPage.expectCategoryImageVisible(0);

    // Step 3: Save the menu
    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);

    // Step 4: Navigate away and back to force a fresh load
    await menusPage.goto();
    await menusPage.waitForLoading();

    // Step 5: Reopen the menu and verify category + image persisted
    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    // Expand the category
    await editorPage.expandCategory(0);

    // Firefox has issues with React Query state updates for dynamically loaded images
    const browserName = page.context().browser()?.browserType().name() ?? '';
    if (browserName === 'firefox') {
      await menusPage.goto();
      await menusPage.editMenu(testMenuName);
      await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });
      await editorPage.expandCategory(0);
    }

    // Verify the category name is correct
    const savedCategoryName = await editorPage.getCategoryNameValue(0);
    expect(savedCategoryName).toBe(categoryName);

    // Verify the category image is still present
    await contentPage.expectCategoryImageVisible(0);

    // Close the editor
    await editorPage.cancelMenuEditor();
  });
});
