import { BrowserContext, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { StudioProductsPage } from '../../pages/StudioProductsPage.js';

/**
 * E2E Tests for Products Pages - CORS / API Fix
 *
 * Verifies Bug 3 fix: The axios client hit `https://dummyjson.com` directly,
 * causing CORS failures on localhost. The fix added a Vite proxy
 * (`/dummyjson` -> `https://dummyjson.com`) and changed the baseURL
 * to `/dummyjson`.
 *
 * Tests verify:
 * - Native Products page loads and displays product data (not an error state)
 * - Syncfusion Products page loads and displays product data
 * - Products actually appear (product names, grid rows)
 * - Category filters are rendered when data loads
 *
 * @tag @showcase @products @bug-fix
 */

// =============================================================================
// Native Products Page Tests
// =============================================================================

test.describe.serial('Native Products Page @showcase @products @bug-fix', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let productsPage: StudioProductsPage;

  test.beforeAll(async ({ browser }, testInfo) => {
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
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    productsPage = new StudioProductsPage(page);
    await productsPage.gotoNativeProducts();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should load native products page without CORS error @critical', async () => {
    await productsPage.expectNativePageLoaded();
    await productsPage.expectNoErrorState();
  });

  test('should display product data in the native grid @critical', async () => {
    // The key assertion: products are actually rendered in the grid.
    // Before the CORS fix, the API call would fail and show an error state.
    await productsPage.expectNativeProductsDisplayed();
  });

  test('should display a products heading', async () => {
    await productsPage.expectProductsHeadingVisible();
  });

  test('should display category filter buttons when data is loaded', async () => {
    await productsPage.expectCategoryFilterVisible();
  });
});

// =============================================================================
// Syncfusion Products Page Tests
// =============================================================================

test.describe.serial('Syncfusion Products Page @showcase @products @bug-fix', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let productsPage: StudioProductsPage;

  test.beforeAll(async ({ browser }, testInfo) => {
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
      if (persistAuth) localStorage.setItem('persist:auth', persistAuth);
    });

    productsPage = new StudioProductsPage(page);
    await productsPage.gotoSyncfusionProducts();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should load syncfusion products page without CORS error @critical', async () => {
    await productsPage.expectNoErrorState();
  });

  test('should display product data in the Syncfusion grid @critical', async () => {
    // The key assertion: products are actually rendered in the grid.
    // Before the CORS fix, the API call would fail and show an error state.
    await productsPage.expectSyncfusionProductsDisplayed();
  });

  test('should display a products heading', async () => {
    await productsPage.expectProductsHeadingVisible();
  });

  test('should display category filter buttons when data is loaded', async () => {
    await productsPage.expectCategoryFilterVisible();
  });
});
