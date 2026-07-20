/**
 * Kefi ATTENDEE CSV EXPORT E2E.
 *
 * `GET /api/v1/admin/attendees/export` is the organizer's escape hatch — the file
 * they open in Excel at the door, and the file the bulk-import path is designed
 * to re-consume unchanged. Two things therefore have to hold exactly, not
 * approximately: the header row (column order IS the import contract) and RFC
 * 4180 escaping (the free-text `note` column routinely carries commas, quotes and
 * newlines, and one un-escaped quote shifts every later column of that row).
 *
 * Pure `@api` — this is a file-format contract, and there is nothing a browser
 * assertion could add. The escaping is verified by parsing the response with an
 * INDEPENDENT RFC-4180 reader (`kefiCsvParse.ts`) rather than by splitting on
 * commas: a naive split would happily "pass" against a broken writer.
 *
 * PROD-SAFE: imports one attendee carrying deliberately hostile text, asserts it
 * round-trips, then deletes it. Row counts are asserted RELATIVELY (before vs
 * after) so the spec never depends on the fixture tenant's absolute size and
 * never has to touch a pre-existing row.
 */

import { test, expect } from '@playwright/test';

import { KefiAttendeeAdminClient } from '../../helpers/kefi/kefiAttendeeAdminClient.js';
import { KefiDoorLedgerClient } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { parseCsv, fieldByName, findRowByField } from '../../helpers/kefi/kefiCsvParse.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const UNKNOWN_EVENT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The ledger schema's column order — the header row IS the import contract.
 * Mirrors `AttendeeLedgerCsvWriter.Header` in Kefi.UseCases; keep the two in
 * lockstep. `passNumber` is appended LAST on purpose (the bulk-import parser
 * matches by header name and tolerates unknown columns, so an exported file
 * still round-trips) — this spec previously omitted it and failed against the
 * shipped export regardless of which tenant it ran on.
 */
const EXPECTED_HEADER = [
  'name', 'surname', 'email', 'phone', 'level', 'role', 'gender', 'pass',
  'paidEur', 'paymentMethod', 'paidOn', 'paid', 'expected', 'referredBy', 'note',
  'passNumber',
];

/**
 * A note designed to break a naive CSV writer: a comma (field split), a double
 * quote (needs doubling), and a newline (record split). If any one of the three
 * is mishandled the parsed row will have the wrong field count or the wrong text.
 */
const HOSTILE_NOTE = 'Paid €20, said "pay rest at door"\nsecond line';

test.describe('Kefi attendee CSV export', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api exports a ledger-shaped CSV with the exact header, a row per attendee and RFC-4180 escaping', async () => {
    const ops = await openEventOps();
    const exports = new KefiAttendeeAdminClient();
    const ledger = new KefiDoorLedgerClient();
    try {
      // ── Baseline: how many rows does the export have before we add one? ──
      const before = await exports.exportCsv(ops.bearer, ops.tenant.eventExternalId);
      expect(before.status, 'the export downloads').toBe(HTTP_OK);
      const rowsBefore = parseCsv(before.body).rows.length;

      // ── Header + transport contract ─────────────────────────────────────
      expect(before.contentType, 'the export is served as CSV').toContain('text/csv');
      expect(
        before.contentDisposition,
        'the export downloads as a named attachment',
      ).toMatch(/attachment;\s*filename=.*\.csv/i);
      expect(
        before.hadBom,
        'the export carries a UTF-8 BOM so Excel renders Greek/accented names correctly',
      ).toBe(true);
      expect(
        before.body.split('\r\n')[0],
        'the export uses CRLF line endings per RFC 4180',
      ).toBe(EXPECTED_HEADER.join(','));
      expect(parseCsv(before.body).header, 'the header columns and their order').toEqual(
        EXPECTED_HEADER,
      );

      // ── Add one attendee with hostile free text ─────────────────────────
      const email = fixtureAttendeeEmail(ops.marker, 'csv');
      const surname = `${ops.marker}-csv`;
      await ops.importAttendee({
        name: 'E2E',
        surname,
        email,
        phone: '+35799000000',
        passCode: 'FULL',
        paidEur: 20,
        paymentMethod: 'cash',
        paidOn: '2026-07-19',
        note: HOSTILE_NOTE,
      });

      // ── The export grows by exactly one and matches the ledger ──────────
      const after = await exports.exportCsv(ops.bearer, ops.tenant.eventExternalId);
      expect(after.status, 'the export downloads after the import').toBe(HTTP_OK);
      const parsed = parseCsv(after.body);
      expect(
        parsed.rows.length,
        'the export gained exactly one row for the one attendee added',
      ).toBe(rowsBefore + 1);

      const ledgerView = await ledger.getLedgerByBearer(
        ops.tenant.slug,
        ops.bearer,
        ops.tenant.eventExternalId,
      );
      expect(
        parsed.rows.length,
        'the export row count matches the attendee count the API reports',
      ).toBe((ledgerView.data as { attendees: unknown[] }).attendees.length);

      // Every record must have exactly as many fields as the header — the
      // single strongest signal that escaping is correct across the whole file.
      const ragged = parsed.rows.filter((row) => row.length !== EXPECTED_HEADER.length);
      expect(ragged, 'every exported record has exactly one field per header column').toEqual([]);

      // ── Our hostile row round-trips verbatim ────────────────────────────
      const row = findRowByField(parsed, 'email', email);
      expect(row, 'the imported attendee appears in the export').not.toBeNull();
      expect(fieldByName(parsed, row!, 'surname'), 'the surname round-trips').toBe(surname);
      expect(fieldByName(parsed, row!, 'pass'), 'the pass code round-trips').toBe('FULL');
      expect(
        fieldByName(parsed, row!, 'paidEur'),
        'money is written with two decimal places, invariant culture',
      ).toBe('20.00');
      expect(fieldByName(parsed, row!, 'paid'), 'booleans are lower-case tokens').toBe('true');
      expect(fieldByName(parsed, row!, 'expected'), 'a paid row is not expected').toBe('false');
      expect(fieldByName(parsed, row!, 'paymentMethod'), 'the method is lower-cased').toBe('cash');
      expect(fieldByName(parsed, row!, 'paidOn'), 'the ISO date round-trips').toBe('2026-07-19');
      expect(
        fieldByName(parsed, row!, 'note'),
        'a note containing a comma, a quote AND a newline survives intact',
      ).toBe(HOSTILE_NOTE);

      // And the raw bytes really did quote it (rather than dropping the note).
      expect(
        after.body,
        'the hostile note is quoted with its inner quotes doubled, per RFC 4180',
      ).toContain('""pay rest at door""');

      // ── Walls ───────────────────────────────────────────────────────────
      expect(
        (await exports.exportCsv('', ops.tenant.eventExternalId)).status,
        'an unauthenticated caller cannot export attendee PII',
      ).toBe(HTTP_UNAUTHORIZED);
      expect(
        (await exports.exportCsv(ops.bearer, UNKNOWN_EVENT_ID)).status,
        'an event outside the caller tenant is not found',
      ).toBe(HTTP_NOT_FOUND);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);
    }
  });
});
