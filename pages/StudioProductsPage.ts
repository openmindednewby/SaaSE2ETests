import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

const NATIVE_PRODUCTS_ROUTE = '/dashboard/products/native';
const SYNCFUSION_PRODUCTS_ROUTE = '/dashboard/products/syncfusion';
const PAGE_LOAD_TIMEOUT = 15000;
const PRODUCT_DATA_TIMEOUT = 20000;
const MIN_EXPECTED_PRODUCTS = 1;

/**
 * Page object for the SyncfusionThemeStudio Products pages.
 * Handles both the Native Products page and the Syncfusion Products page.
 *
 * Both pages fetch product data from the dummyjson API (via Vite proxy)
 * and display it in a data grid with category filters.
 */
export class StudioProductsPage extends BasePage {
  // Native Products page
  readonly nativeProductsContainer: Locator;
  readonly nativeProductsGrid: Locator;

  // Syncfusion Products page
  readonly syncfusionProductsGrid: Locator;

  // Common elements
  readonly categoryFilter: Locator;
  readonly retryButton: Locator;
  readonly loadingSpinner: Locator;

  constructor(page: Page) {
    super(page);
    this.nativeProductsContainer = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_PRODUCTS_PAGE));
    this.nativeProductsGrid = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_PRODUCTS_GRID));
    this.syncfusionProductsGrid = page.locator(testIdSelector(TestIds.STUDIO_PRODUCTS_GRID));
    this.categoryFilter = page.locator(testIdSelector(TestIds.STUDIO_PRODUCTS_CATEGORY_FILTER));
    this.retryButton = page.locator(testIdSelector(TestIds.STUDIO_BTN_RETRY));
    this.loadingSpinner = page.locator('.loading-spinner, [role="progressbar"]');
  }

  // ==================== NAVIGATION ====================

  /**
   * Navigate to the Native Products page.
   */
  async gotoNativeProducts() {
    await super.goto(NATIVE_PRODUCTS_ROUTE);
    await this.waitForProductsLoad();
  }

  /**
   * Navigate to the Syncfusion Products page.
   */
  async gotoSyncfusionProducts() {
    await super.goto(SYNCFUSION_PRODUCTS_ROUTE);
    await this.waitForProductsLoad();
  }

  // ==================== WAIT HELPERS ====================

  /**
   * Wait for products data to load (loading spinner disappears and content appears).
   */
  async waitForProductsLoad() {
    // Wait for either a grid or error state to appear (data loaded or failed)
    const gridOrError = this.page.locator(
      `${testIdSelector(TestIds.STUDIO_NATIVE_PRODUCTS_GRID)}, ` +
      `${testIdSelector(TestIds.STUDIO_PRODUCTS_GRID)}, ` +
      `${testIdSelector(TestIds.STUDIO_BTN_RETRY)}, ` +
      'table, .e-grid'
    );
    await expect(gridOrError.first()).toBeVisible({ timeout: PRODUCT_DATA_TIMEOUT });
  }

  // ==================== ASSERTION METHODS ====================

  /**
   * Expect the Native Products page container to be visible.
   */
  async expectNativePageLoaded() {
    await expect(this.nativeProductsContainer).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  }

  /**
   * Expect product data to be displayed in the native products grid.
   * Verifies the CORS fix by checking that actual product rows are rendered.
   */
  async expectNativeProductsDisplayed() {
    // The native grid uses a <table> element with data rows
    const tableRows = this.nativeProductsGrid.locator('tbody tr');
    const rowCount = await tableRows.count();
    expect(
      rowCount,
      'Native products grid should display at least one product row'
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_PRODUCTS);
  }

  /**
   * Expect product data to be displayed in the Syncfusion products grid.
   * Verifies the CORS fix by checking that actual product rows are rendered.
   */
  async expectSyncfusionProductsDisplayed() {
    // Syncfusion DataGrid renders rows in .e-row elements or table rows
    const gridRows = this.syncfusionProductsGrid.locator('.e-row, tbody tr');
    const rowCount = await gridRows.count();
    expect(
      rowCount,
      'Syncfusion products grid should display at least one product row'
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_PRODUCTS);
  }

  /**
   * Expect that category filter buttons are visible.
   */
  async expectCategoryFilterVisible() {
    await expect(this.categoryFilter).toBeVisible();
  }

  /**
   * Expect the retry button is NOT visible (meaning products loaded successfully).
   */
  async expectNoErrorState() {
    const retryCount = await this.retryButton.count();
    expect(retryCount, 'Retry button should not be visible when products load successfully').toBe(0);
  }

  /**
   * Expect that no error state is shown and products are visible on the native page.
   */
  async expectNativeProductsLoadedSuccessfully() {
    await this.expectNativePageLoaded();
    await this.expectNoErrorState();
    await this.expectNativeProductsDisplayed();
  }

  /**
   * Expect that no error state is shown and products are visible on the Syncfusion page.
   */
  async expectSyncfusionProductsLoadedSuccessfully() {
    await this.expectNoErrorState();
    await this.expectSyncfusionProductsDisplayed();
  }

  /**
   * Expect a page heading containing "Products" text is visible.
   */
  async expectProductsHeadingVisible() {
    const heading = this.page.locator('h2').filter({ hasText: /products/i });
    await expect(heading).toBeVisible();
  }

  // ==================== ACTION METHODS ====================

  /**
   * Click a category filter button by its label text.
   */
  async selectCategoryFilter(label: string) {
    const button = this.categoryFilter.getByRole('button', { name: label });
    await button.click();
  }
}
