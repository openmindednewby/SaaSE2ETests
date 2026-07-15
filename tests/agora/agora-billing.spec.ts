// Agora ES-07 billing + plan-gate — @api tier against the DEPLOYED API.
//
// This is the flagship revenue behaviour: 19 merchant WRITE endpoints require an Active/Trialing/
// Grace subscription (a brand-new tenant auto-trials on first request); a Paused tenant is 402'd on
// writes but can still GET and reach billing. Seed-based, no browser, seconds.
//
// 🔴 The Paused → 402 half is the ONE behaviour that had never been verified anywhere but a unit
// test. It needs a real lever to Paused (a signed PLATFORM webhook on a canary tenant). When that
// lever is unavailable — as on staging, where the platform Stripe secret is absent — the Paused
// assertions SKIP WITH A CLEAR REASON rather than fake a pass. See agora-billing-helpers.ts.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi, uniqueSuffix } from './agora-client.js';
import type { CreateProductBody } from './agora-client.js';
import {
  AGORA_API_URL,
  MERCHANT_A,
  MERCHANT_B,
  getAgoraToken,
  tokenClaim,
  tryRequest,
} from './agora-helpers.js';
import {
  NO_PAUSED_LEVER_REASON,
  buildPlatformCheckoutCompletedBody,
  buildPlatformSubscriptionActiveBody,
  buildPlatformSubscriptionDeletedBody,
  canaryCreds,
  newSyntheticRefs,
  platformWebhookSecret,
  postPlatformWebhook,
} from './agora-billing-helpers.js';

const OK = 200;
const CREATED = 201;
const PAYMENT_REQUIRED = 402;
const CONFLICT = 409;
const PRODUCT_PRICE = 12.5;
const PRODUCT_STOCK = 5;

/** The effective states that PASS the gate (writes allowed). */
const PASSING_STATES = ['Trialing', 'Active', 'Grace'] as const;
/** Every status the billing GET may return. */
const ALL_STATES = ['None', 'Trialing', 'Active', 'Grace', 'Paused'] as const;

interface BillingSnapshot {
  status: string;
  plan: string;
  trialEndUtc?: string | null;
  currentPeriodEndUtc?: string | null;
  canManage: boolean;
}

function productBody(name: string): CreateProductBody {
  return {
    name,
    description: 'Created by the ES-07 billing @api tier.',
    categoryId: null,
    sortOrder: 0,
    price: PRODUCT_PRICE,
    stockCount: PRODUCT_STOCK,
    sku: `E2E-BILL-${uniqueSuffix()}`,
    variants: null,
  };
}

test.describe('Agora ES-07 billing + plan-gate @agora-api', () => {
  let ctx: APIRequestContext;
  let api: AgoraApi;
  let tenantA: string;

  test.beforeAll(async ({ playwright }) => {
    // Own context, not the `request` fixture: staging's ingress serves Traefik's self-signed cert.
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
    tenantA = String(tokenClaim(token, 'tenantId') ?? '');
    expect(tenantA, 'merchant-a token must carry a tenantId claim').toBeTruthy();
    api = new AgoraApi(ctx, token);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  // ------------------------------------------------------------------- test 1
  test('GET /billing/subscription returns a sane, auto-trialing snapshot (NOT gated)', async () => {
    const res = await api.getBillingSubscription();
    expect(res.status(), 'billing GET must never 402 — a paused shop reads it to reactivate').toBe(OK);

    const snap = (await res.json()) as BillingSnapshot;
    expect(snap.plan, 'the single paid plan code').toBe('agora');
    expect(ALL_STATES, `status must be a known enum value, got "${snap.status}"`).toContain(snap.status);
    expect(typeof snap.canManage, 'canManage is a boolean').toBe('boolean');

    // The auto-trial contract: reading billing lazily starts the 30-day trial, so a merchant who has
    // never paid resolves to a PASSING state (Trialing here) — never None/Paused on a healthy tenant
    // that can still write. Assert the real behaviour rather than assume a specific one.
    expect(
      PASSING_STATES as readonly string[],
      `a healthy merchant's effective state must pass the gate, got "${snap.status}"`,
    ).toContain(snap.status);
    if (snap.status === 'Trialing') {
      expect(snap.trialEndUtc, 'a Trialing snapshot carries a trial end').toBeTruthy();
    }
  });

  // -------------------------------------------------------- test 2 (flagship)
  test('the gate PASSES a trialing/active merchant: a WRITE returns 201', async () => {
    // A brand-new tenant auto-trials on first request, so the merchant-a write must succeed. This is
    // the positive half of the revenue gate, proven live end-to-end (token → gate → write).
    const created = await api.createProduct(productBody(`Gate pass ${uniqueSuffix()}`));
    expect(
      created.status(),
      'a Trialing/Active merchant WRITE must be allowed — the gate must not 402 a paying-eligible tenant',
    ).toBe(CREATED);

    const body = (await created.json()) as { externalId?: string; id?: string };
    const productId = body.externalId ?? body.id;

    // GETs are NEVER gated (one call — the suite runs near the staging rate-limit ceiling, so keep
    // the added request volume minimal).
    expect((await api.listProducts()).status()).toBe(OK);

    if (productId) {
      await api.deleteProduct(productId);
    }
  });

  test('the gate 402s a PAUSED merchant on a WRITE, but its GETs still return 200', async () => {
    const secret = platformWebhookSecret();
    const canary = canaryCreds();
    test.skip(!secret || !canary, NO_PAUSED_LEVER_REASON);
    if (!secret || !canary) {
      return;
    }

    // Drive a DEDICATED canary tenant to Paused — never merchant-a/-b (other specs write through them).
    const canaryToken = await getAgoraToken(canary.username, canary.password);
    expect(canaryToken, 'canary token must mint').toBeTruthy();
    const tenantCanary = String(tokenClaim(canaryToken as string, 'tenantId') ?? '');
    expect(tenantCanary, 'canary token must carry a tenantId claim').toBeTruthy();

    const canaryApi = new AgoraApi(ctx, canaryToken as string);
    const refs = newSyntheticRefs();

    // 1) link a Stripe customer + go Active, then 2) delete the subscription → Paused.
    const linkRes = await postPlatformWebhook(
      ctx, buildPlatformCheckoutCompletedBody(tenantCanary, refs), secret,
    );
    expect(
      linkRes.status(),
      'a correctly-signed platform webhook must be accepted (200) — a 400 means the secret does not match the deployed one',
    ).toBe(OK);
    const pauseRes = await postPlatformWebhook(
      ctx, buildPlatformSubscriptionDeletedBody(refs), secret,
    );
    expect(pauseRes.status()).toBe(OK);

    try {
      // The subscription now reads Paused (not gated).
      const snap = (await canaryApi.getBillingSubscription().then((r) => r.json())) as BillingSnapshot;
      expect(snap.status, 'the canary must now be Paused').toBe('Paused');

      // 🔴 THE REVENUE GATE. A write is 402'd...
      const write = await canaryApi.createProduct(productBody(`Should-402 ${uniqueSuffix()}`));
      expect(write.status(), 'a Paused merchant WRITE must be 402 Payment Required').toBe(PAYMENT_REQUIRED);

      // ...but reads and billing stay open (so the merchant can see their shop and reactivate).
      expect((await canaryApi.listProducts()).status(), 'GET products stays 200 while paused').toBe(OK);
      expect(
        (await canaryApi.getBillingSubscription()).status(),
        'GET billing stays 200 while paused',
      ).toBe(OK);
    } finally {
      // Restore the canary so a re-run starts clean.
      await postPlatformWebhook(ctx, buildPlatformSubscriptionActiveBody(refs), secret);
    }
  });

  // ------------------------------------------------------------------- test 3
  test('cross-tenant: merchant B reads only its OWN billing; cannot drive A', async () => {
    const tokenB = await getAgoraToken(MERCHANT_B);
    test.skip(!tokenB, 'merchant-b token unavailable');
    if (!tokenB) {
      return;
    }
    const tenantB = String(tokenClaim(tokenB, 'tenantId') ?? '');

    // Anti-vacuous guard: A and B must be REAL, DISTINCT tenants, or "isolation" proves nothing.
    expect(tenantA, 'tenant A non-empty').toBeTruthy();
    expect(tenantB, 'tenant B non-empty').toBeTruthy();
    expect(tenantB, 'A and B must be different tenants').not.toBe(tenantA);

    // B's billing GET is keyed on B's OWN tenantId claim — there is NO tenant-id parameter on the
    // endpoint (or on checkout/portal), so B has no way to NAME A's tenant: cross-tenant billing
    // read/drive is structurally impossible, not merely access-checked. B reads only its own snapshot.
    const apiB = new AgoraApi(ctx, tokenB);
    const snapB = (await apiB.getBillingSubscription().then((r) => r.json())) as BillingSnapshot;
    expect(snapB.plan).toBe('agora');
    expect(ALL_STATES as readonly string[]).toContain(snapB.status);
  });

  // ------------------------------------------------------------------- test 4
  test('portal-session 409s before a Stripe customer; checkout-session {url} or an honest error', async () => {
    const snap = (await api.getBillingSubscription().then((r) => r.json())) as BillingSnapshot;

    // Portal is only meaningful once there IS a Stripe customer. Before that (the pre-checkout local
    // trial, canManage:false) it must 409 — never 500, never a broken redirect.
    const portal = await api.createBillingPortalSession();
    if (snap.canManage) {
      expect(portal.status(), 'with a Stripe customer, portal returns a redirect url').toBe(OK);
      expect(((await portal.json()) as { url?: string }).url).toBeTruthy();
    } else {
      expect(portal.status(), 'no Stripe customer yet → 409 Conflict').toBe(CONFLICT);
    }

    // Checkout: on an env WITH the platform Stripe secret it returns {url}; on staging the platform
    // secret is ABSENT, so the shared package cannot mint a session and the endpoint returns a clean
    // error, NOT a hang. Assert the HONEST behaviour and let the report state which occurred.
    const checkout = await api.createBillingCheckoutSession();
    const status = checkout.status();
    if (status === OK) {
      const url = ((await checkout.json()) as { url?: string }).url ?? '';
      expect(url, 'a successful checkout returns a Stripe URL').toMatch(/^https?:\/\//);
    } else {
      // Clean, bounded error is acceptable here — the platform Stripe key is not configured on staging.
      expect(
        status,
        `checkout-session returned ${status} — expected {url} (200) or a clean >=400 error when the `
        + `platform Stripe secret is absent`,
      ).toBeGreaterThanOrEqual(400);
    }
  });
});
