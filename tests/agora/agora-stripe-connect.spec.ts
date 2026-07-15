// 🔴 Agora ES-06 FLAGSHIP — connect Stripe → publish → take a Paid order → fulfil. @api tier.
//
// This is the whole point of ES-06's merchant frontend, and none of it can run without a REAL
// Stripe TEST key: Agora PROBES the merchant's key against Stripe on save (unlike Kefi, which
// trusts a well-shaped dummy), and /checkout will not open a session on a shop with no connected
// Stripe. So the entire describe SKIPS-WITH-REASON when the key is absent — loudly, in the report —
// rather than pretend-passing. Set E2E_AGORA_STRIPE_TEST_SECRET + E2E_AGORA_STRIPE_TEST_WEBHOOK_SECRET
// to activate it. The keyless assertions (409-before, invalid-key, isolation) live in the sibling
// specs and run unconditionally.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi, uniqueSuffix } from './agora-client.js';
import { AGORA_API_URL, AGORA_API_PREFIX, MERCHANT_A, getAgoraToken, tryRequest } from './agora-helpers.js';
import {
  NO_STRIPE_KEY_REASON,
  agoraStripeTestKeys,
  buildCheckoutCompletedBody,
  extractCheckoutSessionId,
  signStripeEvent,
} from './agora-stripe.js';

const OK = 200;
const PRODUCT_PRICE = 12.34;
const PRODUCT_STOCK = 25;
/** Pickup on the wire, so the flow needs no shipping address. */
const FULFILMENT_PICKUP = 0;

test.describe('🔴 Agora ES-06 flagship: connect Stripe → publish → Paid order → fulfil @agora-api', () => {
  const keys = agoraStripeTestKeys();
  test.skip(!keys, NO_STRIPE_KEY_REASON);

  let api: AgoraApi;
  let ctx: APIRequestContext;
  let shopId = '';
  let shopSlug = '';
  const createdProducts: string[] = [];

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
    api = new AgoraApi(ctx, token);

    shopSlug = `e2e-flagship-${uniqueSuffix()}`.slice(0, 40);
    const shop = await api.updateShop({
      name: 'E2E Flagship Shop',
      slug: shopSlug,
      currency: 'EUR',
      description: 'Flagship connect→publish→order flow.',
      contactEmail: 'e2e-agora-merchant-a@dloizides.com',
    });
    expect(shop.status(), await shop.text()).toBe(OK);
  });

  test.afterAll(async () => {
    if (api) {
      await Promise.all(createdProducts.map((id) => api.deleteProduct(id).catch(() => undefined)));
      // Leave Stripe connected/disconnected as-is is fine; disconnect to keep the rig clean.
      await api.disconnectStripe().catch(() => undefined);
    }
    await ctx?.dispose();
  });

  test('connect flips canPublish true, publish succeeds, a paid order fulfils', async () => {
    // ── 1. connect the REAL test key → the probe passes, both secrets stored ──
    const connected = await api.updateStripe({
      stripeSecretKey: keys!.secret,
      stripeWebhookSecret: keys!.webhook,
      paymentsEnabled: true,
    });
    expect(connected.status(), await connected.text()).toBe(OK);
    const conn = (await connected.json()) as { configured: boolean; canPublish: boolean; webhookUrl: string };
    expect(conn.configured, 'real key stored').toBe(true);
    expect(conn.canPublish, 'canPublish flips true the instant Stripe connects').toBe(true);

    shopId = /webhooks\/stripe\/([0-9a-f-]{36})/i.exec(conn.webhookUrl)?.[1] ?? '';
    expect(shopId, 'shop id from webhook URL').not.toBe('');

    // GET /shop agrees: stripeConnected + canPublish both true, live-state before/after.
    const shopState = (await (await api.getShop()).json()) as { stripeConnected: boolean; canPublish: boolean };
    expect(shopState.stripeConnected).toBe(true);
    expect(shopState.canPublish).toBe(true);

    // ── 2. publish now SUCCEEDS (it 409'd for every merchant before ES-06) ──
    const published = await api.publishShop();
    expect(published.status(), await published.text()).toBe(OK);

    // ── 3. a real product to buy ──
    const productRes = await api.createProduct({
      name: `Flagship Product ${uniqueSuffix()}`,
      description: 'Bought by the flagship @api flow.',
      categoryId: null,
      sortOrder: 0,
      price: PRODUCT_PRICE,
      stockCount: PRODUCT_STOCK,
      sku: `FLAG-${uniqueSuffix()}`,
      variants: null,
    });
    expect(productRes.status(), await productRes.text()).toBe(201);
    const product = (await productRes.json()) as { externalId: string; variants: { externalId: string }[] };
    createdProducts.push(product.externalId);
    const variantId = product.variants[0].externalId;

    // ── 4. checkout as a stranger → a Pending order + a real Stripe session ──
    const checkout = await api.checkout({
      shopSlug,
      items: [{ variantId, quantity: 1 }],
      customerName: 'Flagship Buyer',
      email: 'flagship-buyer@example.invalid',
      fulfilment: FULFILMENT_PICKUP,
      shipping: null,
    });
    expect(checkout.status(), await checkout.text()).toBe(OK);
    const session = (await checkout.json()) as { orderId: string; checkoutUrl: string; grandTotal: number };
    const sessionId = extractCheckoutSessionId(session.checkoutUrl);
    expect(sessionId, 'a real Stripe Checkout Session id on the merchant account').not.toBeNull();

    // ── 5. drive the merchant's own webhook (signed with THEIR whsec) → order Paid ──
    const amountMinor = Math.round(session.grandTotal * 100);
    const rawBody = buildCheckoutCompletedBody(sessionId!, amountMinor);
    const signature = signStripeEvent(rawBody, keys!.webhook);
    const webhookRes = await ctx.post(`${AGORA_API_URL}${AGORA_API_PREFIX}/webhooks/stripe/${shopId}`, {
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
      data: rawBody,
    });
    expect(webhookRes.status(), await webhookRes.text()).toBe(OK);

    // ── 6. the order is Paid, snapshotted, and offers only legal transitions ──
    const orderRes = await api.getOrder(session.orderId);
    expect(orderRes.status(), await orderRes.text()).toBe(OK);
    const order = (await orderRes.json()) as {
      status: string;
      items: { productName: string; unitPrice: number; quantity: number }[];
      allowedTransitions: string[];
    };
    expect(order.status, 'order Paid after the signed webhook').toBe('Paid');
    expect(order.items.length, 'snapshotted line items').toBeGreaterThan(0);
    // A Paid order may be Fulfilled or Refunded — never Cancelled (money has moved).
    expect(order.allowedTransitions).toContain('Fulfilled');
    expect(order.allowedTransitions, 'a paid order can never be Cancelled').not.toContain('Cancelled');

    // ── 7. fulfil: Paid → Fulfilled ──
    const fulfilled = await api.fulfillOrder(session.orderId);
    expect(fulfilled.status(), await fulfilled.text()).toBe(OK);
    expect(((await fulfilled.json()) as { status: string }).status).toBe('Fulfilled');
  });
});
