// 🔒 Agora cross-tenant isolation — @api tier, but this is THE test in the suite.
//
// WHY THIS EXISTS
// AgoraService has 16 unit-level isolation tests. Not one of them proves that the
// `tenantId` claim survives the real path: Keycloak mints it -> the BFF forwards
// the token -> the API reads it -> EF's global query filter keys on it. A unit
// test injects a tenant id directly; it cannot catch a missing client scope, an
// unmapped protocol mapper, a dropped user attribute, or a filter that a
// superuser silently bypasses. Every one of those is a real, live failure mode —
// and two of them were ACTUALLY broken on this stack before this suite ran:
// the seeder dropped the tenantId attribute, so the claim was absent entirely.
//
// A cross-tenant leak in an eShop is fatal: it is one merchant reading another's
// catalog, pricing, coupons and orders. So this asserts, against the DEPLOYED
// stack, that merchant B can neither READ nor MUTATE anything of merchant A's.
//
// THE TRAP THIS TEST MUST NOT FALL INTO
// AgoraDbContext's filter is:
//     _currentTenantService.TenantId == null || e.TenantId == _currentTenantService.TenantId
// A NULL tenant matches EVERY row. CurrentTenantService returns null for a
// superuser. So if either merchant were a superuser — or carried no tenantId at
// all — the filter would open wide and this test would pass VACUOUSLY while
// proving nothing. Hence the explicit claim assertions in beforeAll: the two
// merchants must have DIFFERENT, NON-EMPTY tenant ids.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi, uniqueSuffix } from './agora-client.js';
import {
  AGORA_API_URL,
  MERCHANT_A,
  MERCHANT_B,
  getAgoraToken,
  tokenClaim,
  tryRequest,
} from './agora-helpers.js';

const PRODUCT_PRICE = 9.99;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const BAD_REQUEST = 400;

/** A cross-tenant reference must not be readable NOR writable. AgoraService
 *  answers 404 (not 403) by design — a 403 would confirm the row EXISTS, which
 *  is itself a leak. 403/400 are accepted as "also refused" so the test asserts
 *  the security property (denied) rather than one exact status code. */
const REFUSED = [NOT_FOUND, FORBIDDEN, BAD_REQUEST];

test.describe('🔒 Agora cross-tenant isolation @agora-api', () => {
  let apiA: AgoraApi;
  let apiB: AgoraApi;
  let ctx: APIRequestContext;

  /** Merchant A's resources — B must not be able to touch any of them. */
  let productA = '';
  let categoryA = '';
  let couponA = '';
  let variantA = '';
  const productName = `Isolation Product ${uniqueSuffix()}`;
  const couponCode = `ISO${uniqueSuffix().replace(/-/g, '').toUpperCase()}`;

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    if (!(await tryRequest(ctx, '/health/ready'))) {
      test.skip(true, `agora-api not reachable at ${AGORA_API_URL}`);
      return;
    }

    const tokenA = await getAgoraToken(MERCHANT_A);
    const tokenB = await getAgoraToken(MERCHANT_B);
    if (!tokenA || !tokenB) {
      test.skip(true, 'Need both merchant tokens — check AGORA_TEST_PASSWORD / client secret');
      return;
    }

    // --- the anti-vacuous-pass guard (see header) ---------------------------
    const tenantA = tokenClaim(tokenA, 'tenantId');
    const tenantB = tokenClaim(tokenB, 'tenantId');
    expect(tenantA, 'merchant A must carry a tenantId claim').toBeTruthy();
    expect(tenantB, 'merchant B must carry a tenantId claim').toBeTruthy();
    expect(tenantA, 'the two merchants MUST be different tenants').not.toEqual(tenantB);

    const rolesA = tokenClaim(tokenA, 'realm_access') as { roles?: string[] } | undefined;
    const rolesB = tokenClaim(tokenB, 'realm_access') as { roles?: string[] } | undefined;
    // A superuser gets TenantId == null, which matches every row. Neither merchant
    // may be one, or this whole spec proves nothing.
    expect(rolesA?.roles ?? [], 'merchant A must NOT be a superUser').not.toContain('superUser');
    expect(rolesB?.roles ?? [], 'merchant B must NOT be a superUser').not.toContain('superUser');

    apiA = new AgoraApi(ctx, tokenA);
    apiB = new AgoraApi(ctx, tokenB);

    // --- merchant A creates one of everything ------------------------------
    const product = await apiA.createProduct({
      name: productName,
      description: 'Owned by merchant A. Merchant B must never see this.',
      categoryId: null,
      sortOrder: 0,
      price: PRODUCT_PRICE,
      stockCount: 5,
      sku: `ISO-${uniqueSuffix()}`,
      variants: null,
    });
    expect(product.status(), await product.text()).toBe(201);
    const productJson = (await product.json()) as {
      externalId: string;
      variants: { externalId: string }[];
    };
    productA = productJson.externalId;
    variantA = productJson.variants[0]?.externalId ?? '';

    const category = await apiA.createCategory(`Isolation Cat ${uniqueSuffix()}`, 0);
    expect(category.status()).toBe(201);
    categoryA = ((await category.json()) as { externalId: string }).externalId;

    const coupon = await apiA.createCoupon({
      code: couponCode,
      discountType: 'Percentage',
      value: 10,
      isActive: true,
    });
    expect(coupon.status()).toBe(201);
    couponA = ((await coupon.json()) as { externalId: string }).externalId;
  });

  test.afterAll(async () => {
    if (!apiA) {
      return;
    }
    await Promise.all([
      productA ? apiA.deleteProduct(productA).catch(() => undefined) : undefined,
      couponA ? apiA.deleteCoupon(couponA).catch(() => undefined) : undefined,
      categoryA ? apiA.deleteCategory(categoryA).catch(() => undefined) : undefined,
    ]);
    await ctx?.dispose();
  });

  // =========================================================== READ isolation
  test("merchant B's product LIST does not contain merchant A's product", async () => {
    const listed = await apiB.listProducts('?page=1&pageSize=100');
    expect(listed.status()).toBe(200);
    const items = ((await listed.json()) as { items: { externalId: string; name: string }[] })
      .items;

    expect(items.map((p) => p.externalId)).not.toContain(productA);
    expect(items.map((p) => p.name)).not.toContain(productName);
  });

  test("merchant B cannot READ merchant A's product by id", async () => {
    const res = await apiB.getProduct(productA);
    expect(REFUSED).toContain(res.status());
  });

  test("merchant B's category list does not contain merchant A's category", async () => {
    const listed = await apiB.listCategories();
    expect(listed.status()).toBe(200);
    const items = ((await listed.json()) as { items: { externalId: string }[] }).items;
    expect(items.map((c) => c.externalId)).not.toContain(categoryA);
  });

  test("merchant B's coupon list does not contain merchant A's coupon", async () => {
    const listed = await apiB.listCoupons();
    expect(listed.status()).toBe(200);
    const items = ((await listed.json()) as { items: { externalId: string; code: string }[] })
      .items;
    expect(items.map((c) => c.externalId)).not.toContain(couponA);
    expect(items.map((c) => c.code)).not.toContain(couponCode);
  });

  test("merchant B's dashboard does not count merchant A's data", async () => {
    // B has created nothing. If A's rows bled through the query filter, B's
    // counts would be non-zero — a cheap, whole-table canary for the filter.
    const res = await apiB.dashboardSummary();
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { productCount: number; couponCount: number };
    expect(body.productCount).toBe(0);
    expect(body.couponCount).toBe(0);
  });

  test("merchant B cannot READ merchant A's shop settings", async () => {
    // B has no shop of their own, so this must be 404 ("run onboarding") — and it
    // must NOT be A's shop. The endpoint takes no id: the TOKEN is the shop key,
    // so a leak here would be a total compromise.
    const res = await apiB.getShop();
    if (res.status() === 200) {
      const shop = (await res.json()) as { contactEmail: string };
      expect(shop.contactEmail).not.toContain('merchant-a');
    } else {
      expect(res.status()).toBe(NOT_FOUND);
    }
  });

  // ========================================================= MUTATE isolation
  test("merchant B cannot UPDATE merchant A's product", async () => {
    const res = await apiB.updateProduct(productA, {
      name: 'HIJACKED BY MERCHANT B',
      description: null,
      categoryId: null,
      sortOrder: 0,
      isActive: true,
      variants: null,
    });
    expect(REFUSED).toContain(res.status());

    // And A's product is untouched — the refusal must be real, not cosmetic.
    const readBack = await apiA.getProduct(productA);
    expect(readBack.status()).toBe(200);
    expect(((await readBack.json()) as { name: string }).name).toBe(productName);
  });

  test("merchant B cannot DELETE merchant A's product", async () => {
    const res = await apiB.deleteProduct(productA);
    expect(REFUSED).toContain(res.status());

    // Still there.
    expect((await apiA.getProduct(productA)).status()).toBe(200);
  });

  test("merchant B cannot change the STOCK on merchant A's product", async () => {
    test.skip(!variantA, 'no default variant on the isolation product');

    const res = await apiB.setVariantStock(productA, variantA, 0);
    expect(REFUSED).toContain(res.status());

    // A's stock is intact — a silent success here would let a competitor mark a
    // rival's whole catalog out of stock.
    const readBack = await apiA.getProduct(productA);
    const product = (await readBack.json()) as { variants: { stockCount: number }[] };
    expect(product.variants[0].stockCount).not.toBe(0);
  });

  test("merchant B cannot DELETE merchant A's category", async () => {
    const res = await apiB.deleteCategory(categoryA);
    expect(REFUSED).toContain(res.status());

    const listed = await apiA.listCategories();
    const items = ((await listed.json()) as { items: { externalId: string }[] }).items;
    expect(items.map((c) => c.externalId)).toContain(categoryA);
  });

  test("merchant B cannot UPDATE or DELETE merchant A's coupon", async () => {
    const updated = await apiB.updateCoupon(couponA, {
      code: couponCode,
      discountType: 'Percentage',
      value: 99,
      isActive: true,
    });
    expect(REFUSED).toContain(updated.status());

    const deleted = await apiB.deleteCoupon(couponA);
    expect(REFUSED).toContain(deleted.status());

    // A's coupon is unchanged — still 10%, not the 99% B tried to write.
    const listed = await apiA.listCoupons();
    const items = ((await listed.json()) as { items: { externalId: string; value: number }[] })
      .items;
    const mine = items.find((c) => c.externalId === couponA);
    expect(mine, "merchant A's coupon must survive").toBeTruthy();
    expect(mine?.value).toBe(10);
  });

  test("merchant B cannot reorder merchant A's categories", async () => {
    // Reorder is all-or-nothing over the caller's OWN category set. Handing it a
    // foreign id must not move A's data.
    const res = await apiB.reorderCategories([categoryA]);
    expect(REFUSED).toContain(res.status());
  });
});
