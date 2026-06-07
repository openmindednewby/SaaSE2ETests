/**
 * Kefi Phase 13 lifecycle-email E2E (#185).
 *
 * Proves the three attendee-facing email flows end-to-end through the real
 * surfaces (the #184 feature is live + unit-covered; this is the IMAP proof):
 *
 *   1. Registration confirmation + consent — a public register (consentGiven)
 *      lands a branded "You're registered for …" email at the attendee; a
 *      register WITHOUT consent is rejected 400.
 *   2. Reminder + dedup — seed the event into the T-7d window, force the
 *      reminder sweep → reminder lands + ReminderD7SentAt stamps; a second
 *      sweep does NOT re-stamp (dedup).
 *   3. Unsubscribe + opt-out — the reminder's one-click List-Unsubscribe URL
 *      flips UnsubscribedAt; a later D1-window sweep then skips the attendee
 *      (ReminderD1SentAt stays null) — opt-out honored.
 *   4. Thank-you — seed a just-passed event + a Paid attendee, force the
 *      thank-you sweep → thank-you lands + ThankYouSentAt stamps.
 *
 * Seeding rides the #185 platform-admin, canary-scoped endpoints (the default
 * canary tenant is 90d out with no pass, outside every window). Runs on
 * staging + prod via E2E_TARGET; local is skipped.
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
import { forceOnboardingPlan } from '../../helpers/kefi/kefiOnboardingApi.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  extractUnsubscribeUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 30 } as const;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_OK = 200;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mailbox(): KefiMailbox {
  return new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 90_000, pollIntervalMs: 2_000 });
}

test.describe('Kefi Phase 13 lifecycle emails — confirmation, reminder, unsubscribe, thank-you', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi lifecycle-email E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('confirms, reminds (+dedup), honors unsubscribe, thanks attendees', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    // Distinct plus-addresses (all deliver to the one bot mailbox) so the
    // attendee-facing mail never collides with the organizer summaries, which
    // go to the tenant-owner address (ctx.email) with a near-identical subject.
    const attendeeEmail = ctx.email.replace('@', '-att@');
    const paidEmail = ctx.email.replace('@', '-paid@');
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

      // ── 2. Seed the event into the T-7d window + a pass ──────────────
      const seeded = await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId,
        eventDateOffsetDays: 5,
        status: 'Published',
        passCode: PASS.code,
        passLabel: PASS.label,
        priceEur: PASS.priceEur,
      });
      expect(seeded.found, 'canary tenant found for seeding').toBe(true);
      const slug = seeded.slug;

      // ── 3. Flow #1: register WITH consent → confirmation email ───────
      const regStatus = await lifecycle.registerAttendee({
        slug, name: 'Canary', surname: 'Attendee', phone: '+35799000000',
        email: attendeeEmail, passCode: PASS.code, consentGiven: true,
      });
      expect(regStatus, 'register with consent').toBe(HTTP_CREATED);

      const confirmation = await mailbox().waitForMessageTo(attendeeEmail, {
        subjectIncludes: "You're registered for",
      });
      const eventName = confirmation.subject.replace("You're registered for", '').trim();
      expect(eventName.length, 'event name from confirmation subject').toBeGreaterThan(0);

      // register WITHOUT consent → 400 (validator rejects).
      const noConsentStatus = await lifecycle.registerAttendee({
        slug, name: 'No', surname: 'Consent', phone: '+35799000001',
        email: attendeeEmail, passCode: PASS.code, consentGiven: false,
      });
      expect(noConsentStatus, 'register without consent').toBe(HTTP_BAD_REQUEST);

      // ── 4. Flow #2a: reminder sweep → reminder email + dedup stamp ───
      // Filter by the attendee address: the organizer summary has a near-
      // identical subject but goes to the owner (ctx.email), not here.
      await lifecycle.triggerEventReminderSweep();
      const reminder = await mailbox().waitForMessageTo(attendeeEmail, {
        subjectIncludes: `${eventName} is`,
        preferNewest: true,
      });
      const unsubscribeUrl = extractUnsubscribeUrl(reminder);
      expect(unsubscribeUrl, 'unsubscribe URL in reminder').not.toBeNull();

      const afterReminder = findAttendee(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeEmail);
      expect(afterReminder.reminderD7SentAtUtc, 'ReminderD7SentAt stamped').not.toBeNull();
      const firstStamp = afterReminder.reminderD7SentAtUtc;

      // second sweep must NOT re-stamp (dedup) — the column is the resend guard.
      await lifecycle.triggerEventReminderSweep();
      const afterSecond = findAttendee(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeEmail);
      expect(afterSecond.reminderD7SentAtUtc, 'ReminderD7SentAt unchanged on re-sweep').toBe(firstStamp);

      // ── 5. Flow #2b: one-click unsubscribe → opt-out honored ────────
      const unsubStatus = await lifecycle.unsubscribe(unsubscribeUrl!);
      expect(unsubStatus, 'unsubscribe POST').toBe(HTTP_OK);
      const afterUnsub = findAttendee(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeEmail);
      expect(afterUnsub.unsubscribedAtUtc, 'UnsubscribedAt stamped').not.toBeNull();

      // Move to the D1 window; the unsubscribed attendee must be skipped.
      await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId, eventDateOffsetDays: 1, status: 'Published',
        passCode: PASS.code, passLabel: PASS.label, priceEur: PASS.priceEur,
      });
      await lifecycle.triggerEventReminderSweep();
      const afterD1 = findAttendee(await lifecycle.getCanaryAttendees(ctx.canaryId), attendeeEmail);
      expect(afterD1.reminderD1SentAtUtc, 'D1 reminder skipped for unsubscribed attendee').toBeNull();

      // ── 6. Flow #3: thank-you to a Paid attendee on a just-passed event ──
      await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId, eventDateOffsetDays: -1, status: 'Completed',
        passCode: PASS.code, passLabel: PASS.label, priceEur: PASS.priceEur,
      });
      const paid = await lifecycle.seedCanaryAttendee({
        canaryId: ctx.canaryId, email: paidEmail, passCode: PASS.code,
        status: 'Paid', consentGiven: true,
      });
      expect(paid.found, 'paid attendee seeded').toBe(true);

      await lifecycle.triggerThankYouSweep();
      const thankYou = await mailbox().waitForMessageTo(paidEmail, {
        subjectIncludes: `Thanks for coming to ${eventName}`,
      });
      expect(thankYou.to, 'thank-you To').toContain(paidEmail);

      const finalState = await lifecycle.getCanaryAttendees(ctx.canaryId);
      expect(findAttendee(finalState, paidEmail).thankYouSentAtUtc, 'ThankYouSentAt stamped').not.toBeNull();
      expect(findAttendee(finalState, attendeeEmail).thankYouSentAtUtc, 'unsubscribed attendee not thanked').toBeNull();

      // ── 7. Mailbox hygiene ──────────────────────────────────────────
      await mailbox()
        .expungeMessages([verifyCaptured.uid, confirmation.uid, reminder.uid, thankYou.uid])
        .catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

/** Find one attendee in the canary snapshot by email, asserting it exists. */
function findAttendee(snapshot: CanaryAttendeesResult, email: string): CanaryAttendeeState {
  const match = snapshot.attendees.find(a => a.email === email);
  expect(match, `attendee ${email} present in canary snapshot`).toBeDefined();
  return match!;
}
