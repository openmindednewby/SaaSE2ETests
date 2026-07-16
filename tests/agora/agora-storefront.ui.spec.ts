// Agora PUBLIC storefront — @ui tier (ES-05).
//
// The real buyer journey through a browser: browse the shop -> open a product ->
// add to cart -> the cart is correct -> a sold-out variant is shown but NOT
// addable. Drives the SSR storefront app (agora-storefront) at
// AGORA_STOREFRONT_URL — the demo shop's public origin
// (e.g. https://demo.agora.dloizides.com or its staging mirror).
//
// 🔒 SKIP-GATED: test.skips with a reason when AGORA_STOREFRONT_URL is unset
// (the dev PC cannot reach WireGuard-only staging, and the storefront is not
// deployed until the ES-05 wildcard-TLS/DNS-01 prerequisite lands) or the
// origin is unreachable. Never fakes a pass.
import { expect, test } from '@playwright/test';

/** The demo shop's public storefront origin. Null → skip the whole tier. */
const STOREFRONT_URL = process.env.AGORA_STOREFRONT_URL?.trim().replace(/\/+$/, '') || null;

test.describe('Agora public storefront — buyer journey @agora-storefront', () => {
  test.skip(STOREFRONT_URL === null, 'AGORA_STOREFRONT_URL unset — storefront not deployed/reachable');

  test.beforeEach(async ({ page }) => {
    // Clear any per-shop cart so each test starts empty (cart is localStorage).
    // addInitScript fires on EVERY document (every navigation), so it must clear
    // only ONCE per test — otherwise the `/cart/` navigation later in the buyer
    // journey would wipe the very cart the test just built, failing the cart
    // assertions for a harness reason, not a product one. Guard with
    // sessionStorage: it persists across same-origin navigations within this
    // test's (isolated) context but is fresh for the next test.
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__agoraCartCleared')) return;
        sessionStorage.setItem('__agoraCartCleared', '1');
        Object.keys(localStorage)
          .filter((k) => k.startsWith('agora_cart_'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* private mode */
      }
    });
  });

  // ES-08: the demo shop is published in BROWSE-ONLY mode — it has no owner Stripe key connected,
  // so products are browsable but not orderable. The old buyer journey (add-to-cart → cart →
  // checkout) is not demonstrable against a browse-only shop, so this proves the browse-only
  // storefront the ES-08 brief describes: products browse, the buy control is inert, and a calm
  // "isn't accepting orders yet" banner explains why. (Full add-to-cart/checkout coverage returns
  // the moment an order-accepting demo/fixture shop exists — see the task report's coverage note.)
  test('browse -> product -> the shop is BROWSE-ONLY (buy disabled + banner)', async ({ page }) => {
    const gotoRes = await page.goto(`${STOREFRONT_URL}/`, { waitUntil: 'domcontentloaded' });
    test.skip(gotoRes === null || !gotoRes.ok(), `storefront home not reachable at ${STOREFRONT_URL}`);

    // The shop home shows a browsable product shelf; open the first product.
    const firstProduct = page.locator('.pcard').first();
    await expect(firstProduct, 'the demo shop must list at least one browsable product').toBeVisible();
    await firstProduct.click();

    // Product page: the Add-to-cart control is present but INERT, and reads "Browsing only".
    const addBtn = page.locator('[data-add]');
    await expect(addBtn).toBeVisible();
    await expect(addBtn, 'a browse-only shop must not allow add-to-cart').toBeDisabled();
    await expect(page.locator('[data-add-label]')).toHaveText(/browsing only/i);

    // The calm "isn't accepting orders yet" banner explains the browse-only state.
    const banner = page.locator('.browseonly');
    await expect(banner, 'the browse-only banner must be present').toBeVisible();
    await expect(banner).toContainText(/accepting orders/i);
  });

  test('a sold-out product is shown with a "Sold out" marker and is not addable', async ({ page }) => {
    const gotoRes = await page.goto(`${STOREFRONT_URL}/products/`, { waitUntil: 'domcontentloaded' });
    test.skip(gotoRes === null || !gotoRes.ok(), `storefront catalogue not reachable at ${STOREFRONT_URL}`);

    const soldOutCard = page.locator('.pcard--soldout').first();
    const hasSoldOut = (await soldOutCard.count()) > 0;
    test.skip(!hasSoldOut, 'demo shop has no sold-out product to assert (ES-09 seed should include one)');

    // The tile is shown with a "Sold out" marker (visible, not hidden).
    await expect(soldOutCard).toBeVisible();
    await expect(soldOutCard).toContainText(/sold out/i);
    await soldOutCard.click();

    // On the product page the add control is disabled — the product is sold out AND (in the demo
    // shop's browse-only state) the whole shop refuses orders. Either way it must never be addable.
    const addBtn = page.locator('[data-add]');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeDisabled();
    await expect(page.locator('[data-add-label]')).toHaveText(/sold out|browsing only/i);
  });

  test('an unknown storefront path renders a branded 404 (not a raw error)', async ({ page }) => {
    const res = await page.goto(`${STOREFRONT_URL}/product/does-not-exist-${Date.now()}/`, {
      waitUntil: 'domcontentloaded',
    });
    test.skip(res === null, 'storefront not reachable');
    expect(res!.status()).toBe(404);
    // A first-class state page, not a stack trace.
    await expect(page.locator('body')).toContainText(/not found|isn't available|not available/i);
  });
});
