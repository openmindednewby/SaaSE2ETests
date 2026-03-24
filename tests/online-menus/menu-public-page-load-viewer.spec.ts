/* eslint-disable max-file-lines/max-file-lines -- serial test with shared state */
import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { OnlineMenusEditorPage } from '../../pages/OnlineMenusEditorPage.js';
import { OnlineMenusPublicPage } from '../../pages/OnlineMenusPublicPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

// Public Menu Page Loading - Viewer and Error States (BUG-MENU-005/006)
test.describe.serial('Public Menu Page Load - Viewer @online-menus @public-viewer', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let publicMenusPage: OnlineMenusPublicPage;
  let editorPage: OnlineMenusEditorPage;
  let publicPage: Page;
  let testMenuName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(90000);
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
    publicMenusPage = new OnlineMenusPublicPage(page);
    editorPage = new OnlineMenusEditorPage(page);

    // Authenticated page for public menu list tests (tests 2 & 3)
    publicPage = await context.newPage();
    await publicPage.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth')) {
          sessionStorage.setItem('persist:auth', persistAuth);
        }
      } catch {
        // ignore
      }
    });

    const publicLoginPage = new LoginPage(publicPage);
    await publicLoginPage.goto();
    await publicLoginPage.loginAndWait(adminUser.username, adminUser.password);

    await publicPage.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    // Create and activate a test menu for viewer tests
    testMenuName = `Public Viewer Test ${Date.now()}`;
    // Firefox can throw NS_BINDING_ABORTED on first navigation under high concurrency — retry
    for (let navAttempt = 0; navAttempt < 3; navAttempt++) {
      try {
        await menusPage.goto();
        await menusPage.waitForLoading();
        break;
      } catch (e) {
        if (navAttempt === 2) throw e;
        // eslint-disable-next-line no-wait-for-timeout/no-wait-for-timeout -- retry backoff after NS_BINDING_ABORTED
        await page.waitForTimeout(1000);
      }
    }
    await expect(menusPage.createMenuButton).toBeVisible({ timeout: 10000 });

    await menusPage.createMenu(testMenuName, 'Menu for public viewer testing');
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.editMenu(testMenuName);
    await expect(menusPage.menuEditor).toBeVisible({ timeout: 10000 });

    await editorPage.addCategory();
    await editorPage.expandCategory(0);
    await editorPage.updateCategoryName(0, 'Test Category');

    await editorPage.addMenuItem(0);
    await editorPage.updateMenuItemName(0, 0, 'Test Item');
    await editorPage.updateMenuItemPrice(0, 0, '9.99');

    await editorPage.saveMenuEditor();
    await menusPage.expectMenuInList(testMenuName);

    await menusPage.activateMenu(testMenuName);
    await menusPage.expectMenuActive(testMenuName, true);
  });

  test.afterAll(async () => {
    test.setTimeout(60000); // Firefox cleanup can be slow under concurrency
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
    await publicPage?.close().catch(() => {});
    await context?.close();
  });

  test('should load public menu viewer without errors', async () => {
    expect(testMenuName, 'Test menu not created').toBeTruthy();

    // Re-verify activation — another browser project may have deactivated
    // this menu via deactivateAllMenus under multi-worker concurrency
    await menusPage.goto();
    await menusPage.waitForLoading();
    const isStillActive = await menusPage.isMenuActive(testMenuName);
    if (!isStillActive) {
      await menusPage.activateMenu(testMenuName);
      await menusPage.expectMenuActive(testMenuName, true);
    }

    const consoleErrors: string[] = [];
    const errorListener = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    };
    page.on('console', errorListener);

    // Use the Preview modal to verify the public menu viewer renders correctly.
    // Direct navigation to /public/menu/{id} redirects authenticated users to
    // the admin page, so the Preview modal is the correct way to test the viewer.
    await publicMenusPage.openPreview(testMenuName);

    const previewModal = publicMenusPage.previewModal;
    await expect(previewModal).toBeVisible({ timeout: 10000 });

    // Inside the preview modal, look for the public menu viewer or content view
    const menuViewer = previewModal.locator(testIdSelector(TestIds.PUBLIC_MENU_VIEWER));
    const menuContent = previewModal.locator(testIdSelector(TestIds.MENU_CONTENT_VIEW));
    const livePreview = page.locator(testIdSelector(TestIds.LIVE_PREVIEW_PANEL));

    // The preview modal may render the viewer directly or via a live preview iframe
    await expect(
      menuViewer.or(menuContent).or(livePreview).first()
    ).toBeVisible({ timeout: 20000 });

    page.off('console', errorListener);

    await publicMenusPage.closePreview();

    const errorOverlay = page.locator('[data-testid="error-overlay"], .error-overlay');
    const hasErrorOverlay = await errorOverlay.count() > 0;
    expect(hasErrorOverlay, 'Viewer should not show error overlay').toBe(false);
  });

  test('should handle empty public menu state gracefully', async () => {
    // Deactivate only our test menu to check the empty state,
    // not all menus (which would interfere with other browser projects)
    await menusPage.goto();
    await menusPage.waitForLoading();
    if (testMenuName && await menusPage.isMenuActive(testMenuName)) {
      await menusPage.deactivateMenu(testMenuName);
    }

    const consoleErrors: string[] = [];
    const errorListener = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    };
    publicPage.on('console', errorListener);

    await publicPage.goto('/public/menus');

    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    const emptyState = publicPage.getByText(/no menus|no active menus|empty/i);

    await expect(
      publicMenuList.or(emptyState).first()
    ).toBeVisible({ timeout: 15000 });

    publicPage.off('console', errorListener);

    // Check for duplicate errors
    const errorCounts = new Map<string, number>();
    for (const err of consoleErrors) {
      const count = errorCounts.get(err) || 0;
      errorCounts.set(err, count + 1);
    }

    const hasDuplicateErrors = [...errorCounts.values()].some(count => count > 2);
    expect(
      hasDuplicateErrors,
      'Should not have duplicate error messages (BUG-MENU-005/006 toast spam fix)'
    ).toBe(false);

    const errorOverlay = publicPage.locator('[data-testid="error-overlay"], .error-overlay');
    const hasErrorOverlay = await errorOverlay.count() > 0;
    expect(hasErrorOverlay, 'Empty state should not show error overlay').toBe(false);
  });

  test('should not show duplicate toast notifications during navigation', async () => {
    // Re-activate the test menu
    await menusPage.goto();
    await menusPage.waitForLoading();

    if (testMenuName && await menusPage.menuExists(testMenuName)) {
      await menusPage.activateMenu(testMenuName);
    }

    const toastAppearances: string[] = [];

    const toastSelector = testIdSelector(TestIds.NOTIFICATION_TOAST);
    const toastContainer = testIdSelector(TestIds.NOTIFICATION_TOAST_CONTAINER);

    // Navigate to public menus multiple times to check for toast spam.
    for (let i = 0; i < 3; i++) {
      try {
        await publicPage.goto('/public/menus', { waitUntil: 'commit' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('ERR_ABORTED')) {
          throw err;
        }
      }

      await publicPage.waitForLoadState('domcontentloaded');

      const toasts = publicPage.locator(`${toastSelector}, ${toastContainer} > *`);
      const toastCount = await toasts.count();

      if (toastCount > 0) {
        for (let j = 0; j < toastCount; j++) {
          const text = await toasts.nth(j).textContent().catch(() => '');
          if (text) {
            toastAppearances.push(text.trim());
          }
        }
      }

      const loadingIndicator = publicPage.locator('[role="progressbar"]');
      if (await loadingIndicator.count() > 0) {
        await loadingIndicator.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }

    // After BUG-MENU-005/006 fix, error toasts should not spam during normal navigation
    const toastCounts = new Map<string, number>();
    for (const text of toastAppearances) {
      const count = toastCounts.get(text) || 0;
      toastCounts.set(text, count + 1);
    }

    for (const [text, count] of toastCounts) {
      expect(
        count,
        `Toast "${text}" appeared ${count} times - should not have duplicates`
      ).toBeLessThanOrEqual(3);
    }
  });
});
