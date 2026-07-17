import type { Locator, Page } from '@playwright/test';

/**
 * Ceiling for a heavy write round-trip (create-save → the editor transitioning into edit-mode and
 * the image uploader mounting). Well under the suite's 30s per-test cap; a web-first wait returns
 * the instant the condition is met, so this only engages when staging is slow under full-suite load.
 */
const SAVE_ROUNDTRIP_MS = 15_000;

/**
 * Page object for the Agora merchant admin (agora-web), served same-origin by bff-agora.
 *
 * Ids come from agora-web/src/shared/testIds.ts plus the shared kit's own stable ids
 * (`@dloizides/ui-tables` emits `<table>-row-<id>-<col>`; `@dloizides/auth-web`'s
 * <LoginForm> derives `agora-auth-login-*` from its prefix).
 */
export class AgoraAdminPage {
  readonly page: Page;

  // Login
  readonly loginPage: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginSubmit: Locator;

  // Chrome
  readonly adminShell: Locator;
  readonly navProducts: Locator;
  readonly navCategories: Locator;
  readonly navCoupons: Locator;
  readonly navOrders: Locator;
  readonly navSettings: Locator;

  // Products
  readonly productsScreen: Locator;
  readonly productsTable: Locator;
  readonly productsSearch: Locator;
  readonly productAddButton: Locator;

  // Product editor
  readonly productEditorScreen: Locator;
  readonly productNameInput: Locator;
  readonly productDescriptionInput: Locator;
  readonly productSaveButton: Locator;
  readonly variantPrice0: Locator;
  readonly variantStock0: Locator;
  readonly productImages: Locator;
  readonly productImageUpload: Locator;

  // Coupons
  readonly couponsScreen: Locator;
  readonly couponAddButton: Locator;
  readonly couponCodeInput: Locator;
  readonly couponValueInput: Locator;
  readonly couponSaveButton: Locator;

  // Orders
  readonly ordersScreen: Locator;
  readonly ordersTable: Locator;
  readonly ordersEmpty: Locator;
  readonly ordersStatusFilter: Locator;
  readonly orderDetailScreen: Locator;
  readonly orderFulfilButton: Locator;
  readonly orderRefundButton: Locator;
  readonly orderNoActions: Locator;

  // Settings
  readonly settingsScreen: Locator;
  readonly publishToggle: Locator;
  readonly publishBlockedNotice: Locator;

  // Settings → Payments (Stripe connection)
  readonly stripeCard: Locator;
  readonly stripeSecretInput: Locator;
  readonly stripeWebhookSecretInput: Locator;
  readonly stripePaymentsSwitch: Locator;
  readonly stripeSaveButton: Locator;
  readonly stripeSaveError: Locator;
  readonly stripeDisconnectButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.loginPage = page.getByTestId('agora-login-page');
    this.usernameInput = page.getByTestId('agora-auth-login-username');
    this.passwordInput = page.getByTestId('agora-auth-login-password');
    this.loginSubmit = page.getByTestId('agora-auth-login-submit');

    this.adminShell = page.getByTestId('agora-admin-shell');
    this.navProducts = page.getByTestId('nav-products');
    this.navCategories = page.getByTestId('nav-categories');
    this.navCoupons = page.getByTestId('nav-coupons');
    this.navOrders = page.getByTestId('nav-orders');
    this.navSettings = page.getByTestId('nav-settings');

    this.productsScreen = page.getByTestId('agora-products-screen');
    this.productsTable = page.getByTestId('products-table');
    // The shared declarative `<Filters>` bar (ui-tables 1.11.0) wraps each field in a
    // labelled shell: the `products-search` id is on the wrapper View; the fillable
    // <input> carries the `-input` suffix.
    this.productsSearch = page.getByTestId('products-search-input');
    this.productAddButton = page.getByTestId('product-add-button');

    this.productEditorScreen = page.getByTestId('agora-product-editor-screen');
    this.productNameInput = page.getByTestId('product-name-input');
    this.productDescriptionInput = page.getByTestId('product-description-input');
    this.productSaveButton = page.getByTestId('product-save-button');
    this.variantPrice0 = page.getByTestId('variant-price-0');
    this.variantStock0 = page.getByTestId('variant-stock-0');
    // The uploader only renders once the product EXISTS (an image needs a product id to attach
    // to), so it is absent on the "new product" form and appears after the first save.
    this.productImages = page.getByTestId('product-images');
    this.productImageUpload = page.getByTestId('product-image-upload');

    this.couponsScreen = page.getByTestId('agora-coupons-screen');
    this.couponAddButton = page.getByTestId('coupon-add-button');
    this.couponCodeInput = page.getByTestId('coupon-code-input');
    this.couponValueInput = page.getByTestId('coupon-value-input');
    this.couponSaveButton = page.getByTestId('coupon-save-button');

    this.ordersScreen = page.getByTestId('agora-orders-screen');
    this.ordersTable = page.getByTestId('orders-table');
    this.ordersEmpty = page.getByTestId('orders-empty');
    this.ordersStatusFilter = page.getByTestId('orders-status-filter');
    this.orderDetailScreen = page.getByTestId('agora-order-detail-screen');
    this.orderFulfilButton = page.getByTestId('order-fulfil-button');
    this.orderRefundButton = page.getByTestId('order-refund-button');
    this.orderNoActions = page.getByTestId('order-no-actions');

    this.settingsScreen = page.getByTestId('agora-settings-screen');
    this.publishToggle = page.getByTestId('publish-toggle');
    this.publishBlockedNotice = page.getByTestId('shop-publish-blocked');

    this.stripeCard = page.getByTestId('stripe-card');
    this.stripeSecretInput = page.getByTestId('stripe-secret-input');
    this.stripeWebhookSecretInput = page.getByTestId('stripe-webhook-secret-input');
    this.stripePaymentsSwitch = page.getByTestId('stripe-payments-switch');
    this.stripeSaveButton = page.getByTestId('stripe-save-button');
    this.stripeSaveError = page.getByTestId('stripe-save-error');
    this.stripeDisconnectButton = page.getByTestId('stripe-disconnect-button');
  }

  /** Log in through the REAL BFF form (ROPC server-side; no token ever reaches the browser). */
  async login(username: string, password: string): Promise<void> {
    await this.page.goto('/');
    // Wait for the form to actually mount before typing. The SPA is served by a pod that may be
    // cold (a fresh rollout), and the login route also has to bounce through /bff/me first — so
    // the input can legitimately take a few seconds to appear. Without this, `fill` races the
    // mount and fails with a 10s timeout that looks like a broken login but is just a cold start.
    await this.usernameInput.waitFor({ state: 'visible', timeout: 60_000 });
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginSubmit.click();
    // The shell only mounts once the BFF session cookie is set and /bff/me returns 200. Give it the
    // SAME 60s the username input gets: on a cold pod/BFF the post-login /bff/me round-trip is the
    // very same cold-start, and a 30s cap here was the flake that timed out this hook on a cold
    // staging pod (agora-orders.ui / agora-admin.ui login) while the input's own 60s wait passed.
    await this.adminShell.waitFor({ state: 'visible', timeout: 60_000 });
  }

  /**
   * Create a product from the "New product" editor and return the id the server assigned.
   *
   * On the first save the editor does NOT return to the list — it switches to "Edit product" on the
   * freshly-created row and the image uploader (which needs a product id to attach to) appears, so
   * the id is now the last URL segment. Shared by the create-with-image test and the edit/stock
   * test, which each add their own assertions on top of this arrange step.
   */
  async createProduct(fields: {
    name: string;
    price: string;
    description?: string;
    stock?: string;
  }): Promise<string> {
    await this.navProducts.click();
    await this.productsScreen.waitFor({ state: 'visible' });
    await this.productAddButton.click();
    await this.productEditorScreen.waitFor({ state: 'visible' });

    await this.productNameInput.fill(fields.name);
    if (fields.description !== undefined) {
      await this.productDescriptionInput.fill(fields.description);
    }
    await this.variantPrice0.fill(fields.price);
    if (fields.stock !== undefined) {
      await this.variantStock0.fill(fields.stock);
    }
    await this.productSaveButton.click();

    // The uploader only mounts once the product EXISTS, so its appearance IS the save-completed
    // signal. Explicit ceiling: this server round-trip + editor transition is the heavy step.
    await this.productImageUpload.waitFor({ state: 'visible', timeout: SAVE_ROUNDTRIP_MS });
    return new URL(this.page.url()).pathname.split('/').pop() ?? '';
  }

  /**
   * Filter the grid down to one product by name.
   *
   * Necessary, not cosmetic: the grid pages at 25 rows, so asserting "my new product is in the
   * list" by looking at the default page is a time-bomb that passes on an empty shop and starts
   * failing the moment the shop has >25 products.
   */
  async searchProducts(term: string): Promise<void> {
    await this.productsSearch.fill(term);
  }

  /**
   * Attach an image to the product currently open in the editor.
   *
   * The uploader is an RN-Web control, so the real <input type=file> is hidden behind the
   * visible "Upload image" button — `setInputFiles` on the hidden input is the correct,
   * non-flaky way to drive it (a click would open the OS file dialog, which Playwright cannot
   * dismiss).
   */
  async uploadProductImage(filePath: string): Promise<void> {
    await this.page.locator('input[type="file"]').first().setInputFiles(filePath);
  }

  /** The row for a product, by the id the API returned. */
  productRow(productId: string): Locator {
    return this.page.getByTestId(`products-table-row-${productId}`);
  }

  productRowName(productId: string): Locator {
    return this.page.getByTestId(`products-table-row-${productId}-name`);
  }

  productEditButton(productId: string): Locator {
    return this.page.getByTestId(`product-edit-${productId}`);
  }

  /** Inline stock field on the products grid. */
  productStockInput(productId: string): Locator {
    return this.page.getByTestId(`product-stock-${productId}`);
  }

  couponRowCode(couponId: string): Locator {
    return this.page.getByTestId(`coupons-table-row-${couponId}-code`);
  }
}

export default AgoraAdminPage;
