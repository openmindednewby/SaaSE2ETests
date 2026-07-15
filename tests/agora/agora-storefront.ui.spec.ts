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
    await page.addInitScript(() => {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('agora_cart_'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* private mode */
      }
    });
  });

  test('browse -> product -> add to cart -> cart is correct', async ({ page }) => {
    const gotoRes = await page.goto(`${STOREFRONT_URL}/`, { waitUntil: 'domcontentloaded' });
    test.skip(gotoRes === null || !gotoRes.ok(), `storefront home not reachable at ${STOREFRONT_URL}`);

    // The shop home shows a product shelf; open the first non-sold-out product.
    const firstProduct = page.locator('.pcard:not(.pcard--soldout)').first();
    await expect(firstProduct, 'the demo shop must list at least one buyable product').toBeVisible();
    await firstProduct.click();

    // Product page: an enabled Add-to-cart control.
    const addBtn = page.locator('[data-add]');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeEnabled();
    await addBtn.click();

    // The header cart badge reflects the add (shown, count 1).
    const badge = page.locator('[data-cart-badge]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');

    // The cart page lists exactly the one line, with a non-empty subtotal.
    await page.goto(`${STOREFRONT_URL}/cart/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-cart-lines] .cline')).toHaveCount(1);
    const subtotal = page.locator('[data-subtotal]');
    await expect(subtotal).toBeVisible();
    await expect(subtotal).not.toHaveText('—');
    // The checkout CTA is present (the handoff itself needs a real Stripe key).
    await expect(page.locator('[data-checkout-link]')).toBeVisible();
  });

  test('a sold-out variant is shown but NOT addable', async ({ page }) => {
    const gotoRes = await page.goto(`${STOREFRONT_URL}/products/`, { waitUntil: 'domcontentloaded' });
    test.skip(gotoRes === null || !gotoRes.ok(), `storefront catalogue not reachable at ${STOREFRONT_URL}`);

    const soldOutCard = page.locator('.pcard--soldout').first();
    const hasSoldOut = (await soldOutCard.count()) > 0;
    test.skip(!hasSoldOut, 'demo shop has no sold-out product to assert (ES-09 seed should include one)');

    // The tile is shown with a "Sold out" marker (visible, not hidden).
    await expect(soldOutCard).toBeVisible();
    await soldOutCard.click();

    // On the product page the add control is disabled and reads "Sold out".
    const addBtn = page.locator('[data-add]');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeDisabled();
    await expect(page.locator('[data-add-label]')).toHaveText(/sold out/i);
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
