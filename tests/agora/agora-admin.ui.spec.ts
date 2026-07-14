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

  test('create product with image -> appears in list -> edit -> stock to 0 -> create coupon', async ({ page }) => {
    const suffix = uniqueSuffixUi();
    const productName = `UI Product ${suffix}`;
    const editedName = `${productName} edited`;

    // ---------------------------------------------------------------- create
    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.productAddButton.click();
    await expect(admin.productEditorScreen).toBeVisible();

    await admin.productNameInput.fill(productName);
    await admin.productDescriptionInput.fill('Created by the @ui tier.');
    await admin.variantPrice0.fill(PRODUCT_PRICE);
    await admin.variantStock0.fill(INITIAL_STOCK);
    await admin.productSaveButton.click();

    // On save the editor does NOT go back to the list — it switches from "New product" to
    // "Edit product" on the freshly-created row, and the image uploader (which needs a product
    // id to attach to) appears. So the product id is in the URL now.
    await expect(admin.productImageUpload).toBeVisible();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/i);
    const productId = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(productId, 'could not resolve the new product id from the URL').not.toBe('');

    // ----------------------------------------------------------- with an image
    await admin.uploadProductImage(IMAGE_FIXTURE);
    await expect(admin.productImages.locator('img').first()).toBeVisible();

    // ------------------------------------------------- it appears in the list
    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.searchProducts(productName);
    // toContainText, NOT toHaveText: the name cell stacks the product name AND its slug
    // ("UI Product x" + "ui-product-x"), so an exact-text assertion can never match.
    await expect(
      admin.productRowName(productId),
      'the new product must appear in the grid',
    ).toContainText(productName);

    // ------------------------------------------------------------------ edit
    // Clicking Edit on the row is the real user action. It is ALSO the step that caught the
    // shared-DataTable bug: a non-pressable row was rendered `disabled`, which sets
    // pointer-events:none on the row and silently kills every control inside it.
    await expect(
      admin.productEditButton(productId),
      'the row Edit button must be clickable (regression: ui-tables rendered rows pointer-events:none)',
    ).toBeEnabled();
    await admin.productEditButton(productId).click();

    await expect(admin.productEditorScreen).toBeVisible();
    await admin.productNameInput.fill(editedName);
    await admin.productSaveButton.click();

    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await admin.searchProducts(editedName);
    await expect(admin.productRowName(productId)).toContainText(editedName);

    // --------------------------------------------------------- stock to zero
    // Sold-out is a first-class state a merchant sets constantly. It is an ABSOLUTE set,
    // and 0 (tracked, sold out) must be distinguishable from "not tracked".
    const stock = admin.productStockInput(productId);
    await expect(stock).toBeEnabled();
    await stock.fill('0');
    await stock.blur();

    // Reload and re-filter: the point is that 0 SURVIVED a round-trip to the server, not that a
    // controlled input echoed what we typed. (A reload drops the search box, hence the re-search.)
    await expect(async () => {
      await page.reload();
      await expect(admin.productsScreen).toBeVisible();
      await admin.searchProducts(editedName);
      await expect(admin.productStockInput(productId)).toHaveValue('0');
    }).toPass({ timeout: 30_000 });

    // ----------------------------------------------------------- create coupon
    await admin.navCoupons.click();
    await expect(admin.couponsScreen).toBeVisible();
    await admin.couponAddButton.click();

    const code = `UI${suffix.replace(/-/g, '').toUpperCase()}`;
    await admin.couponCodeInput.fill(code);
    await admin.couponValueInput.fill('15');
    await admin.couponSaveButton.click();

    await expect(admin.couponsScreen).toBeVisible();
    await expect(
      page.getByTestId(/^coupons-table-row-.*-code$/).filter({ hasText: code }).first(),
      'the new coupon must appear in the grid',
    ).toBeVisible();
  });
});
