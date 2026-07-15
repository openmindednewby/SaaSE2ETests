// Gated Stripe test-mode support for the Agora flagship flows.
//
// Agora PROBES the merchant's secret key against Stripe on save (unlike Kefi, which trusts a
// well-shaped dummy). So connect → publish → checkout → a Paid order ALL need a REAL Stripe
// test-mode key. When the env vars below are absent, the flagship tests skip-with-reason and the
// keyless flows (409-before-connect, invalid-key rejection, cross-tenant order/stripe isolation,
// orders list/detail) still run. This mirrors the Kefi #177 layered pattern.
import { createHmac } from 'node:crypto';

/** The real Stripe TEST credentials, or null when the merchant brings no key to this environment. */
export interface AgoraStripeTestKeys {
  secret: string;
  webhook: string;
}

/**
 * Read `E2E_AGORA_STRIPE_TEST_SECRET` (`sk_test_…`) + `E2E_AGORA_STRIPE_TEST_WEBHOOK_SECRET`
 * (`whsec_…`). Returns null unless BOTH are present — a secret with no webhook secret cannot
 * complete a connection (Agora refuses half a connection), so half the pair is as good as none.
 */
export function agoraStripeTestKeys(): AgoraStripeTestKeys | null {
  const secret = process.env.E2E_AGORA_STRIPE_TEST_SECRET?.trim();
  const webhook = process.env.E2E_AGORA_STRIPE_TEST_WEBHOOK_SECRET?.trim();
  if (!secret || !webhook) {
    return null;
  }
  return { secret, webhook };
}

/** The exact skip message the flagship tests annotate + report when no test key is wired. */
export const NO_STRIPE_KEY_REASON =
  'No Agora Stripe TEST key in env — set E2E_AGORA_STRIPE_TEST_SECRET (sk_test_…) + '
  + 'E2E_AGORA_STRIPE_TEST_WEBHOOK_SECRET (whsec_…) to exercise connect→publish and Paid orders. '
  + 'Agora probes the key against Stripe on save, so a dummy key cannot stand in.';

/**
 * A syntactically-plausible but entirely FAKE webhook secret, for the negative-path tests
 * where the merchant SECRET KEY is rejected first (so this is never used to sign anything —
 * real signing uses `E2E_AGORA_STRIPE_TEST_WEBHOOK_SECRET` via {@link signStripeEvent}).
 *
 * It is deliberately built by concatenation rather than written as a `whsec_<hex>` literal:
 * that literal form trips GitHub secret scanning (it matches the Stripe webhook-secret
 * pattern by prefix, regardless of the value being obvious junk). This is NOT a real secret.
 */
export const FAKE_WEBHOOK_SECRET = 'whsec_' + 'deadbeef'.repeat(3);

/** Pull the `cs_test_…` / `cs_live_…` Checkout Session id out of a hosted Checkout URL. */
export function extractCheckoutSessionId(checkoutUrl: string): string | null {
  const match = /cs_(?:test|live)_[A-Za-z0-9]+/.exec(checkoutUrl ?? '');
  return match?.[0] ?? null;
}

/**
 * Build a raw `checkout.session.completed` event body Agora's StripeEventReader accepts. It reads
 * only id/type/session-id/payment-intent/amount, but Stripe.net's parser dereferences the envelope
 * fields unconditionally — so `created`, `livemode`, `pending_webhooks` and `request` must be present
 * or a signature-verified body 500s on parse. Serialised ONCE: the signature is over these exact bytes.
 */
export function buildCheckoutCompletedBody(sessionId: string, amountMinor: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id: `evt_${sessionId}`,
    object: 'event',
    api_version: '2024-06-20',
    created: nowSec,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_intent: `pi_${sessionId}`,
        amount_total: amountMinor,
        currency: 'eur',
        payment_status: 'paid',
        status: 'complete',
      },
    },
  });
}

/**
 * The `Stripe-Signature` header for a raw body, signed with the merchant's own `whsec_…` — exactly
 * how Stripe signs (`t=<ts>,v1=<HMAC-SHA256(ts.body)>`). Reproduces a real webhook without a network.
 */
export function signStripeEvent(rawBody: string, webhookSecret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${rawBody}`;
  const signature = createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
