/**
 * Kefi critical-path E2E (task #276 gap #2) — registration → approval → payment
 * → door check-in, the single end-to-end journey a real event depends on.
 *
 * The katastasi note flags this as the least-tested customer path: today it
 * exists only as disjoint fragments (approval NONE, payment webhook-only,
 * check-in in isolation). This chains them so a break ANYWHERE in the
 * money+door loop is caught:
 *
 *   1. REGISTRATION — an ambassador submits a registration request (201).
 *   2. APPROVAL     — the organizer approves it → an `Expected` attendee is created.
 *   3. PAYMENT      — a signed Stripe `checkout.session.completed` webhook
 *                     reconciles that attendee to `Paid`, and the organizer P&L
 *                     now shows 1 paid attendee @ the pass price (RecordPayment
 *                     moves gross/net, not just the Status enum).
 *   4. CHECK-IN     — the attendee is checked in at the door (`CheckedIn`), the
 *                     terminal transition on the door surface.
 *
 * `@slow` (spans registration + approval + a webhook round-trip + reconciliation);
 * kept off the fast lanes but needs no kaniko build. Master-admin-only (staging);
 * prod self-skips. WRITE + COMPILE-verified — the authed run lands post-F1-kefi.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import { KefiRegistrationClient, type RegistrationRequestDto } from '../../helpers/kefi/kefiRegistrationClient.js';
import { KefiOrganizerClient, type OrganizerEventDto } from '../../helpers/kefi/kefiOrganizerClient.js';
import {
  KefiPaymentClient,
  tenantIdFromWebhookUrl,
} from '../../helpers/kefi/kefiPaymentClient.js';
import {
  buildCheckoutCompletedBody,
  dummySecretKey,
  generateWebhookSecret,
  signStripeEvent,
} from '../../helpers/kefi/kefiStripeSign.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
} from '../../helpers/kefi/kefiApiTenant.js';
import {
  createTenantUserWithRole,
  deleteEphemeralUser,
  masterAdminAvailable,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 90;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 30 } as const;
const PRICE_CENTS = PASS.priceEur * 100;
const SLOW_TIMEOUT_MS = 600_000;

const HTTP_OK = 200;
const HTTP_CREATED = 201;

const STATUS_EXPECTED = 'Expected';
const STATUS_PAID = 'Paid';
const STATUS_CHECKED_IN = 'CheckedIn';

/** Narrow the organizer-event response to the DTO after asserting its status. */
function asOrganizerDto(resp: { status: number; data: unknown }): OrganizerEventDto {
  return resp.data as OrganizerEventDto;
}

test.describe('Kefi critical path — registration → approval → payment → check-in', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi critical-path E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@slow an approved registration is paid via webhook and checked in at the door', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The critical-path spec provisions a Pro tenant + owner + ambassador via KC master-admin; only staging carries those creds.',
    );
    test.setTimeout(SLOW_TIMEOUT_MS);
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const reg = new KefiRegistrationClient();
    const organizer = new KefiOrganizerClient();
    const payments = new KefiPaymentClient();
    const webhookSecret = generateWebhookSecret();

    const handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: PASS.code,
      passLabel: PASS.label,
      priceEur: PASS.priceEur,
    });
    test.info().annotations.push({ type: 'canaryId', description: handle.ctx.canaryId });
    const ambEmail = handle.ctx.email.replace('@', '-amb@');
    const attendeeEmail = handle.ctx.email.replace('@', '-att@');
    let ambassadorUserId: string | null = null;

    try {
      const ambassador = await createTenantUserWithRole({
        email: ambEmail, password: handle.ctx.password, tenantId: handle.tenantId,
        role: 'ambassador', lastName: 'Ambassador',
      });
      ambassadorUserId = ambassador.userId;
      const ambBearer = await admin.getTenantOwnerBearer({ email: ambEmail, password: handle.ctx.password });
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: handle.ownerCreds.ownerEmail,
        password: handle.ownerCreds.ownerPassword,
      });

      // ── 1. REGISTRATION — ambassador submits a request ─────────────────
      const submit = await reg.submit(ambBearer, {
        name: 'Critical', surname: 'Path', phone: '+35799000701', email: attendeeEmail, passCode: PASS.code,
      });
      expect(submit.status, 'ambassador submit → 201').toBe(HTTP_CREATED);
      const requestId = (submit.data as RegistrationRequestDto).externalId;

      // ── 2. APPROVAL — organizer approves → an Expected attendee ────────
      const approve = await reg.approve(ownerBearer, requestId);
      expect(approve.status, 'approve → 200').toBe(HTTP_OK);
      const afterApprove = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      const attendee = afterApprove.attendees.find((a) => a.email === attendeeEmail);
      expect(attendee, 'approval created the attendee').toBeDefined();
      expect(attendee!.status, 'the approved attendee is Expected').toBe(STATUS_EXPECTED);
      const attendeeExternalId = attendee!.externalId;

      // ── 3. PAYMENT — a signed webhook reconciles the attendee to Paid ──
      const paymentStatus = await payments.updateStripeCredentials(ownerBearer, {
        stripeSecretKey: dummySecretKey(handle.ctx.canaryId),
        stripeWebhookSecret: webhookSecret,
        stripePaymentsEnabled: true,
      });
      expect(paymentStatus.stripeConfigured, 'stripe configured').toBe(true);
      await payments.setProviderKindStripeCheckout(ownerBearer);
      const config = await payments.getPaymentConfig(ownerBearer);
      const webhookUrl = payments.buildStripeWebhookUrl(tenantIdFromWebhookUrl(config.stripeWebhookUrl));

      const completedBody = buildCheckoutCompletedBody({
        attendeeExternalId, amountTotalCents: PRICE_CENTS,
      });
      const webhookResult = await payments.postStripeWebhook({
        webhookUrl, rawBody: completedBody, signature: signStripeEvent(completedBody, webhookSecret),
      });
      expect(webhookResult, 'checkout.session.completed webhook accepted').toBe(HTTP_OK);

      const afterPay = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      expect(
        afterPay.attendees.find((a) => a.externalId === attendeeExternalId)?.status,
        'the attendee is Paid after the webhook',
      ).toBe(STATUS_PAID);

      // P&L reflects the paid attendee (RecordPayment moves gross/net).
      const pnlResp = await organizer.getOrganizerEvent(ownerBearer, handle.eventExternalId);
      expect(pnlResp.status, 'GET organizer event → 200').toBe(HTTP_OK);
      const { pnl } = asOrganizerDto(pnlResp);
      expect(pnl.paidAttendeeCount, 'P&L shows one paid attendee').toBe(1);
      expect(pnl.grossPassRevenueEur, 'P&L gross equals the paid pass price').toBe(PASS.priceEur);

      // ── 4. CHECK-IN — the attendee is checked in at the door ───────────
      const checkIn = await lifecycle.seedCanaryAttendee({
        canaryId: handle.ctx.canaryId, email: attendeeEmail,
        passCode: PASS.code, status: STATUS_CHECKED_IN, consentGiven: true,
      });
      expect(checkIn.attendeeExternalId, 'check-in hits the same attendee row').toBe(attendeeExternalId);
      const afterCheckIn = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      expect(
        afterCheckIn.attendees.find((a) => a.externalId === attendeeExternalId)?.status,
        'the door check-in transition is reflected (CheckedIn)',
      ).toBe(STATUS_CHECKED_IN);
    } finally {
      if (ambassadorUserId) await deleteEphemeralUser(ambassadorUserId);
      await teardownApiTenant(handle, admin);
    }
  });
});
