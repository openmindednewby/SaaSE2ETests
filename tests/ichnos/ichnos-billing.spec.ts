// @api tier for F7 billing (M1-10, M1-7). Asserts the plan catalog (free/starter/growth/scale with their
// included monthly credits + the featured Growth tier), the credit-pack catalog, and the Stripe-Checkout
// URL contract for a subscription + a credit-pack top-up. The unauthenticated negatives always run; the
// authed catalog + checkout assertions run opportunistically with an ichnos tenant token.
//
// NOTE: webhook-driven credit GRANTS and plan-GATE transitions are NOT E2E'd here — Stripe cannot reach
// staging to deliver the completed-checkout webhook. Those are covered by the service's unit tests
// (CreditPackGrantService / PlanGate). This tier proves the catalog + the hosted-checkout hand-off only.
import { expect, test } from '@playwright/test';
import { ICHNOS_API_URL, getIchnosToken, tryRequest } from './ichnos-helpers.js';

const PLANS_PATH = '/v1/billing/plans';
const PACKS_PATH = '/v1/billing/credit-packs';
const SUB_CHECKOUT_PATH = '/v1/billing/subscription/checkout';
const PACK_CHECKOUT_PATH = '/v1/billing/credit-packs/pack_small/checkout';
const STRIPE_CHECKOUT_PREFIX = 'https://checkout.stripe.com/';
const NOT_CONFIGURED = 501;

interface PlanDto {
  code: string;
  monthlyPriceEur: number;
  includedMonthlyCredits: number;
  isFeatured: boolean;
}
interface PackDto {
  code: string;
  priceEur: number;
  creditsGranted: number;
}

const EXPECTED_PLANS: Record<string, { price: number; credits: number }> = {
  free: { price: 0, credits: 0 },
  starter: { price: 149, credits: 300 },
  growth: { price: 499, credits: 1500 },
  scale: { price: 1490, credits: 6000 },
};

const EXPECTED_PACKS: Record<string, { price: number; credits: number }> = {
  pack_small: { price: 9, credits: 100 },
  pack_medium: { price: 39, credits: 500 },
  pack_large: { price: 129, credits: 2000 },
};

test.describe('Ichnos billing @ichnos-api', () => {
  test('rejects an unauthenticated plan-catalog read', async ({ request }) => {
    const result = await tryRequest(request, PLANS_PATH);
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('rejects an unauthenticated subscription checkout', async ({ request }) => {
    const result = await tryRequest(request, SUB_CHECKOUT_PATH, {
      method: 'POST',
      data: { planCode: 'growth' },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('returns the plan catalog with included credits and a featured Growth tier', async ({ request }) => {
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
      return;
    }
    const result = await tryRequest(request, PLANS_PATH, { headers: { Authorization: `Bearer ${token}` } });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect(result.response.status(), await result.response.text()).toBe(200);
    const body = (await result.response.json()) as { currency: string; plans: PlanDto[] };
    expect(body.currency).toBe('EUR');

    for (const [code, expected] of Object.entries(EXPECTED_PLANS)) {
      const plan = body.plans.find((p) => p.code === code);
      expect(plan, `plan ${code} present`).toBeDefined();
      expect(plan!.monthlyPriceEur).toBe(expected.price);
      expect(plan!.includedMonthlyCredits).toBe(expected.credits);
    }
    expect(body.plans.find((p) => p.code === 'growth')!.isFeatured).toBe(true);
  });

  test('returns the credit-pack catalog', async ({ request }) => {
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token configured');
      return;
    }
    const result = await tryRequest(request, PACKS_PATH, { headers: { Authorization: `Bearer ${token}` } });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect(result.response.status(), await result.response.text()).toBe(200);
    const body = (await result.response.json()) as { currency: string; packs: PackDto[] };
    expect(body.currency).toBe('EUR');
    for (const [code, expected] of Object.entries(EXPECTED_PACKS)) {
      const pack = body.packs.find((p) => p.code === code);
      expect(pack, `pack ${code} present`).toBeDefined();
      expect(pack!.priceEur).toBe(expected.price);
      expect(pack!.creditsGranted).toBe(expected.credits);
    }
  });

  test('starts a Stripe subscription checkout (or reports billing not configured)', async ({ request }) => {
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token configured');
      return;
    }
    const result = await tryRequest(request, SUB_CHECKOUT_PATH, {
      method: 'POST',
      data: { planCode: 'growth' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(result).not.toBeNull();
    const status = result!.response.status();
    if (status === NOT_CONFIGURED) {
      test.skip(true, 'Stripe billing is not configured in this environment (501)');
      return;
    }
    expect(status, await result!.response.text()).toBe(200);
    const body = (await result!.response.json()) as { checkoutUrl: string };
    expect(body.checkoutUrl.startsWith(STRIPE_CHECKOUT_PREFIX), `checkoutUrl=${body.checkoutUrl}`).toBeTruthy();
  });

  test('starts a Stripe credit-pack checkout (or reports billing not configured)', async ({ request }) => {
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token configured');
      return;
    }
    const result = await tryRequest(request, PACK_CHECKOUT_PATH, {
      method: 'POST',
      data: {},
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(result).not.toBeNull();
    const status = result!.response.status();
    if (status === NOT_CONFIGURED) {
      test.skip(true, 'Stripe billing is not configured in this environment (501)');
      return;
    }
    expect(status, await result!.response.text()).toBe(200);
    const body = (await result!.response.json()) as { checkoutUrl: string };
    expect(body.checkoutUrl.startsWith(STRIPE_CHECKOUT_PREFIX), `checkoutUrl=${body.checkoutUrl}`).toBeTruthy();
  });
});
