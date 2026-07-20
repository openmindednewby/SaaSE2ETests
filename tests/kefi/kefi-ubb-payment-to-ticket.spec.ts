/**
 * Kefi BACK-OFFICE → PUBLIC TICKET E2E — the assertion that proves the loop closes.
 *
 * Every other spec in this suite verifies ONE surface against ITSELF: the
 * organizer's mark-paid call echoes `paid: true` (`kefi-mark-paid`), the door
 * check-in persists on the ledger (`kefi-door-checkin`), the ticket renders its
 * own projection (`kefi-ubb-ticket-surface`). Each can be green while the buyer's
 * ticket still says "unpaid" forever, because none of them ever CROSSES the
 * boundary — the organizer writes through an authed admin route and the attendee
 * reads through an anonymous HMAC-token route, and nothing asserts those two are
 * the same row.
 *
 * That crossing is the whole product. An organizer takes €35 in cash at the desk,
 * ticks "paid", and the attendee refreshes the link in their email. If the ticket
 * does not flip, the organizer is fielding "is my ticket real?" messages all
 * night with no way to prove it is.
 *
 * So each test here WRITES as the organizer (bearer, authed) and READS as the
 * attendee (token only, anonymous, no credentials the organizer ever saw):
 *
 *   1. confirm payment  → the public ticket flips Expected → Paid
 *   2. reverse it       → the ticket flips back (a mis-click is recoverable, and
 *                         a refunded buyer must stop reading as paid)
 *   3. check in at door → the public ticket reflects attendance, and SURVIVES a
 *                         re-read (extends `kefi-door-checkin`, which only ever
 *                         re-read the LEDGER side of the same write)
 *
 * PROD-SAFE: UBB carries real pre-sale rows. Every attendee here is registered by
 * this spec through the real public route, deleted in `finally`, and the roster
 * size is asserted back to its exact baseline. Nothing pre-existing is written to.
 */

import { test, expect } from '@playwright/test';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiOrganizerClient } from '../../helpers/kefi/kefiOrganizerClient.js';
import { KefiPublicRegisterClient } from '../../helpers/kefi/kefiPublicRegisterClient.js';
import { KefiAttendeeAdminClient } from '../../helpers/kefi/kefiAttendeeAdminClient.js';
import { KefiTicketClient } from '../../helpers/kefi/kefiTicketClient.js';
import { KefiDoorLedgerClient } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

// NOT serial: `workers: 1` already serializes these (which the 5/60s per-IP
// register limit needs), while serial mode would additionally CASCADE-SKIP every
// test after the first failure — hiding exactly the assertions that matter most
// when the money surface is already broken.

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const PHONE = '+35799000000';

const STATUS_EXPECTED = 'Expected';
const STATUS_PAID = 'Paid';

/** The amount the organizer records at the desk. Matches the FULL pass price. */
const DESK_PAYMENT_EUR = 35;

/** One registration, with the fields both surfaces are keyed on. */
interface RegisteredBuyer {
  attendeeExternalId: string;
  passNumber: string;
  ticketToken: string;
}

/** Register one attendee through the real public route and track it for deletion. */
async function registerBuyer(
  ops: Awaited<ReturnType<typeof openEventOps>>,
  discriminator: string,
): Promise<RegisteredBuyer> {
  const register = new KefiPublicRegisterClient();
  const resp = await register.registerWithBackoff(ops.tenant.slug, {
    name: 'E2E',
    surname: `${ops.marker}-${discriminator}`,
    phone: PHONE,
    email: fixtureAttendeeEmail(ops.marker, discriminator),
    passCode: 'FULL',
    consentGiven: true,
  });
  expect(resp.status, `the ${discriminator} registration is created`).toBe(HTTP_CREATED);

  const created = resp.data as RegisteredBuyer;
  ops.trackAttendee(created.attendeeExternalId);
  return created;
}

test.describe('Kefi UBB back-office payment → public ticket', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api an organizer confirming payment flips the attendee PUBLIC ticket to paid', async () => {
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const buyer = await registerBuyer(ops, 'paidflip');
      const tickets = new KefiTicketClient();

      // ── The buyer's view BEFORE the desk takes their money ────────────────
      // Asserted first so the flip below is provably a state CHANGE and not a
      // ticket that happened to read "paid" from the moment it was created.
      const beforeTicket = await tickets.getTicket(buyer.ticketToken);
      expect(beforeTicket.status, 'the ticket renders for the token holder').toBe(HTTP_OK);
      expect(
        beforeTicket.paid,
        'before the desk records anything the buyer\'s ticket reads as unpaid',
      ).toBe(false);
      expect(
        beforeTicket.statusLabel,
        'and its status label says Expected, not admitted',
      ).toBe(STATUS_EXPECTED);

      // ── The organizer confirms payment (authed admin route) ───────────────
      const admin = new KefiAttendeeAdminClient();
      const marked = await admin.markPayment(ops.bearer, buyer.attendeeExternalId, {
        paid: true,
        paidEur: DESK_PAYMENT_EUR,
        paymentMethod: 'cash',
      });
      expect(marked.status, 'the organizer records the payment').toBe(HTTP_OK);
      expect(
        (marked.data as { paid: boolean }).paid,
        'the admin route confirms the row is now paid',
      ).toBe(true);

      // ── The buyer's view AFTER — read anonymously, token only ─────────────
      // ⭐ THE CROSSING. No bearer, no cookie, nothing the organizer holds: this
      // is exactly the request the attendee's phone makes when they refresh the
      // link in their email.
      const afterTicket = await tickets.getTicket(buyer.ticketToken);
      expect(afterTicket.status, 'the ticket still renders after the payment').toBe(HTTP_OK);
      expect(
        afterTicket.paid,
        'the organizer confirmed payment but the attendee\'s own ticket still reads UNPAID — ' +
          'the back office and the buyer disagree about whether this ticket is real',
      ).toBe(true);
      expect(
        afterTicket.statusLabel,
        'and the status label the buyer reads has moved off Expected',
      ).toBe(STATUS_PAID);

      // The identity fields must survive the payment write — a flip that also
      // renumbered the pass would break the door queue.
      expect(
        afterTicket.attendeeExternalId,
        'the ticket still belongs to the same attendee',
      ).toBe(buyer.attendeeExternalId);
      expect(
        afterTicket.passNumber,
        'and still carries the same pass number the buyer quotes at the door',
      ).toBe(buyer.passNumber);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);

      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });

  test('@api reversing a payment flips the PUBLIC ticket back to unpaid', async () => {
    // The forward direction alone would let a write-once bug through: a ticket
    // that latches to "paid" and never returns looks correct in every happy-path
    // test, but means a mis-click at the desk cannot be undone and a refunded
    // buyer keeps a ticket that still reads as valid.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const buyer = await registerBuyer(ops, 'unpaidflip');
      const tickets = new KefiTicketClient();
      const admin = new KefiAttendeeAdminClient();

      const paid = await admin.markPayment(ops.bearer, buyer.attendeeExternalId, {
        paid: true,
        paidEur: DESK_PAYMENT_EUR,
        paymentMethod: 'cash',
      });
      expect(paid.status, 'the payment is recorded').toBe(HTTP_OK);
      expect(
        (await tickets.getTicket(buyer.ticketToken)).paid,
        'the ticket reads paid before we reverse it',
      ).toBe(true);

      const reversed = await admin.markPayment(ops.bearer, buyer.attendeeExternalId, {
        paid: false,
      });
      expect(reversed.status, 'the organizer reverses the payment').toBe(HTTP_OK);

      const reversedTicket = await tickets.getTicket(buyer.ticketToken);
      expect(
        reversedTicket.paid,
        'the payment was reversed but the buyer\'s ticket still reads PAID — a refunded or ' +
          'mis-clicked attendee keeps a ticket that claims to be valid',
      ).toBe(false);
      expect(
        reversedTicket.statusLabel,
        'and the status label returns to Expected',
      ).toBe(STATUS_EXPECTED);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);

      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });

  test('@api marking attendance at the door survives a re-read on the buyer\'s own ticket', async () => {
    // `kefi-door-checkin` already proves the check-in persists — but it re-reads
    // the LEDGER, the same surface that performed the write. This re-reads the
    // ATTENDEE'S ticket instead, which is the only place a door-side write and a
    // buyer-side read can be shown to describe the same person.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const buyer = await registerBuyer(ops, 'doorflip');
      const tickets = new KefiTicketClient();
      const ledger = new KefiDoorLedgerClient();

      const doorLink = await ops.mintLink({
        recipientName: `${ops.marker}-door`,
        scope: 'Door',
      });

      const checkedIn = await ledger.checkIn({
        slug: ops.tenant.slug,
        token: doorLink.token,
        attendeeExternalId: buyer.attendeeExternalId,
        checkedIn: true,
      });
      expect(checkedIn.status, 'the door marks the attendee present').toBe(HTTP_OK);
      expect(
        (checkedIn.data as { checkedIn: boolean }).checkedIn,
        'the door response confirms the attendee is checked in',
      ).toBe(true);

      // Re-read from the ledger (the door's own surface) AND from the buyer's
      // ticket. Both must agree, and the ticket read is anonymous.
      const ledgerRow = await ledger.readAttendeeRow(
        ops.tenant.slug,
        doorLink.token,
        buyer.attendeeExternalId,
      );
      expect(
        ledgerRow?.checkedIn,
        'the attendance persisted on the ledger the door reads',
      ).toBe(true);

      const ticket = await tickets.getTicket(buyer.ticketToken);
      expect(ticket.status, 'the ticket still renders after the check-in').toBe(HTTP_OK);
      expect(
        ticket.attendeeExternalId,
        'the checked-in row and the ticket describe the same attendee',
      ).toBe(buyer.attendeeExternalId);
      expect(
        ticket.passNumber,
        'the pass number the door scanned is the one the ticket still shows',
      ).toBe(buyer.passNumber);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);

      const after = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
      expect(
        (after.data as { attendees: unknown[] }).attendees.length,
        'the attendee roster is back to exactly its starting size — no real row touched',
      ).toBe(baselineCount);
    }
  });
});
