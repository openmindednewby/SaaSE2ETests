// ES-07 billing helpers — the honest lever that drives an Agora tenant to PAUSED.
//
// Paused is not reachable by waiting: it is either the natural end of the 30-day trial (too slow
// for a test) or a lapsed paid subscription. The only fast, real lever is AGORA'S OWN (platform)
// Stripe webhook — signature-verified against the PLATFORM webhook secret. So to pause a tenant we:
//   1. send a signed `checkout.session.completed` carrying client_reference_id=<tenantId> and a
//      synthetic customer id → the tenant goes Active and is LINKED to that Stripe customer;
//   2. send a signed `customer.subscription.deleted` for the SAME customer id → MarkPaused.
//
// 🔴 This ONLY works when a PLATFORM webhook secret matching the deployed
// `PlatformSubscriptions:Stripe:WebhookSecret` is available to the test (env
// E2E_AGORA_PLATFORM_WEBHOOK_SECRET) AND a dedicated CANARY merchant is configured (so we never
// pause merchant-a/-b that other specs write through). On staging TODAY neither is set and the
// deployed secret is empty, so the driver reports `unavailable` and the Paused proofs SKIP —
// never fake a pass. The moment the secret + canary are wired (in-cluster), these drive Paused
// for real and the same assertions run.
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { AGORA_API_URL } from './agora-helpers.js';
import { signStripeEvent, extractCheckoutSessionId } from './agora-stripe.js';
import { uniqueSuffix } from './agora-client.js';

/** `POST /api/v1/webhooks/platform-stripe` (AGORA_API_PREFIX + the endpoint route). */
const PLATFORM_WEBHOOK_PATH = '/api/v1/webhooks/platform-stripe';

/** €2/mo in minor units — the amount stamped on the synthetic checkout session. */
const PLATFORM_PRICE_MINOR = 200;

/** The exact skip message the Paused proofs annotate when the lever is unavailable. */
export const NO_PAUSED_LEVER_REASON =
  'No platform-Stripe webhook lever for PAUSED — set E2E_AGORA_PLATFORM_WEBHOOK_SECRET (matching the '
  + 'deployed PlatformSubscriptions:Stripe:WebhookSecret) AND AGORA_CANARY_MERCHANT/AGORA_CANARY_PASSWORD '
  + '(a throwaway tenant we may pause). On staging the platform secret is ABSENT, so Paused is unreachable '
  + 'without faking it — the Paused → 402 gate and Paused → read-only UI are therefore UNPROVEN here.';

/** The real platform webhook secret, or null when the lever cannot be exercised in this env. */
export function platformWebhookSecret(): string | null {
  const secret = process.env.E2E_AGORA_PLATFORM_WEBHOOK_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

/** A dedicated CANARY merchant we may drive to Paused, or null when none is configured. */
export function canaryCreds(): { username: string; password: string } | null {
  const username = process.env.AGORA_CANARY_MERCHANT?.trim();
  const password = process.env.AGORA_CANARY_PASSWORD?.trim() ?? process.env.AGORA_TEST_PASSWORD?.trim();
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

/** Synthetic Stripe ids for one drive-to-paused run — unique so ProcessedEvents never collapses them. */
export interface SyntheticStripeRefs {
  customerId: string;
  subscriptionId: string;
  checkoutSessionId: string;
}

export function newSyntheticRefs(): SyntheticStripeRefs {
  const s = uniqueSuffix();
  return {
    customerId: `cus_e2e${s.replace(/-/g, '')}`,
    subscriptionId: `sub_e2e${s.replace(/-/g, '')}`,
    checkoutSessionId: `cs_test_e2e${s.replace(/-/g, '')}`,
  };
}

/**
 * A raw `checkout.session.completed` body Agora's PlatformStripeEventReader accepts. `client_reference_id`
 * is the tenant id the shared package stamps when it opens the session — the reader trusts it once the
 * signature verifies and routes the event to that tenant (MarkActive + LinkStripe). Envelope fields
 * (`created`/`livemode`/`pending_webhooks`/`request`) are present because Stripe.net's parser
 * dereferences them unconditionally.
 */
export function buildPlatformCheckoutCompletedBody(tenantId: string, refs: SyntheticStripeRefs): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id: `evt_${refs.checkoutSessionId}`,
    object: 'event',
    api_version: '2024-06-20',
    created: nowSec,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: {
      object: {
        id: refs.checkoutSessionId,
        object: 'checkout.session',
        client_reference_id: tenantId,
        customer: refs.customerId,
        subscription: refs.subscriptionId,
        amount_total: PLATFORM_PRICE_MINOR,
        currency: 'eur',
        payment_status: 'paid',
        status: 'complete',
        mode: 'subscription',
      },
    },
  });
}

/**
 * A raw `customer.subscription.deleted` body for the SAME customer — resolved back to the tenant via
 * the store, then MarkPaused. `status: 'canceled'` mirrors a real cancellation/lapse.
 */
export function buildPlatformSubscriptionDeletedBody(refs: SyntheticStripeRefs): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id: `evt_del_${refs.subscriptionId}`,
    object: 'event',
    api_version: '2024-06-20',
    created: nowSec,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: refs.subscriptionId,
        object: 'subscription',
        customer: refs.customerId,
        status: 'canceled',
      },
    },
  });
}

/** A raw `customer.subscription.updated` → active body, to RESTORE a paused canary after the test. */
export function buildPlatformSubscriptionActiveBody(refs: SyntheticStripeRefs): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const oneMonth = 30 * 24 * 60 * 60;
  return JSON.stringify({
    id: `evt_upd_${refs.subscriptionId}_${uniqueSuffix()}`,
    object: 'event',
    api_version: '2024-06-20',
    created: nowSec,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: refs.subscriptionId,
        object: 'subscription',
        customer: refs.customerId,
        status: 'active',
        current_period_end: nowSec + oneMonth,
      },
    },
  });
}

/** POST a signed platform-webhook body. Own context is passed in (staging serves a self-signed cert). */
export function postPlatformWebhook(
  ctx: APIRequestContext,
  rawBody: string,
  secret: string,
): Promise<APIResponse> {
  return ctx.post(`${AGORA_API_URL}${PLATFORM_WEBHOOK_PATH}`, {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripeEvent(rawBody, secret) },
    data: rawBody,
  });
}

// Re-export so specs import billing helpers from one module.
export { extractCheckoutSessionId };
