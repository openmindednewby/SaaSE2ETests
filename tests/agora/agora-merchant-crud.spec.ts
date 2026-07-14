// Agora merchant admin — @api tier: seed-based CRUD against the DEPLOYED API.
//
// Fast (seconds, no browser). Drives the endpoints the merchant admin screens sit
// on: products, categories, coupons, stock, shop settings. The @ui tier
// (agora-admin.ui.spec.ts) then proves the same journey through a real browser.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi, uniqueSuffix } from './agora-client.js';
import type { CreateProductBody } from './agora-client.js';
import {
  AGORA_API_URL,
  MERCHANT_A,
  getAgoraToken,
  tokenClaim,
  tryRequest,
} from './agora-helpers.js';

const PRODUCT_PRICE = 19.99;
const PRODUCT_STOCK = 42;
const RESTOCK_COUNT = 7;
const COUPON_PERCENT = 15;
const SHIPPING_FLAT_FEE = 4.5;
const CONFLICT = 409;

/** A minimal, valid option-less product. `variants: null` is required — the
 *  validator rejects a blank-named variant, so an option-less product MUST put
 *  price/stock top-level and send no variants array at all. */
function productBody(name: string): CreateProductBody {
  return {
    name,
    description: 'Created by the Agora @api E2E tier.',
    categoryId: null,
    sortOrder: 0,
    price: PRODUCT_PRICE,
    stockCount: PRODUCT_STOCK,
    sku: `E2E-${uniqueSuffix()}`,
    variants: null,
  };
}

test.describe('Agora merchant admin CRUD @agora-api', () => {
  let api: AgoraApi;
  /** Own context, not the `request` fixture: AGORA_API_URL may be the staging
   *  ingress, which serves Traefik's self-signed cert. */
  let ctx: APIRequestContext;
  /** Everything created in this file, torn down in afterAll. */
  const createdProducts: string[] = [];
  const createdCategories: string[] = [];
  const createdCoupons: string[] = [];

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ ignoreHTTPSErrors: true });

    if (!(await tryRequest(ctx, '/health/ready'))) {
      test.skip(true, `agora-api not reachable at ${AGORA_API_URL}`);
      return;
    }

    const token = await getAgoraToken(MERCHANT_A);
    if (!token) {
      test.skip(true, 'No agora token — set AGORA_TEST_PASSWORD / AGORA_E2E_CLIENT_SECRET');
      return;
    }
    // The whole multi-tenant model rests on this claim. If it is ever absent the
    // API fails closed (400 TenantRequired) and every assertion below would be
    // misleading, so assert it up front rather than debug a wall of 400s.
    expect(tokenClaim(token, 'tenantId'), 'token must carry a tenantId claim').toBeTruthy();
    api = new AgoraApi(ctx, token);
  });

  test.afterAll(async () => {
    if (!api) {
      return;
    }
    await Promise.all([
      ...createdProducts.map((id) => api.deleteProduct(id).catch(() => undefined)),
      ...createdCoupons.map((id) => api.deleteCoupon(id).catch(() => undefined)),
    ]);
    // Categories last — deleting one only uncategorises its products, never
    // deletes them, so ordering is not strictly required, but it keeps the
    // teardown deterministic.
    await Promise.all(
      createdCategories.map((id) => api.deleteCategory(id).catch(() => undefined)),
    );
    await ctx?.dispose();
  });

  // ------------------------------------------------------------------ products
  test('creates, reads, updates and deletes a product', async () => {
    const name = `E2E Product ${uniqueSuffix()}`;

    const created = await api.createProduct(productBody(name));
    expect(created.status(), await created.text()).toBe(201);
    const product = (await created.json()) as { externalId: string; name: string };
    createdProducts.push(product.externalId);
    expect(product.name).toBe(name);

    const fetched = await api.getProduct(product.externalId);
    expect(fetched.status()).toBe(200);

    const renamed = `${name} (edited)`;
    const updated = await api.updateProduct(product.externalId, {
      name: renamed,
      description: 'Edited by the @api tier.',
      categoryId: null,
      sortOrder: 0,
      isActive: true,
      variants: null,
    });
    expect(updated.status(), await updated.text()).toBe(200);
    expect(((await updated.json()) as { name: string }).name).toBe(renamed);

    const deleted = await api.deleteProduct(product.externalId);
    expect(deleted.status()).toBe(204);
    createdProducts.splice(createdProducts.indexOf(product.externalId), 1);

    // Gone. (Cross-tenant reads also 404 — see agora-tenant-isolation.spec.ts.)
    expect((await api.getProduct(product.externalId)).status()).toBe(404);
  });

  test('adjusts variant stock to zero and back', async () => {
    const created = await api.createProduct(productBody(`E2E Stock ${uniqueSuffix()}`));
    expect(created.status(), await created.text()).toBe(201);
    const product = (await created.json()) as {
      externalId: string;
      variants: { externalId: string }[];
    };
    createdProducts.push(product.externalId);

    // An option-less product still gets one implicit default variant — that is
    // where price and stock actually live (ES-03).
    expect(product.variants.length, 'implicit default variant').toBeGreaterThan(0);
    const variantId = product.variants[0].externalId;

    const soldOut = await api.setVariantStock(product.externalId, variantId, 0);
    expect(soldOut.status(), await soldOut.text()).toBe(200);
    expect(((await soldOut.json()) as { stockCount: number }).stockCount).toBe(0);

    const restocked = await api.setVariantStock(product.externalId, variantId, RESTOCK_COUNT);
    expect(restocked.status()).toBe(200);
    expect(((await restocked.json()) as { stockCount: number }).stockCount).toBe(RESTOCK_COUNT);
  });

  // ---------------------------------------------------------------- categories
  test('creates categories and reorders them', async () => {
    const first = await api.createCategory(`E2E Cat A ${uniqueSuffix()}`, 0);
    const second = await api.createCategory(`E2E Cat B ${uniqueSuffix()}`, 1);
    expect(first.status(), await first.text()).toBe(201);
    expect(second.status(), await second.text()).toBe(201);

    const a = (await first.json()) as { externalId: string };
    const b = (await second.json()) as { externalId: string };
    createdCategories.push(a.externalId, b.externalId);

    // Reorder takes the COMPLETE ordered set of the shop's categories — every id
    // exactly once. So read the live list and reverse it, rather than sending
    // only the two we just made (which would 400 once the shop has others).
    const listed = await api.listCategories();
    expect(listed.status()).toBe(200);
    const items = ((await listed.json()) as { items: { externalId: string }[] }).items;
    const reversed = items.map((c) => c.externalId).reverse();

    const reordered = await api.reorderCategories(reversed);
    expect(reordered.status(), await reordered.text()).toBe(200);

    const after = ((await reordered.json()) as { items: { externalId: string }[] }).items;
    expect(after.map((c) => c.externalId)).toEqual(reversed);
  });

  test('rejects a reorder that does not list every category exactly once', async () => {
    const created = await api.createCategory(`E2E Cat Dup ${uniqueSuffix()}`, 0);
    expect(created.status()).toBe(201);
    const cat = (await created.json()) as { externalId: string };
    createdCategories.push(cat.externalId);

    // Same id twice — all-or-nothing, must be refused.
    const bad = await api.reorderCategories([cat.externalId, cat.externalId]);
    expect(bad.status()).toBe(400);
  });

  // ------------------------------------------------------------------- coupons
  test('creates a percentage coupon', async () => {
    const code = `E2E${uniqueSuffix().replace(/-/g, '').toUpperCase()}`;
    const created = await api.createCoupon({
      code,
      discountType: 'Percentage',
      value: COUPON_PERCENT,
      isActive: true,
    });
    expect(created.status(), await created.text()).toBe(201);

    const coupon = (await created.json()) as {
      externalId: string;
      code: string;
      usedCount: number;
    };
    createdCoupons.push(coupon.externalId);
    expect(coupon.code).toBe(code);
    // usedCount is server-owned and must never be writable from the client.
    expect(coupon.usedCount).toBe(0);

    const listed = await api.listCoupons();
    const items = ((await listed.json()) as { items: { code: string }[] }).items;
    expect(items.map((c) => c.code)).toContain(code);
  });

  test('rejects a percentage coupon above 100', async () => {
    const bad = await api.createCoupon({
      code: `E2EBAD${uniqueSuffix().replace(/-/g, '').toUpperCase()}`,
      discountType: 'Percentage',
      value: 101,
      isActive: true,
    });
    expect(bad.status()).toBe(400);
  });

  // ---------------------------------------------------------------------- shop
  test('upserts shop settings and shipping', async () => {
    const slug = `e2e-shop-${uniqueSuffix()}`.slice(0, 40);
    const saved = await api.updateShop({
      name: 'E2E Test Shop',
      slug,
      currency: 'EUR',
      description: 'Shop settings written by the @api tier.',
      contactEmail: 'e2e-agora-merchant-a@dloizides.com',
    });
    expect(saved.status(), await saved.text()).toBe(200);

    const shop = (await saved.json()) as {
      slug: string;
      currency: string;
      stripeConnected: boolean;
      canPublish: boolean;
    };
    expect(shop.slug).toBe(slug);
    expect(shop.currency).toBe('EUR');

    const shipping = await api.updateShipping(SHIPPING_FLAT_FEE, true);
    expect(shipping.status(), await shipping.text()).toBe(200);

    const readBack = await api.getShop();
    expect(readBack.status()).toBe(200);
    expect(((await readBack.json()) as { slug: string }).slug).toBe(slug);
  });

  test('refuses to publish a shop with no Stripe credentials', async () => {
    // NOT a bug and NOT a temporary hack: a shop must not be able to go live
    // before the merchant's own Stripe credentials are stored, and the endpoint
    // that stores them is ES-06. This test PINS that refusal — if it ever starts
    // passing, an unpayable shop just went live.
    const published = await api.publishShop();
    expect(published.status()).toBe(CONFLICT);
    expect(await published.text()).toContain('STRIPE_NOT_CONNECTED');

    const shop = await api.getShop();
    if (shop.status() === 200) {
      const body = (await shop.json()) as { canPublish: boolean; stripeConnected: boolean };
      expect(body.stripeConnected).toBe(false);
      expect(body.canPublish).toBe(false);
    }
  });

  test('dashboard summary reflects the merchant shop', async () => {
    const summary = await api.dashboardSummary();
    expect(summary.status()).toBe(200);
    const body = (await summary.json()) as {
      setup: { stripeConnected: boolean; totalSteps: number };
      productCount: number;
    };
    // Field names are the SERVER's (shopCreated/hasProducts/...), not the ones
    // agora-web originally invented. Assert the real contract.
    expect(body.setup).toHaveProperty('shopCreated');
    expect(body.setup).toHaveProperty('hasProducts');
    expect(body.setup.stripeConnected).toBe(false);
    expect(body.productCount).toBeGreaterThanOrEqual(0);
  });
});
