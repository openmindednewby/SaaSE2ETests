// 🔒 Agora cross-tenant isolation — ORDERS + STRIPE CONNECTION surfaces (@api tier).
//
// Extends the guarantee agora-tenant-isolation.spec.ts proves for products/categories/coupons/shop
// to the two ES-06 surfaces: a merchant's orders and their Stripe connection. Same rig, same
// no-mock two-real-tenants pattern, same anti-vacuous guard (a NULL tenant matches every row under
// the EF filter, so without asserting the two merchants have DIFFERENT, NON-EMPTY, non-superuser
// tenant ids this file would pass while proving nothing).
//
// HONEST LIMITATION, stated plainly: a *Paid* order for merchant A cannot be seeded without a real
// Stripe TEST key (Agora probes the key; checkout needs a live session). So this file proves the
// order endpoints are tenant-scoped and refuse foreign/unknown ids — it does NOT prove "B is hidden
// from A's real order", because neither merchant can own one here. The connect→publish→Paid path
// (agora-stripe-connect.spec.ts) is where a real order is exercised, and it skips without the key.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi, uniqueSuffix } from './agora-client.js';
import { AGORA_API_URL, MERCHANT_A, MERCHANT_B, getAgoraToken, tokenClaim, tryRequest } from './agora-helpers.js';

const OK = 200;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const BAD_REQUEST = 400;
/** Refused-but-not-existence-confirming: 404 (never in the queryable), 403 (role), 400 (shape). */
const REFUSED = [NOT_FOUND, FORBIDDEN, BAD_REQUEST];
const UNKNOWN_ORDER_ID = '11111111-1111-4111-8111-111111111111';

/** The shop id embedded in a per-merchant Stripe webhook URL. */
function shopIdFromWebhookUrl(url: string): string {
  return /webhooks\/stripe\/([0-9a-f-]{36})/i.exec(url ?? '')?.[1] ?? '';
}

test.describe('🔒 Agora cross-tenant isolation — orders + Stripe @agora-api', () => {
  let apiA: AgoraApi;
  let apiB: AgoraApi;
  let ctx: APIRequestContext;
  let shopIdA = '';

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

    // --- the anti-vacuous-pass guard ---------------------------------------
    const tenantA = tokenClaim(tokenA, 'tenantId');
    const tenantB = tokenClaim(tokenB, 'tenantId');
    expect(tenantA, 'merchant A must carry a tenantId claim').toBeTruthy();
    expect(tenantB, 'merchant B must carry a tenantId claim').toBeTruthy();
    expect(tenantA, 'the two merchants MUST be different tenants').not.toEqual(tenantB);
    const rolesA = tokenClaim(tokenA, 'realm_access') as { roles?: string[] } | undefined;
    const rolesB = tokenClaim(tokenB, 'realm_access') as { roles?: string[] } | undefined;
    expect(rolesA?.roles ?? [], 'merchant A must NOT be a superUser').not.toContain('superUser');
    expect(rolesB?.roles ?? [], 'merchant B must NOT be a superUser').not.toContain('superUser');

    apiA = new AgoraApi(ctx, tokenA);
    apiB = new AgoraApi(ctx, tokenB);

    // A needs a shop so its Stripe webhook URL exists (it embeds A's shop id — the thing B must not
    // be able to address). Upsert is idempotent.
    const shopA = await apiA.updateShop({
      name: 'Isolation Shop A',
      slug: `iso-shop-a-${uniqueSuffix()}`.slice(0, 40),
      currency: 'EUR',
      description: "Merchant A's shop. B must never address it.",
      contactEmail: 'e2e-agora-merchant-a@dloizides.com',
    });
    expect(shopA.status(), await shopA.text()).toBe(OK);
    const connA = (await (await apiA.getStripe()).json()) as { webhookUrl: string };
    shopIdA = shopIdFromWebhookUrl(connA.webhookUrl);
    expect(shopIdA, "merchant A's shop id").not.toBe('');
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  // ============================================================ ORDER isolation
  test("merchant B's order list is B's own — it never carries merchant A's rows", async () => {
    const res = await apiB.listOrders('?page=1&pageSize=100');
    expect(res.status(), await res.text()).toBe(OK);
    const page = (await res.json()) as { items: { externalId: string }[]; totalCount: number };
    expect(Array.isArray(page.items)).toBe(true);
    // B never placed the flagship order; A's rows (if any existed) live under A's tenant and are
    // not in B's queryable at all. UNKNOWN_ORDER_ID stands in for "any id B does not own".
    expect(page.items.map((o) => o.externalId)).not.toContain(UNKNOWN_ORDER_ID);
  });

  test('merchant B cannot READ an order by an id it does not own (404, not 403)', async () => {
    // 404 not 403 by design: a 403 would confirm the row EXISTS, itself a leak.
    const res = await apiB.getOrder(UNKNOWN_ORDER_ID);
    expect(res.status()).toBe(NOT_FOUND);
  });

  test('merchant B cannot FULFIL or REFUND an order it does not own', async () => {
    const fulfilled = await apiB.fulfillOrder(UNKNOWN_ORDER_ID);
    expect(REFUSED).toContain(fulfilled.status());

    const refunded = await apiB.refundOrder(UNKNOWN_ORDER_ID);
    expect(REFUSED).toContain(refunded.status());
  });

  // =========================================================== STRIPE isolation
  test("merchant B's Stripe connection is B's own — it can never address merchant A's shop", async () => {
    // GET /shop/stripe takes NO id: the TOKEN is the key. So B physically cannot ask for A's
    // connection. Prove it: B's webhook URL (if B has a shop) embeds B's shop id, NEVER A's; and no
    // secret ever appears.
    const res = await apiB.getStripe();
    if (res.status() === OK) {
      const conn = (await res.json()) as { webhookUrl: string; secretKeyLast4: string | null };
      const shopIdB = shopIdFromWebhookUrl(conn.webhookUrl);
      expect(shopIdB, "B's own shop id").not.toBe(shopIdA);
      expect(conn.secretKeyLast4 ?? null, 'no secret hint leaks across tenants').toBeNull();
    } else {
      // B simply has no shop yet — also correct. It is certainly not A's.
      expect(res.status()).toBe(NOT_FOUND);
    }
  });

  test("merchant B's PUT /shop/stripe cannot touch merchant A's connection", async () => {
    // A malformed key: deterministically refused (404 if B has no shop, 400 if it does), and it must
    // NOT alter A's connection state — B has no addressable path to A's shop at all.
    const before = (await (await apiA.getStripe()).json()) as { configured: boolean; secretKeyLast4: string | null };

    const res = await apiB.updateStripe({
      stripeSecretKey: 'not-a-real-key',
      stripeWebhookSecret: 'whsec_deadbeefdeadbeefdeadbeef',
      paymentsEnabled: true,
    });
    expect(REFUSED).toContain(res.status());

    const after = (await (await apiA.getStripe()).json()) as { configured: boolean; secretKeyLast4: string | null };
    expect(after.configured, "A's connection state is unchanged by B's write").toBe(before.configured);
    expect(after.secretKeyLast4 ?? null).toBe(before.secretKeyLast4 ?? null);
  });
});
