// Agora merchant admin — @ui tier: the real click-through, in a real browser, against the
// DEPLOYED app (bff-agora serves the SPA same-origin at AGORA_WEB_URL).
//
// The journey the ES-04 brief names:
//   log in -> create a product -> it appears in the list -> edit it -> stock to 0 -> create a coupon
//
// This tier exists because the @api tier cannot see what a merchant sees. ES-04's screens had
// never been opened in a browser, and the first time they were, the app was broken in ways no
// unit test or API test could catch: agora-web's TypeScript contract did not match the server at
// all (13 mismatches), and the shared DataTable rendered every product row with
// pointer-events:none, so Edit/Delete were visible, styled, and un-clickable.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AgoraAdminPage } from '../../pages/agora/AgoraAdminPage.js';
import { AGORA_WEB_URL, MERCHANT_A, uniqueSuffixUi } from './agora-ui-helpers.js';

const PRODUCT_PRICE = '24.50';
const INITIAL_STOCK = '11';

// Heavy write round-trips (create-save → editor transition, image upload → thumbnail render) hit
// the server AND re-navigate the SPA. The global 5s expect default is fine alone, but under
// full-suite staging load these legitimately take longer — so the specific write-transition
// assertions get an explicit ceiling. Still well under the deliberate 30s per-test cap (each test
// runs ~14s alone); the web-first assertion returns the instant the condition is met, so this only
// engages when staging is slow, exactly like the login helper's explicit cold-start waits.
const SAVE_ROUNDTRIP_MS = 15_000;

// Playwright always runs with cwd = the E2ETests root (where playwright.config.ts lives), so a
// cwd-relative path is stable. `import.meta.url` is NOT usable here — the repo's TS module
// setting transpiles these specs in a way that makes it blow up at load time.
const IMAGE_FIXTURE = path.join(process.cwd(), 'fixtures', 'files', 'test-image.png');

test.describe('Agora merchant admin @agora-ui @ui', () => {
  let admin: AgoraAdminPage;

  test.beforeEach(async ({ page }) => {
    const password = process.env.AGORA_TEST_PASSWORD?.trim();
    test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL unset — the merchant admin is not reachable');
    test.skip(!password, 'AGORA_TEST_PASSWORD unset');

    admin = new AgoraAdminPage(page);
    await admin.login(MERCHANT_A, password as string);
  });

  test('merchant can log in and reach the dashboard', async ({ page }) => {
    // The single most important assertion in the whole suite for a brand-new product:
    // a real human, in a real browser, gets past the real Keycloak.
    await expect(admin.adminShell).toBeVisible();
    await expect(page.getByTestId('agora-dashboard-screen')).toBeVisible();
    // The BFF session is a __Host- cookie: HttpOnly + Secure. The access token must never be
    // readable from JS — that is the entire point of the BFF pattern.
    const tokenInJs = await page.evaluate(
      () => window.localStorage.getItem('access_token') ?? window.sessionStorage.getItem('access_token'),
    );
    expect(tokenInJs, 'no access token may be reachable from JS').toBeNull();
  });

  test('the publish button is DISABLED until Stripe is connected', async () => {
    // A shop that could go live without payment credentials would take orders it can never
    // charge for. `POST /shop/publish` 409s (ES-06 owns Stripe), and the UI must not even let
    // the merchant fire it. Assert the control is genuinely inert, not merely styled grey.
    await admin.navSettings.click();
    await expect(admin.settingsScreen).toBeVisible();

    await expect(admin.publishToggle).toBeVisible();
    await expect(admin.publishToggle).toBeDisabled();
    await expect(admin.publishBlockedNotice).toBeVisible();
  });

  // The ES-04 brief's journey — create+image -> appears-in-list -> edit -> stock-to-0 -> coupon —
  // used to be ONE 7-step mega-test. Run alone it passed (~15s), but in the FULL agora suite the
  // cumulative SPA/staging latency (image upload is heavy, and the beforeEach login shares the 30s
  // per-test budget) made the chain of ~6 sequential write round-trips race the deliberate 30s cap.
  // It is split into four atomic tests — create-with-image, edit-name, set-sold-out, and the
  // independent coupon — each self-contained and comfortably under 30s, with every original
  // assertion preserved across them. Products are created via the shared
  // AgoraAdminPage.createProduct() arrange step so each test brings its own fixture.

  test('create a product with an image -> it appears in the list', async ({ page }) => {
    const productName = `UI Product ${uniqueSuffixUi()}`;

    const productId = await admin.createProduct({
      name: productName,
      description: 'Created by the @ui tier.',
      price: PRODUCT_PRICE,
      stock: INITIAL_STOCK,
    });
    // On save the editor switches from "New product" to "Edit product" on the freshly-created row,
    // so the product id is in the URL now.
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/i);
    expect(productId, 'could not resolve the new product id from the URL').not.toBe('');

    // ----------------------------------------------------------- with an image
    await admin.uploadProductImage(IMAGE_FIXTURE);
    await expect(admin.productImages.locator('img').first()).toBeVisible({ timeout: SAVE_ROUNDTRIP_MS });

    // ------------------------------------------------- it appears in the list
    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.searchProducts(productName);
    // toContainText, NOT toHaveText: the name cell stacks the product name AND its slug
    // ("UI Product x" + "ui-product-x"), so an exact-text assertion can never match.
    await expect(
      admin.productRowName(productId),
      'the new product must appear in the grid',
    ).toContainText(productName, { timeout: SAVE_ROUNDTRIP_MS });
  });

  test('edit a product name -> the new name appears in the list', async () => {
    const productName = `UI Product ${uniqueSuffixUi()}`;
    const editedName = `${productName} edited`;

    // Arrange: an own product (no image — that heavy path is covered by the create-with-image test).
    const productId = await admin.createProduct({
      name: productName,
      price: PRODUCT_PRICE,
      stock: INITIAL_STOCK,
    });
    expect(productId, 'could not resolve the new product id from the URL').not.toBe('');

    // ------------------------------------------------------------------ edit
    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.searchProducts(productName);
    // Clicking Edit on the row is the real user action. It is ALSO the step that caught the
    // shared-DataTable bug: a non-pressable row was rendered `disabled`, which sets
    // pointer-events:none on the row and silently kills every control inside it.
    await expect(
      admin.productEditButton(productId),
      'the row Edit button must be clickable (regression: ui-tables rendered rows pointer-events:none)',
    ).toBeEnabled({ timeout: SAVE_ROUNDTRIP_MS });
    await admin.productEditButton(productId).click();

    await expect(admin.productEditorScreen).toBeVisible();
    await admin.productNameInput.fill(editedName);
    await admin.productSaveButton.click();

    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.searchProducts(editedName);
    await expect(admin.productRowName(productId)).toContainText(editedName, { timeout: SAVE_ROUNDTRIP_MS });
  });

  test('set a product sold-out (stock 0) -> it survives a reload', async ({ page }) => {
    const productName = `UI Product ${uniqueSuffixUi()}`;

    // Arrange: an own product (stock set on the inline grid field below is the assertion).
    const productId = await admin.createProduct({
      name: productName,
      price: PRODUCT_PRICE,
      stock: INITIAL_STOCK,
    });
    expect(productId, 'could not resolve the new product id from the URL').not.toBe('');

    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.searchProducts(productName);

    // --------------------------------------------------------- stock to zero
    // Sold-out is a first-class state a merchant sets constantly. It is an ABSOLUTE set,
    // and 0 (tracked, sold out) must be distinguishable from "not tracked".
    const stock = admin.productStockInput(productId);
    await expect(stock).toBeEnabled({ timeout: SAVE_ROUNDTRIP_MS });
    await stock.fill('0');
    await stock.blur();

    // Reload and re-filter: the point is that 0 SURVIVED a round-trip to the server, not that a
    // controlled input echoed what we typed. (A reload drops the search box, hence the re-search.)
    await expect(async () => {
      // eslint-disable-next-line no-page-reload/no-page-reload -- persistence test: stock 0 must survive a real server round-trip, not just echo a controlled input
      await page.reload();
      await expect(admin.productsScreen).toBeVisible();
      await admin.searchProducts(productName);
      await expect(admin.productStockInput(productId)).toHaveValue('0');
    }).toPass({ timeout: 15_000 });
  });

  test('create coupon -> appears in the coupons grid', async ({ page }) => {
    // Independent of any product: a coupon is a shop-level object. Minimal setup — the shared
    // beforeEach already logged the merchant in — so this stays a fast, atomic test.
    const suffix = uniqueSuffixUi();

    await admin.navCoupons.click();
    await expect(admin.couponsScreen).toBeVisible();
    await admin.couponAddButton.click();

    const code = `UI${suffix.replace(/-/g, '').toUpperCase()}`;
    await admin.couponCodeInput.fill(code);
    await admin.couponValueInput.fill('15');
    await admin.couponSaveButton.click();

    // Save round-trips to the server then navigates back to the list — a heavy transition that gets
    // the explicit ceiling (this is the exact step that raced the 30s cap in the old mega-test).
    await expect(admin.couponsScreen).toBeVisible({ timeout: SAVE_ROUNDTRIP_MS });
    await expect(
      page.getByTestId(/^coupons-table-row-.*-code$/).filter({ hasText: code }).first(),
      'the new coupon must appear in the grid',
    ).toBeVisible({ timeout: SAVE_ROUNDTRIP_MS });
  });
});
