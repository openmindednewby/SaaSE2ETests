/**
 * Kefi attendee Stripe-Checkout payment E2E (#177).
 *
 * Proves the attendee card-payment story end-to-end through the real surfaces.
 * Two layers, designed so the WHOLE spec is green WITHOUT any external Stripe
 * account; the live-session layer activates only when a Stripe TEST key is in env.
 *
 *   Layer 1 — reconciliation (NO Stripe account; always runs):
 *     1. signup → IMAP verify → wizard → a verified canary tenant.
 *     2. seed a canary event + a PAID-tier pass (price > 0).
 *     3. as the tenant owner, store a DUMMY sk_test key + a generated whsec via
 *        PUT /admin/stripe-credentials (enabled), advertise providerKind
 *        'stripe-checkout' via PUT /admin/payment-config, assert GET
 *        /admin/payment-config reflects stripeConfigured + enabled + webhook URL.
 *     4. register an attendee (consent) → 201 + payment.providerKind ==
 *        'stripe-checkout'; capture the attendee externalId.
 *     5. synthetically SIGN a checkout.session.completed event (the same HMAC
 *        Stripe uses, keyed by the whsec we generated) → POST raw → 200 → attendee
 *        is Paid.
 *     6. replay → still 200 + still Paid (idempotent); wrong signature → 400 +
 *        attendee unchanged.
 *     7. charge.refunded with metadata.attendeeExternalId → attendee → Cancelled.
 *
 *   Layer 2 — live session creation (needs a Stripe TEST key; skips when absent):
 *     - reconfigure with the REAL test sk_/whsec_ from env, POST
 *       /t/{slug}/checkout-session → assert hostedUrl is a checkout.stripe.com URL.
 *
 * Seeding rides the #185 platform-admin canary endpoints. Runs on staging + prod
 * via E2E_TARGET; local is skipped.
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import {
  KefiLifecycleClient,
  type CanaryAttendeeState,
  type CanaryAttendeesResult,
} from '../../helpers/kefi/kefiLifecycleClient.js';
import {
  KefiPaymentClient,
  tenantIdFromWebhookUrl,
} from '../../helpers/kefi/kefiPaymentClient.js';
import {
  buildCheckoutCompletedBody,
  buildChargeRefundedBody,
  dummySecretKey,
  generateWebhookSecret,
  signStripeEvent,
} from '../../helpers/kefi/kefiStripeSign.js';
import { forceOnboardingPlan } from '../../helpers/kefi/kefiOnboardingApi.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 30 } as const;
const PRICE_CENTS = PASS.priceEur * 100;
const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const STATUS_PAID = 'Paid';
const STATUS_CANCELLED = 'Cancelled';
const STRIPE_HOSTED_URL = /^https:\/\/checkout\.stripe\.com\//;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mailbox(): KefiMailbox {
  return new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 90_000, pollIntervalMs: 2_000 });
}

test.describe('Kefi #177 attendee Stripe-Checkout payments — reconciliation + live session', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi attendee-payment E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('reconciles paid + refunded via signed webhook, mints a live session when keyed', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const payments = new KefiPaymentClient();
    const attendeeEmail = ctx.email.replace('@', '-att@');
    const webhookSecret = generateWebhookSecret();
    const secretKey = dummySecretKey(ctx.canaryId);
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    try {
      // ── 1. Create a verified canary tenant (signup → IMAP verify → wizard) ──
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await new KefiSignupSuccessPage(page).expectLoaded();

      const verifyCaptured = await mailbox().waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(verifyCaptured);
      expect(verifyUrl, 'verify URL').not.toBeNull();
      await page.goto(verifyUrl!);

      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      await wizard.fillFastPath({
        canaryPrefix: ctx.slugPrefix,
        eventDateIso: toIsoDate(new Date(Date.now() + CANARY_EVENT_DAYS_AHEAD * MS_PER_DAY)),
      });
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: ctx.email,
        password: ctx.password,
      });
      await forceOnboardingPlan({ apiUrl: getKefiUrls().apiUrl, bearer: ownerBearer, code: 'pro' });
      await wizard.finishFromReview();

      // ── 2. Seed a canary event + a PAID-tier pass (price > 0) ────────
      const seeded = await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId,
        eventDateOffsetDays: CANARY_EVENT_DAYS_AHEAD,
        status: 'Published',
        passCode: PASS.code,
        passLabel: PASS.label,
        priceEur: PASS.priceEur,
      });
      expect(seeded.found, 'canary tenant found for seeding').toBe(true);
      const slug = seeded.slug;

      // ── 3. Store dummy Stripe credentials + advertise stripe-checkout ─
      const status = await payments.updateStripeCredentials(ownerBearer, {
        stripeSecretKey: secretKey,
        stripeWebhookSecret: webhookSecret,
        stripePaymentsEnabled: true,
      });
      expect(status.stripeConfigured, 'stripeConfigured after PUT').toBe(true);
      expect(status.stripePaymentsEnabled, 'stripePaymentsEnabled after PUT').toBe(true);
      expect(status.stripeWebhookUrl, 'webhook URL returned').toBeTruthy();

      await payments.setProviderKindStripeCheckout(ownerBearer);

      const config = await payments.getPaymentConfig(ownerBearer);
      expect(config.stripeConfigured, 'GET stripeConfigured').toBe(true);
      expect(config.stripePaymentsEnabled, 'GET stripePaymentsEnabled').toBe(true);
      expect(config.stripeWebhookUrl, 'GET stripeWebhookUrl').toBeTruthy();

      const tenantId = tenantIdFromWebhookUrl(config.stripeWebhookUrl);
      const webhookUrl = payments.buildStripeWebhookUrl(tenantId);

      // ── 4. Register an attendee → 201 + providerKind advertised ──────
      const reg = await lifecycle.registerAttendeeFull({
        slug, name: 'Pay', surname: 'Canary', phone: '+35799000200',
        email: attendeeEmail, passCode: PASS.code, consentGiven: true,
      });
      expect(reg.status, 'register with consent').toBe(HTTP_CREATED);
      expect(reg.paymentProviderKind, 'register payment.providerKind').toBe('stripe-checkout');
      const attendeeId = reg.attendeeExternalId;
      expect(attendeeId, 'attendee externalId from register').toBeTruthy();

      // ── 5. Signed checkout.session.completed → attendee Paid ─────────
      const completedBody = buildCheckoutCompletedBody({
        attendeeExternalId: attendeeId!,
        amountTotalCents: PRICE_CENTS,
      });
      const completedSig = signStripeEvent(completedBody, webhookSecret);
      const paidStatus = await payments.postStripeWebhook({
        webhookUrl, rawBody: completedBody, signature: completedSig,
      });
      expect(paidStatus, 'completed webhook accepted').toBe(HTTP_OK);
      expect(
        attendeeStatus(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeId!),
        'attendee Paid after completed webhook',
      ).toBe(STATUS_PAID);

      // ── 6. Idempotent replay (still Paid) + bad signature (400, no change) ──
      const replayStatus = await payments.postStripeWebhook({
        webhookUrl, rawBody: completedBody, signature: completedSig,
      });
      expect(replayStatus, 'replayed completed webhook still 200').toBe(HTTP_OK);
      expect(
        attendeeStatus(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeId!),
        'attendee still Paid after replay',
      ).toBe(STATUS_PAID);

      const badSigStatus = await payments.postStripeWebhook({
        webhookUrl, rawBody: completedBody, signature: signStripeEvent(completedBody, generateWebhookSecret()),
      });
      expect(badSigStatus, 'wrong-signature webhook rejected').toBe(HTTP_BAD_REQUEST);
      expect(
        attendeeStatus(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeId!),
        'attendee unchanged after bad-signature webhook',
      ).toBe(STATUS_PAID);

      // ── 7. charge.refunded → attendee Cancelled ─────────────────────
      const refundBody = buildChargeRefundedBody(attendeeId!);
      const refundStatus = await payments.postStripeWebhook({
        webhookUrl, rawBody: refundBody, signature: signStripeEvent(refundBody, webhookSecret),
      });
      expect(refundStatus, 'refund webhook accepted').toBe(HTTP_OK);
      expect(
        attendeeStatus(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeId!),
        'attendee Cancelled after refund webhook',
      ).toBe(STATUS_CANCELLED);

      // ── 8. Layer 2 — live hosted-session creation (needs a real test key) ──
      await runLiveSessionLayer(payments, lifecycle, ownerBearer, slug);

      // ── 9. Mailbox hygiene (the verify mail is the only one we triggered) ──
      await mailbox().expungeMessages([verifyCaptured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

/**
 * Layer 2 — only meaningful with a real Stripe TEST key. Reconfigures the canary
 * with the env-provided sk_test_/whsec_, registers a fresh attendee, then mints a
 * real hosted Checkout session and asserts the URL shape. Skips (no failure) when
 * the env vars are absent so the suite is green before any account exists.
 */
async function runLiveSessionLayer(
  payments: KefiPaymentClient,
  lifecycle: KefiLifecycleClient,
  ownerBearer: string,
  slug: string,
): Promise<void> {
  const liveKey = process.env.E2E_KEFI_STRIPE_TEST_SECRET;
  const liveWhsec = process.env.E2E_KEFI_STRIPE_TEST_WEBHOOK_SECRET;
  if (!liveKey || !liveWhsec) {
    // No real Stripe test key in env — record WHY Layer 2 was skipped (visible in
    // the HTML report) instead of failing, so the suite is green before any
    // account exists. (console is banned in tests by lint; annotations are the
    // sanctioned channel.)
    test.info().annotations.push({
      type: 'skip-reason',
      description:
        'Layer 2 (live Checkout session) skipped — set E2E_KEFI_STRIPE_TEST_SECRET + '
        + 'E2E_KEFI_STRIPE_TEST_WEBHOOK_SECRET (sk_test_/whsec_) to exercise it.',
    });
    return;
  }

  await payments.updateStripeCredentials(ownerBearer, {
    stripeSecretKey: liveKey,
    stripeWebhookSecret: liveWhsec,
    stripePaymentsEnabled: true,
  });

  const reg = await lifecycle.registerAttendeeFull({
    slug, name: 'Live', surname: 'Canary', phone: '+35799000201',
    email: `live-${slug}@example.invalid`, passCode: PASS.code, consentGiven: true,
  });
  expect(reg.status, 'live-layer register with consent').toBe(HTTP_CREATED);
  expect(reg.attendeeExternalId, 'live-layer attendee externalId').toBeTruthy();

  const session = await payments.createCheckoutSession(slug, reg.attendeeExternalId!);
  expect(session.status, 'checkout-session created').toBe(HTTP_OK);
  expect(session.hostedUrl, 'hostedUrl present').toBeTruthy();
  expect(session.hostedUrl!, 'hostedUrl is a Stripe Checkout URL').toMatch(STRIPE_HOSTED_URL);
}

/** Resolve one attendee's status string from the canary snapshot by external id. */
function attendeeStatus(snapshot: CanaryAttendeesResult, externalId: string): string {
  const match: CanaryAttendeeState | undefined =
    snapshot.attendees.find(a => a.externalId === externalId);
  expect(match, `attendee ${externalId} present in canary snapshot`).toBeDefined();
  return match!.status;
}
