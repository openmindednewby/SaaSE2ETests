/**
 * Kefi email-DELIVERY E2E — the "how do we know emails are actually delivered?" proof.
 *
 * Registers a real attendee on the PERSISTENT E2E fixture event through the public
 * route, then polls the dedicated `automationTests@dloizides.com` mailbox over IMAP
 * to confirm the branded registration-confirmation email actually LANDS in an inbox
 * (the full path: kefi-api → tenant-api → Maddy SMTP → recipient), not merely
 * "handed to SMTP".
 *
 * Why the fixture event (not a canary signup): the tenant-signup VERIFICATION email
 * rides the slow, highly-variable Keycloak path (2–4+ min observed; #264) and would
 * make this flaky for a reason unrelated to what it proves. The fixture tenant is
 * already verified, so we skip straight to the thing under test — Kefi's TRANSACTIONAL
 * confirmation, dispatched async (best-effort) and observed at ~1-2 min on prod, so the
 * window is generous enough to be reliable without masking a true stall.
 *
 * Isolation + hygiene: the fixture tenant is a dedicated test event (never a real
 * customer's), and the test attendee is deleted in `finally`. Runs on staging + prod
 * (real Maddy) via E2E_TARGET; local is skipped. Requires E2E_AUTOMATION_MAILBOX_*.
 */

import { test, expect } from '@playwright/test';
import * as crypto from 'node:crypto';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiPublicRegisterClient } from '../../helpers/kefi/kefiPublicRegisterClient.js';
import { KefiAttendeeDeleteClient } from '../../helpers/kefi/kefiAttendeeDeleteClient.js';
import {
  KefiMailbox,
  loadAutomationMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

const CONFIRM_TIMEOUT_MS = 300_000;
const HTTP_CREATED = 201;
const RUN_ID_BYTES = 4;

/** A fresh plus-address on automationTests@ so parallel runs never see each other's mail. */
function automationAddress(): { runId: string; plus: string } {
  const user = process.env.E2E_AUTOMATION_MAILBOX_USER;
  if (!user || !user.includes('@')) {
    throw new Error('[email-delivery] E2E_AUTOMATION_MAILBOX_USER is unset/malformed.');
  }
  const [localPart, domain] = user.split('@');
  const runId = crypto.randomBytes(RUN_ID_BYTES).toString('hex');
  return { runId, plus: `${localPart}+eld${runId}@${domain}` };
}

function mailbox(): KefiMailbox {
  return new KefiMailbox(loadAutomationMailboxConfig(), {
    timeoutMs: CONFIRM_TIMEOUT_MS,
    pollIntervalMs: 3_000,
  });
}

test.describe('Kefi email delivery — a real confirmation email lands in the inbox', () => {
  test.skip(
    !isRemoteTarget(),
    'Email-delivery E2E targets staging+prod (real Maddy inbox); local stack not wired.',
  );

  test('registration confirmation is delivered to automationTests@ and is the branded ticket email', async () => {
    const ops = await openEventOps();
    const { runId, plus: attendeeEmail } = automationAddress();
    const register = new KefiPublicRegisterClient();
    const deletes = new KefiAttendeeDeleteClient();
    let attendeeExternalId: string | null = null;

    try {
      // ── Register a real attendee on the fixture event (real public route) ──
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'Delivery',
        surname: `Check-${runId}`,
        phone: '+35799000000',
        email: attendeeEmail,
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, `public register on ${ops.tenant.slug}`).toBe(HTTP_CREATED);
      const data = resp.data as { attendeeExternalId: string; paymentReference: string };
      attendeeExternalId = data.attendeeExternalId;

      // ── The branded confirmation must actually DELIVER (Kefi transactional path) ──
      const confirmation = await mailbox().waitForMessageTo(attendeeEmail, {
        subjectIncludes: "You're registered for",
      });

      // ── Assert it is the real branded ticket email, not an empty stub ──
      expect(confirmation.subject, 'confirmation subject').toContain("You're registered for");
      // The captured body is the RAW MIME source (quoted-printable): undo the QP
      // soft line breaks (`=\r?\n`) so a value wrapped across the 76-char boundary
      // — e.g. the payment reference — reads as one contiguous string.
      const body = `${confirmation.bodyHtml ?? ''}\n${confirmation.bodyText}`.replace(/=\r?\n/g, '');
      expect(body, 'greets the attendee by name').toMatch(/Hi Delivery/i);
      expect(body, 'names the pass the attendee registered for').toMatch(/Pass:/i);
      expect(body, 'links to the ticket').toMatch(/View your ticket|\/ticket\//i);
      // #303 (steps-in-email) is now deployed: the confirmation email's "how to pay"
      // section quotes the exact payment reference the register response minted
      // (FULL-NAME-SURNAME-<pass#>). This is the reference↔email regression guard.
      expect(data.paymentReference, 'register mints a payment reference').toMatch(/-\d{4}$/);
      expect(body, 'quotes the payment reference').toContain(data.paymentReference);

      await mailbox().expungeMessages([confirmation.uid]).catch(() => undefined);
    } finally {
      if (attendeeExternalId) {
        await deletes
          .deleteAttendee({
            bearer: ops.bearer,
            eventExternalId: ops.tenant.eventExternalId,
            attendeeExternalId,
          })
          .catch(() => undefined);
      }
      await ops.cleanup().catch(() => undefined);
    }
  });
});
