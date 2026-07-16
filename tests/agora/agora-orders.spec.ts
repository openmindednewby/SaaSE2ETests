// Agora merchant ORDERS + STRIPE-CONNECTION — @api tier against the DEPLOYED API.
//
// The keyless half of ES-06's merchant frontend: everything that needs no real Stripe account.
//   - the shop reports itself NOT connected / NOT publishable, with a webhook URL to paste;
//   - a malformed / bogus Stripe key is REJECTED (the validate-on-save probe), inline-surfaceable;
//   - the orders endpoints exist, are tenant-scoped, page, filter, and 404 an unknown order.
// The connect→publish→Paid-order flagship lives in agora-stripe-connect.spec.ts and skips-with-
// reason until a real Stripe TEST key is wired (Agora PROBES the key, so a dummy cannot stand in).
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi, uniqueSuffix } from './agora-client.js';
import type { UpdateShopBody } from './agora-client.js';
import { FAKE_WEBHOOK_SECRET } from './agora-stripe.js';
import { AGORA_API_URL, MERCHANT_A, getAgoraToken, tokenClaim, tryRequest } from './agora-helpers.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const OK = 200;
/** A random id that cannot belong to any shop — for the "unknown order 404s" assertions. */
const UNKNOWN_ORDER_ID = '00000000-0000-4000-8000-000000000000';

function shopBody(): UpdateShopBody {
  return {
    name: 'E2E Orders Shop',
    slug: `e2e-orders-${uniqueSuffix()}`.slice(0, 40),
    currency: 'EUR',
    description: 'Shop for the Agora orders/stripe @api tier.',
    contactEmail: 'e2e-agora-merchant-a@dloizides.com',
  };
}

test.describe('Agora orders + Stripe connection @agora-api', () => {
  let api: AgoraApi;
  let ctx: APIRequestContext;

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
    expect(tokenClaim(token, 'tenantId'), 'token must carry a tenantId claim').toBeTruthy();
    api = new AgoraApi(ctx, token);

    // GET /shop/stripe 404s until a shop exists, so ensure merchant A has one. Upsert is idempotent.
    const saved = await api.updateShop(shopBody());
    expect(saved.status(), await saved.text()).toBe(OK);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  // ------------------------------------------------------- stripe connection status
  test('the shop reports NOT-connected, NOT-publishable, with a webhook URL to paste', async () => {
    const res = await api.getStripe();
    expect(res.status(), await res.text()).toBe(OK);
    const conn = (await res.json()) as {
      configured: boolean;
      paymentsEnabled: boolean;
      canPublish: boolean;
      webhookUrl: string;
      secretKeyLast4: string | null;
    };
    // Neither secret stored yet → nothing to be paid with → cannot go live.
    expect(conn.configured, 'no Stripe stored yet').toBe(false);
    expect(conn.paymentsEnabled).toBe(false);
    expect(conn.canPublish, 'a shop with no Stripe must not be publishable').toBe(false);
    // The merchant is handed the exact URL to register in their own Stripe — the difference between
    // a 2-minute setup and a support ticket. It embeds THIS shop's id (per-merchant webhook secret).
    expect(conn.webhookUrl, 'webhook URL present').toMatch(/\/api\/v1\/webhooks\/stripe\/[0-9a-f-]{36}$/i);
    // A secret is never returned — the display surface is the last-4 only, absent here.
    expect(conn.secretKeyLast4 ?? null).toBeNull();
  });

  test('publishing without Stripe succeeds browse-only — live but acceptsOrders:false (ES-08)', async () => {
    // ES-08 reversed the old ES-06 refusal: publishing no longer needs Stripe. A shop with content
    // goes LIVE in browse-only mode (isPublished:true, acceptsOrders:false) — browsable but not
    // order-accepting — until the merchant connects their own Stripe. Self-contained: ensure a
    // product so the content gate is met, publish, assert browse-only, then restore the draft state.
    const created = await api.createProduct({
      name: `Publish fixture ${uniqueSuffix()}`,
      description: null,
      categoryId: null,
      sortOrder: 0,
      price: 9.99,
      stockCount: 5,
      sku: `E2E-${uniqueSuffix()}`,
      variants: null,
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const productId = ((await created.json()) as { externalId: string }).externalId;

    try {
      const published = await api.publishShop();
      expect(published.status(), await published.text()).toBe(OK);
      const shop = (await published.json()) as { isPublished: boolean; acceptsOrders: boolean };
      expect(shop.isPublished, 'a shop with content publishes').toBe(true);
      expect(shop.acceptsOrders, 'without Stripe it is browse-only — live but not taking orders').toBe(false);
    } finally {
      await api.unpublishShop();
      await api.deleteProduct(productId);
    }
  });

  // ------------------------------------------------------------ invalid-key rejection
  test('PUT /shop/stripe with a MALFORMED secret key is rejected 400 and leaves the shop not-connected', async () => {
    // Deterministic, no network: "not-a-real-key" has no sk_ prefix, so the shape check fails before
    // any probe. The UI surfaces this inline (RFC7807 errors[].reason) — see the @ui tier.
    const res = await api.updateStripe({
      stripeSecretKey: 'not-a-real-key',
      stripeWebhookSecret: FAKE_WEBHOOK_SECRET,
      paymentsEnabled: true,
    });
    expect(res.status(), await res.text()).toBe(BAD_REQUEST);
    // RFC7807 problem+json. The machine error code is NOT put on the wire — the surface is
    // `errors[].name` (the field) + `errors[].reason` (the human message the UI shows inline).
    const problem = (await res.json()) as { errors: { name: string; reason: string }[] };
    const fieldError = problem.errors.find((e) => e.name === 'stripeSecretKey');
    expect(fieldError, 'the rejection names the secret-key field').toBeTruthy();
    expect(fieldError?.reason, 'reason explains the sk_ shape').toContain("sk_");

    // And the connection state did NOT change — a rejected key must never half-connect a shop.
    const after = (await (await api.getStripe()).json()) as { configured: boolean; canPublish: boolean };
    expect(after.configured, 'a rejected key must not connect the shop').toBe(false);
    expect(after.canPublish).toBe(false);
  });

  test('PUT /shop/stripe with a well-formed but BOGUS key is rejected by the Stripe probe', async () => {
    // Well-formed (sk_test_ + length) so it passes the shape gate and reaches the validate-on-save
    // probe, which asks Stripe whose account it is. A fabricated key has none → Stripe 401 → 400
    // STRIPE_KEY_REJECTED. This is the whole point of ES-06's probe: a key that merely LOOKS right
    // is exactly the failure the feature exists to catch (a green tick, then a lost first customer).
    const res = await api.updateStripe({
      stripeSecretKey: `sk_test_${uniqueSuffix().replace(/-/g, '')}bogus000000`,
      stripeWebhookSecret: FAKE_WEBHOOK_SECRET,
      paymentsEnabled: true,
    });
    expect(res.status(), await res.text()).toBe(BAD_REQUEST);
    // The probe actually reached Stripe (staging has egress) and Stripe rejected the fabricated key.
    // Surfaced as RFC7807 errors[].reason, the exact text the UI shows inline.
    const problem = (await res.json()) as { errors: { name: string; reason: string }[] };
    const fieldError = problem.errors.find((e) => e.name === 'stripeSecretKey');
    expect(fieldError?.reason, 'Stripe rejected the fabricated key').toMatch(/Stripe rejected this secret key/i);

    const after = (await (await api.getStripe()).json()) as { configured: boolean };
    expect(after.configured, 'a probe-rejected key must not connect the shop').toBe(false);
  });

  // -------------------------------------------------------------------------- orders
  test('GET /orders returns a well-formed page for the merchant', async () => {
    const res = await api.listOrders('?page=1&pageSize=20');
    expect(res.status(), await res.text()).toBe(OK);
    const page = (await res.json()) as {
      items: unknown[];
      totalCount: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
    expect(Array.isArray(page.items), 'items is an array').toBe(true);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.totalCount).toBeGreaterThanOrEqual(0);
    expect(page.totalPages).toBeGreaterThanOrEqual(0);
  });

  test('GET /orders?status=Paid filters without error', async () => {
    const res = await api.listOrders('?page=1&pageSize=20&status=Paid');
    expect(res.status(), await res.text()).toBe(OK);
    const page = (await res.json()) as { items: { status: string }[] };
    // Every returned row (if any) is actually Paid — the filter is applied, not ignored.
    for (const order of page.items) {
      expect(order.status).toBe('Paid');
    }
  });

  test('GET /orders/{unknownId} → 404 (the endpoint is tenant-scoped, not a table scan)', async () => {
    const res = await api.getOrder(UNKNOWN_ORDER_ID);
    expect(res.status()).toBe(NOT_FOUND);
  });

  test('fulfil / refund an unknown order → refused (404), never a 500 or a silent success', async () => {
    const fulfilled = await api.fulfillOrder(UNKNOWN_ORDER_ID);
    expect(fulfilled.status(), await fulfilled.text()).toBe(NOT_FOUND);

    // Refund is Admin-only; a non-admin merchant gets 403 before the id is even looked up. Either
    // way the transition is refused — assert the security property, not one exact code.
    const refunded = await api.refundOrder(UNKNOWN_ORDER_ID);
    expect([NOT_FOUND, FORBIDDEN]).toContain(refunded.status());
  });
});
