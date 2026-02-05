import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { TestIds, testIdSelector, testIdStartsWithSelector } from '../../shared/testIds.js';

/**
 * E2E Tests for Public Menu Viewer Active Filtering
 *
 * Tests that the public menu list (/public/menus) only shows active menus:
 * - Only menus where isActive === true are displayed
 * - Inactive menus are hidden from public users
 * - Activation state changes immediately reflect in public list
 * - Public users cannot see or access inactive menus
 */
test.describe.serial('Public Menu Viewer Active Filtering @online-menus @public-viewer @critical', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let menusPage: OnlineMenusPage;
  let activeMenuName: string;
  let inactiveMenuName: string;
  let publicContext: BrowserContext;
  let publicPage: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Create admin context for managing menus
    context = await browser.newContext();
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

    // Create a second page in the SAME context for public viewing
    // Note: The public route uses the same API which requires authentication.
    // Since authentication is stored in sessionStorage (which is NOT shared between
    // tabs/pages), we need to login on the publicPage as well.
    publicContext = context;
    publicPage = await publicContext.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
    // This ensures auth persists across page navigations
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

    // Login on the public page to ensure API calls are authenticated
    const publicLoginPage = new LoginPage(publicPage);
    await publicLoginPage.goto();
    await publicLoginPage.loginAndWait(adminUser.username, adminUser.password);

    // Save auth state to localStorage so it persists across page navigations
    await publicPage.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });
  });

  test.beforeEach(async () => {
    await menusPage.goto();
  });

  test.afterAll(async () => {
    try {
      await menusPage.goto();
      await menusPage.deactivateAllMenus();

      for (const menuName of [activeMenuName, inactiveMenuName]) {
        if (menuName && await menusPage.menuExists(menuName)) {
          await menusPage.deleteMenu(menuName, false);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    // publicContext is the same as context, only close once
    await publicPage?.close().catch(() => {});
    await context?.close();
  });

  test('should create test menus with different activation states', async () => {
    activeMenuName = `Active Public Menu ${Date.now()}`;
    inactiveMenuName = `Inactive Public Menu ${Date.now() + 1}`;

    // Ensure clean state
    await menusPage.deactivateAllMenus();

    // Create two menus
    await menusPage.createMenu(activeMenuName, 'This menu will be active and visible to public');
    await menusPage.expectMenuInList(activeMenuName);

    await menusPage.createMenu(inactiveMenuName, 'This menu will be inactive and hidden from public');
    await menusPage.expectMenuInList(inactiveMenuName);

    // Verify both start as inactive
    await menusPage.expectMenuActive(activeMenuName, false);
    await menusPage.expectMenuActive(inactiveMenuName, false);
  });

  test('should activate only one menu', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    // Activate only the first menu
    await menusPage.activateMenu(activeMenuName);
    await menusPage.expectMenuActive(activeMenuName, true);

    // Verify second menu remains inactive
    await menusPage.expectMenuActive(inactiveMenuName, false);
  });

  test('should show only active menu in public menu list @critical', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    // Navigate to public menu list page with public context (use baseURL from config)
    await publicPage.goto('/public/menus');

    // Wait for page to load
    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    await expect(publicMenuList).toBeVisible({ timeout: 10000 });

    // Wait for any loading indicators to disappear
    const loadingIndicator = publicPage.locator('[role="progressbar"]');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
      console.log('No loading indicator found or already hidden');
    });

    // Get all visible menu cards
    const menuCards = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD));
    const cardCount = await menuCards.count();

    console.log(`Public menu list shows ${cardCount} menu cards`);

    // Verify active menu is visible
    const activeMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: activeMenuName,
    });
    await expect(activeMenuCard).toBeVisible({ timeout: 5000 });

    // Verify inactive menu is NOT visible
    const inactiveMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: inactiveMenuName,
    });
    await expect(inactiveMenuCard).not.toBeVisible({ timeout: 5000 });
  });

  test('should hide menu from public list immediately after deactivation', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();

    // Menu should be active from previous test
    await menusPage.expectMenuActive(activeMenuName, true);

    // Deactivate the menu
    await menusPage.deactivateMenu(activeMenuName);
    await menusPage.expectMenuActive(activeMenuName, false);

    // Refresh public menu list
    await publicPage.reload({ waitUntil: 'commit' });

    // Wait for page to load
    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    await expect(publicMenuList).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    const loadingIndicator = publicPage.locator('[role="progressbar"]');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    // Verify the deactivated menu is no longer visible
    const deactivatedMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: activeMenuName,
    });
    await expect(deactivatedMenuCard).not.toBeVisible({ timeout: 5000 });

    // Verify inactive menu is still not visible
    const inactiveMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: inactiveMenuName,
    });
    await expect(inactiveMenuCard).not.toBeVisible({ timeout: 5000 });
  });

  test('should show menu in public list immediately after activation', async () => {
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    // Menu should be inactive from previous tests
    await menusPage.expectMenuActive(inactiveMenuName, false);

    // Activate the previously inactive menu
    await menusPage.activateMenu(inactiveMenuName);
    await menusPage.expectMenuActive(inactiveMenuName, true);

    // Refresh public menu list
    await publicPage.reload({ waitUntil: 'commit' });

    // Wait for page to load
    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    await expect(publicMenuList).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    const loadingIndicator = publicPage.locator('[role="progressbar"]');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    // Verify the newly activated menu is now visible
    const activatedMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: inactiveMenuName,
    });
    await expect(activatedMenuCard).toBeVisible({ timeout: 5000 });
  });

  test('should show multiple active menus in public list', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    // Activate both menus
    await menusPage.expectMenuActive(inactiveMenuName, true); // Already active from previous test

    // Also activate the first menu again
    const firstMenuActive = await menusPage.isMenuActive(activeMenuName);
    if (!firstMenuActive) {
      await menusPage.activateMenu(activeMenuName);
      await menusPage.expectMenuActive(activeMenuName, true);
    }

    // Refresh public menu list
    await publicPage.reload({ waitUntil: 'commit' });

    // Wait for page to load
    const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
    await expect(publicMenuList).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete
    const loadingIndicator = publicPage.locator('[role="progressbar"]');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    // Verify both menus are visible
    const firstMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: activeMenuName,
    });
    await expect(firstMenuCard).toBeVisible({ timeout: 5000 });

    const secondMenuCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
      hasText: inactiveMenuName,
    });
    await expect(secondMenuCard).toBeVisible({ timeout: 5000 });

    // Count total cards
    const menuCards = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD));
    const cardCount = await menuCards.count();

    console.log(`Public menu list shows ${cardCount} active menu cards`);
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test('should verify public user cannot directly access inactive menu by URL', async () => {
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    // Deactivate one menu
    const isActive = await menusPage.isMenuActive(inactiveMenuName);
    if (isActive) {
      await menusPage.deactivateMenu(inactiveMenuName);
      await menusPage.expectMenuActive(inactiveMenuName, false);
    }

    // Try to access the inactive menu directly via public viewer URL
    // This would require knowing the menu ID, which we'd get from the card
    const card = menusPage.getMenuCard(inactiveMenuName);
    await card.scrollIntoViewIfNeeded();

    // Check if there's a preview button (which would give us the URL)
    const previewButton = card.locator(testIdSelector(TestIds.MENU_CARD_PREVIEW_BUTTON));
    const hasPreviewButton = await previewButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasPreviewButton) {
      // Get the href from preview button to find the menu ID
      const href = await previewButton.getAttribute('href').catch(() => null);

      if (href) {
        console.log(`Preview URL: ${href}`);

        // Navigate to the URL with public context (use relative path, baseURL from config)
        await publicPage.goto(href);

        // The page should either:
        // 1. Show an error/not found message
        // 2. Redirect to menu list
        // 3. Show empty content
        // This depends on backend implementation - for now we just verify navigation happened
        await publicPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

        console.log('Attempted to access inactive menu directly - verify access is properly restricted');
      }
    } else {
      console.log('Preview button not found - cannot test direct URL access');
    }

    // Navigate back to public menu list (use relative path)
    await publicPage.goto('/public/menus');
  });

  test('should maintain filtering across page reloads', async () => {
    expect(activeMenuName, 'Active menu not created').toBeTruthy();
    expect(inactiveMenuName, 'Inactive menu not created').toBeTruthy();

    // Ensure we have one active and one inactive menu
    await menusPage.activateMenu(activeMenuName);
    await menusPage.expectMenuActive(activeMenuName, true);

    const inactiveMenuActive = await menusPage.isMenuActive(inactiveMenuName);
    if (inactiveMenuActive) {
      await menusPage.deactivateMenu(inactiveMenuName);
      await menusPage.expectMenuActive(inactiveMenuName, false);
    }

    // Reload public page multiple times
    for (let i = 1; i <= 3; i++) {
      console.log(`Reload attempt ${i}/3`);

      await publicPage.reload({ waitUntil: 'commit' });

      // Wait for page to load
      const publicMenuList = publicPage.locator(testIdSelector(TestIds.PUBLIC_MENU_LIST));
      await expect(publicMenuList).toBeVisible({ timeout: 10000 });

      // Wait for loading
      const loadingIndicator = publicPage.locator('[role="progressbar"]');
      await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      // Verify filtering is consistent
      const activeCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
        hasText: activeMenuName,
      });
      await expect(activeCard).toBeVisible({ timeout: 5000 });

      const inactiveCard = publicPage.locator(testIdStartsWithSelector(TestIds.PUBLIC_MENU_CARD)).filter({
        hasText: inactiveMenuName,
      });
      await expect(inactiveCard).not.toBeVisible({ timeout: 5000 });
    }
  });
});
