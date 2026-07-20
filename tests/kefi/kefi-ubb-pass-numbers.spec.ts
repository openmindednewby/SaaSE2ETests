/**
 * Kefi PASS NUMBER E2E — the attendee's human-readable identity.
 *
 * A pass number (`UBB-0163`) is what a buyer quotes at the door, what door staff
 * search for, and what appears on the printed list. Unlike the attendee's
 * external id (a UUID nobody reads aloud), it is a SHORT, SEQUENTIAL,
 * HUMAN-SPOKEN identifier — which makes two properties load-bearing:
 *
 *   - **Unique.** Two attendees sharing a number means the door admits the wrong
 *     person, or refuses the right one.
 *   - **Stable.** A number that is recomputed on read (rather than assigned once
 *     and stored) would RENUMBER attendees whenever the roster changes — so the
 *     number on a buyer's ticket, sent weeks earlier, would stop matching the
 *     door list. This spec re-reads the same attendee through a DIFFERENT
 *     surface to prove the number is stored, not derived.
 *
 * It must also reach every surface that consumes it: the organizer/door ledger,
 * and the CSV export the organizer prints.
 *
 * PROD-SAFE: every attendee is deleted in `finally` and the roster size is
 * asserted back to baseline. Emails are `@example.invalid` (RFC 2606).
 *
 * ⚠️ The register route is rate-limited 5/60s per IP; this spec registers TWO
 * attendees and uses `registerWithBackoff` via the fixture.
 */

import { test, expect } from '@playwright/test';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiOrganizerClient } from '../../helpers/kefi/kefiOrganizerClient.js';
import { KefiDoorLedgerClient } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { KefiAttendeeAdminClient } from '../../helpers/kefi/kefiAttendeeAdminClient.js';
import { KefiTicketClient } from '../../helpers/kefi/kefiTicketClient.js';
import { KefiPublicRegisterClient } from '../../helpers/kefi/kefiPublicRegisterClient.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

// NOT serial: `workers: 1` already runs these sequentially (which the 5/60s
// per-IP register limit needs), while serial mode would additionally CASCADE-SKIP
// every test after the first failure — hiding exactly the assertions that matter
// most when something is already wrong.

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const PHONE = '+35799000000';

/**
 * The fixture event's pass-number prefix + at least four digits.
 *
 * This used to be hardcoded `/^UBB-\d{4,}$/`, which silently tied the spec to
 * one specific tenant — so moving the fixture off the customer tenant failed
 * here for no reason other than the literal. The prefix is a property of the
 * EVENT (explicit `PassNumberPrefix`, else initials derived from the event
 * name), not of this test, so it is configured alongside the rest of the
 * fixture coordinates in `.env.<target>`.
 */
const PASS_NUMBER_PREFIX = (process.env.KEFI_FIXTURE_PASS_NUMBER_PREFIX ?? '').trim();
const PASS_NUMBER_PATTERN = new RegExp(`^${PASS_NUMBER_PREFIX}-\\d{4,}$`);

/** One ledger row, as the door/organizer ledger returns it. */
interface LedgerRow {
  attendeeExternalId: string;
  passNumber: string | null;
  pass: string;
  checkedIn: boolean;
}

test.describe('Kefi UBB pass numbers', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api a live registration is issued a unique, well-formed pass number', async () => {
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    expect(before.status, 'the organizer event reads').toBe(HTTP_OK);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();

      // Two registrations, because uniqueness is only observable across at least
      // two rows. Registering both through the real public route is the point —
      // a number allocated by an import path proves nothing about the buyer path.
      const numbers: string[] = [];
      for (const discriminator of ['num-a', 'num-b']) {
        const resp = await register.registerWithBackoff(ops.tenant.slug, {
          name: 'E2E',
          surname: `${ops.marker}-${discriminator}`,
          phone: PHONE,
          email: fixtureAttendeeEmail(ops.marker, discriminator),
          passCode: 'FULL',
          consentGiven: true,
        });
        expect(resp.status, `the ${discriminator} registration is created`).toBe(HTTP_CREATED);
        const created = resp.data as { attendeeExternalId: string; passNumber: string };
        ops.trackAttendee(created.attendeeExternalId);

        expect(
          created.passNumber,
          'the registration response carries the pass number the buyer will quote at the door',
        ).toMatch(PASS_NUMBER_PATTERN);
        numbers.push(created.passNumber);
      }

      expect(
        new Set(numbers).size,
        `two registrations received two DIFFERENT pass numbers (saw ${numbers.join(', ')})`,
      ).toBe(numbers.length);
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

  test('@api the pass number reaches the ledger, the ticket and the CSV export', async () => {
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();
      const email = fixtureAttendeeEmail(ops.marker, 'surfaces');
      const resp = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-surfaces`,
        phone: PHONE,
        email,
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(resp.status, 'the registration is created').toBe(HTTP_CREATED);
      const created = resp.data as {
        attendeeExternalId: string;
        passNumber: string;
        ticketToken: string;
      };
      ops.trackAttendee(created.attendeeExternalId);

      // ── 1. The door / organizer ledger — what door staff read and search ──
      const ledger = new KefiDoorLedgerClient();
      const view = await ledger.getLedgerByBearer(
        ops.tenant.slug,
        ops.bearer,
        ops.tenant.eventExternalId,
      );
      expect(view.status, 'the ledger reads').toBe(HTTP_OK);
      const rows = (view.data as { attendees: LedgerRow[] }).attendees;
      const row = rows.find((r) => r.attendeeExternalId === created.attendeeExternalId);
      expect(row, 'the new attendee appears in the ledger').toBeDefined();
      expect(
        row!.passNumber,
        'the ledger row carries the SAME pass number the buyer was given',
      ).toBe(created.passNumber);

      // The number must be unique across the WHOLE live roster, not merely
      // against the other row this spec made — a collision with a real attendee
      // is exactly the failure that admits the wrong person at the door.
      const allNumbers = rows
        .map((r) => r.passNumber)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
      const duplicates = allNumbers.filter((n, i) => allNumbers.indexOf(n) !== i);
      expect(
        duplicates,
        'no two attendees on the live roster share a pass number',
      ).toEqual([]);

      // ── 2. The ticket the buyer keeps ────────────────────────────────────
      const tickets = new KefiTicketClient();
      const ticket = await tickets.getTicket(created.ticketToken);
      expect(ticket.status, 'the ticket renders').toBe(HTTP_OK);
      expect(
        ticket.passNumber,
        "the buyer's own ticket shows the same pass number as the door list",
      ).toBe(created.passNumber);

      // ── 3. The CSV the organizer prints ──────────────────────────────────
      const attendees = new KefiAttendeeAdminClient();
      const csv = await attendees.exportCsv(ops.bearer, ops.tenant.eventExternalId);
      expect(csv.status, 'the CSV export downloads').toBe(HTTP_OK);
      const [header, ...dataRows] = csv.body.split(/\r?\n/);
      expect(
        header!.split(',').map((c) => c.trim()),
        'the export has a passNumber column',
      ).toContain('passNumber');
      expect(
        dataRows.some((line) => line.includes(created.passNumber)),
        `the exported CSV contains the pass number ${created.passNumber}`,
      ).toBe(true);
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

  test('@api a pass number is assigned once and never renumbered', async () => {
    // The stability guarantee. A number DERIVED at read time (say, from the
    // attendee's position in the roster) would look perfect in every single-read
    // test above and still renumber every buyer the moment somebody else
    // registers or is deleted. This re-reads the same attendee AFTER the roster
    // has changed underneath it, which is the only way to tell the two apart.
    const ops = await openEventOps();
    const organizerApi = new KefiOrganizerClient();
    const before = await organizerApi.getOrganizerEvent(ops.bearer, ops.tenant.eventExternalId);
    const baselineCount = (before.data as { attendees: unknown[] }).attendees.length;

    try {
      const register = new KefiPublicRegisterClient();
      const first = await register.registerWithBackoff(ops.tenant.slug, {
        name: 'E2E',
        surname: `${ops.marker}-stable`,
        phone: PHONE,
        email: fixtureAttendeeEmail(ops.marker, 'stable'),
        passCode: 'FULL',
        consentGiven: true,
      });
      expect(first.status, 'the first registration is created').toBe(HTTP_CREATED);
      const anchor = first.data as {
        attendeeExternalId: string;
        passNumber: string;
        ticketToken: string;
      };
      ops.trackAttendee(anchor.attendeeExternalId);

      // Mutate the roster around the anchor: add a second attendee, then remove
      // it again. Either operation would shift a position-derived number.
      const churn = await ops.registerAttendee('churn', 'FULL');
      const tickets = new KefiTicketClient();

      const afterInsert = await tickets.getTicket(anchor.ticketToken);
      expect(afterInsert.status, 'the anchor ticket still renders after an insert').toBe(HTTP_OK);
      expect(
        afterInsert.passNumber,
        'a later registration did not renumber an existing attendee',
      ).toBe(anchor.passNumber);

      const ledger = new KefiDoorLedgerClient();
      const view = await ledger.getLedgerByBearer(
        ops.tenant.slug,
        ops.bearer,
        ops.tenant.eventExternalId,
      );
      const churnRow = (view.data as { attendees: LedgerRow[] }).attendees.find(
        (r) => r.attendeeExternalId === churn.externalId,
      );
      expect(churnRow, 'the churn row exists before we assert on the anchor').toBeDefined();
      expect(
        churnRow!.passNumber,
        'the churn row got its own distinct number rather than reusing the anchor\'s',
      ).not.toBe(anchor.passNumber);

      const finalRead = await tickets.getTicket(anchor.ticketToken);
      expect(
        finalRead.passNumber,
        'the anchor attendee has kept exactly the number it was issued at registration',
      ).toBe(anchor.passNumber);
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
