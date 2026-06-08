/**
 * Synthetic Stripe-webhook event signer for the Kefi attendee-payment E2E (#177).
 *
 * Layer 1 of the spec proves the reconciliation path WITHOUT any external Stripe
 * account: we hand-build the exact event envelope the Stripe .NET SDK
 * (`EventUtility.ConstructEvent`) deserializes on the server, then sign it the
 * same way Stripe does — `t={unixSeconds},v1={hex HMAC-SHA256 of "{t}.{body}"}`
 * keyed by the tenant's stored webhook secret (a `whsec_…` value we also generate
 * in-test). The server decrypts its stored copy of the same secret and verifies,
 * so a correctly-signed synthetic event is indistinguishable from a real one.
 *
 * Pure + dependency-free (node:crypto only) so it can be unit-asserted in
 * isolation and keeps the HTTP client (kefiLifecycleClient) under its size cap.
 */

import * as crypto from 'node:crypto';

const WEBHOOK_SECRET_BYTES = 24;
const STRIPE_API_VERSION = '2024-06-20';

/** Mint a fresh, shape-valid `whsec_…` test webhook secret (passes the server's `whsec_`/min-12/no-whitespace validator). */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(WEBHOOK_SECRET_BYTES).toString('hex')}`;
}

/** Mint a deterministic-per-canary dummy secret key (`sk_test_e2e_dummy_<canaryId>`) — never hits Stripe in Layer 1. */
export function dummySecretKey(canaryId: string): string {
  return `sk_test_e2e_dummy_${canaryId}`;
}

/**
 * Wrap a `data.object` in the full Stripe event envelope. The envelope fields are
 * the ones the SDK's deserializer expects to find; only `type` + `data.object`
 * drive the server's branch logic, the rest are present so deserialization never
 * trips. Returns the canonical JSON string (this exact string must be signed).
 */
export function buildStripeEventBody(type: string, dataObject: Record<string, unknown>): string {
  const envelope = {
    id: `evt_e2e_${crypto.randomBytes(12).toString('hex')}`,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: dataObject },
  };
  return JSON.stringify(envelope);
}

/**
 * Build a `checkout.session.completed` event body whose session carries the
 * attendee external id as `client_reference_id` (what the server parses to a
 * Guid) and `amount_total` in minor units (cents) so the recorded EUR matches.
 */
export function buildCheckoutCompletedBody(input: {
  attendeeExternalId: string;
  amountTotalCents: number;
}): string {
  const session = {
    id: `cs_test_${crypto.randomBytes(12).toString('hex')}`,
    object: 'checkout.session',
    client_reference_id: input.attendeeExternalId,
    amount_total: input.amountTotalCents,
    currency: 'eur',
    payment_status: 'paid',
    status: 'complete',
    mode: 'payment',
    metadata: { attendeeExternalId: input.attendeeExternalId },
  };
  return buildStripeEventBody('checkout.session.completed', session);
}

/**
 * Build a `charge.refunded` event body whose charge carries
 * `metadata.attendeeExternalId` — the server reads this directly (no PaymentIntent
 * round-trip, so no live Stripe key needed) and flips the attendee to Cancelled.
 */
export function buildChargeRefundedBody(attendeeExternalId: string): string {
  const charge = {
    id: `ch_test_${crypto.randomBytes(12).toString('hex')}`,
    object: 'charge',
    refunded: true,
    payment_intent: null,
    metadata: { attendeeExternalId },
  };
  return buildStripeEventBody('charge.refunded', charge);
}

/**
 * Produce the `Stripe-Signature` header for a raw body + webhook secret, exactly
 * as Stripe does: `t={unixSeconds},v1={hex HMAC-SHA256 of "{t}.{rawBody}"}`. Pass
 * `overrideSecret` (any wrong `whsec_…`) to forge a bad signature for the
 * negative-path assertion.
 */
export function signStripeEvent(rawBody: string, webhookSecret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}
