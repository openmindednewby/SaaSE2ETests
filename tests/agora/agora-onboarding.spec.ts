// Agora ES-08 onboarding — @api tier: the cheap, fast (no browser) assertions that back the
// flagship browse-only journey the @ui tier drives through a real wizard.
//
// Two things this tier proves that the heavy browser test shouldn't spend its 30s budget on:
//   1. GET /shop/slug-available is a LIVE check — a known-taken slug (`demo`) reports unavailable
//      with a suggestion; a fresh slug reports available. (The wizard's step-1 field sits on this.)
//   2. The browse-only INVARIANT end-to-end at the API tier: the onboarding merchant creates a shop
//      + product and publishes with NO Stripe → the shop goes live but `acceptsOrders:false`, and an
//      anonymous POST /checkout is refused with 409 SHOP_NOT_ACCEPTING_ORDERS. This is exactly why
//      browse-only was built (publish with no owner Stripe key), so it is the load-bearing claim.
//
// Subject: the seeded, agora-realm, (initially) shopless `agora-merchant-b` — a NEW merchant can't
// be registered on staging (identity-api rejects the `agora` realm; see agora-onboarding-helpers).
// The shop is upserted + published then unpublished + swept in `finally`, so it's nightly-safe.
//
// 🔒 SKIP-GATED (house pattern): every test test.skips with a reason when agora-api is unreachable
// or a merchant token can't be minted (the dev PC can't always reach WireGuard-only staging).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi } from './agora-client.js';
import {
  AGORA_API_PREFIX,
  AGORA_API_URL,
  MERCHANT_A,
  bearer,
  getAgoraToken,
  tryRequest,
} from './agora-helpers.js';
import {
  ONBOARDING_MERCHANT,
  ONBOARDING_SHOP_NAME,
  ONBOARDING_SHOP_SLUG,
  cleanupOnboardingShop,
  uniqueProductName,
} from './agora-onboarding-helpers.js';

const OK = 200;
const CONFLICT = 409;
const PRODUCT_PRICE = 12.5;
const PRODUCT_STOCK = 25;
// FulfilmentMethod on the wire: Delivery = 0 (needs a shipping address), Pickup = 1 (does not).
// Pickup is what lets the browse-only 409 fire — a Delivery request 400s on the missing address
// BEFORE the handler's acceptsOrders gate is reached.
const FULFILMENT_PICKUP = 1;

test.describe('Agora ES-08 onboarding @agora-api @agora-onboarding', () => {
  let ctx: APIRequestContext;
  let reachable = false;

  test.beforeAll(async ({ playwright }) => {
    // Own context (not the `request` fixture): AGORA_API_URL is the staging ingress with a
    // self-signed cert.
    ctx = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    reachable = Boolean(await tryRequest(ctx, '/health/ready'));
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  // ---------------------------------------------------------------- slug check (cheap)
  test('GET /shop/slug-available is a live check: `demo` taken (+suggestion), a fresh slug free', async () => {
    test.skip(!reachable, `agora-api not reachable at ${AGORA_API_URL}`);
    const token = await getAgoraToken(MERCHANT_A);
    test.skip(!token, 'could not mint a MERCHANT_A token (KC creds/URL unset)');

    const check = async (slug: string): Promise<Record<string, unknown>> => {
      const res = await ctx.get(`${AGORA_API_URL}${AGORA_API_PREFIX}/shop/slug-available`, {
        headers: bearer(token as string),
        params: { slug },
      });
      expect(res.ok(), `slug-available(${slug}) -> ${res.status()}`).toBeTruthy();
      return (await res.json()) as Record<string, unknown>;
    };

    // A known, seeded, published shop's slug — taken for any OTHER tenant, with a suggestion.
    const taken = await check('demo');
    expect(taken.available, '`demo` must read as taken for a non-owning merchant').toBe(false);
    expect(typeof taken.suggestion, 'a taken slug must carry a nearby suggestion').toBe('string');
    expect((taken.suggestion as string).length, 'the suggestion must be non-empty').toBeGreaterThan(0);

    // A fresh, unique slug nobody owns — free.
    const freeSlug = `es08free${randomUUID().slice(0, 8)}`;
    const free = await check(freeSlug);
    expect(free.available, `${freeSlug} must read as available`).toBe(true);
    // The server normalises the address it echoes back.
    expect(typeof free.normalizedSlug).toBe('string');
  });

  // ------------------------------------------------- browse-only invariant (full API journey)
  test('publishing without Stripe → live but acceptsOrders:false, and checkout 409s browse-only', async () => {
    test.skip(!reachable, `agora-api not reachable at ${AGORA_API_URL}`);
    const token = await getAgoraToken(ONBOARDING_MERCHANT);
    test.skip(!token, 'could not mint an onboarding-merchant token');
    const api = new AgoraApi(ctx, token as string);

    try {
      // Reading billing STARTS the merchant's 30-day trial (GetOrStartTrial) — the write endpoints
      // below sit behind the PaidPlan gate, which a Trialing tenant passes.
      const billing = await api.getBillingSubscription();
      expect(billing.ok(), `GET /billing/subscription -> ${billing.status()}`).toBeTruthy();

      // Create the shop (UPSERT) — NO Stripe anywhere in this flow.
      const shopRes = await api.updateShop({
        name: ONBOARDING_SHOP_NAME,
        slug: ONBOARDING_SHOP_SLUG,
        currency: 'EUR',
        contactEmail: 'onboarding-b@example.com',
      });
      expect(shopRes.ok(), `PUT /shop -> ${shopRes.status()}`).toBeTruthy();

      // A product — publishing needs at least one (the content-only canPublish gate).
      const prodRes = await api.createProduct({
        name: uniqueProductName(),
        description: 'ES-08 @api browse-only fixture.',
        categoryId: null,
        sortOrder: 0,
        price: PRODUCT_PRICE,
        stockCount: PRODUCT_STOCK,
        sku: `ES08-${randomUUID().slice(0, 8)}`,
        variants: null,
      });
      expect(prodRes.ok(), `POST /products -> ${prodRes.status()}`).toBeTruthy();

      // Publish with NO Stripe → SUCCEEDS in browse-only (ES-08). The old ES-06 invariant
      // ("no publish without Stripe") is gone; this is the whole point of the feature.
      const pubRes = await api.publishShop();
      expect(pubRes.status(), `POST /shop/publish -> ${pubRes.status()} (browse-only must succeed)`).toBe(OK);
      const shop = (await pubRes.json()) as Record<string, unknown>;
      expect(shop.isPublished, 'the shop must be published').toBe(true);
      expect(shop.acceptsOrders, 'a browse-only shop must NOT accept orders (no Stripe)').toBe(false);

      // The PUBLIC storefront sees a live, browse-only shop that lists the product.
      const sf = await ctx.get(`${AGORA_API_URL}${AGORA_API_PREFIX}/storefront/${ONBOARDING_SHOP_SLUG}`, {
        timeout: 15_000,
      });
      expect(sf.ok(), `GET /storefront/${ONBOARDING_SHOP_SLUG} -> ${sf.status()}`).toBeTruthy();
      const sfShop = (await sf.json()) as Record<string, unknown>;
      expect(sfShop.published ?? sfShop.isPublished, 'storefront must show the shop as published').toBe(true);
      expect(sfShop.acceptsOrders, 'storefront shop must report browse-only').toBe(false);

      // An anonymous checkout is REFUSED. Pickup (fulfilment 1) so the request is otherwise valid;
      // the AcceptsOrders gate fires before any variant lookup, so a random valid variant Guid 409s.
      const checkoutRes = await api.checkout({
        shopSlug: ONBOARDING_SHOP_SLUG,
        items: [{ variantId: randomUUID(), quantity: 1 }],
        customerName: 'Anon Buyer',
        email: 'buyer@example.com',
        fulfilment: FULFILMENT_PICKUP,
      });
      expect(checkoutRes.status(), `POST /checkout -> ${checkoutRes.status()} (must be 409)`).toBe(CONFLICT);
      // The error code is carried in the ProblemDetails body (…[SHOP_NOT_ACCEPTING_ORDERS]).
      expect(await checkoutRes.text()).toContain('SHOP_NOT_ACCEPTING_ORDERS');
    } finally {
      const note = await cleanupOnboardingShop(ctx, token as string);
      process.stdout.write(`[agora-onboarding-api-cleanup] ${note}\n`);
    }
  });
});
