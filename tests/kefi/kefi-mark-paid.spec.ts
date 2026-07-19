/**
 * Kefi MARK-PAID E2E — the single most-used organizer action.
 *
 * `PATCH /api/v1/admin/attendees/{externalId}/payment` is what an organizer taps
 * at the door when cash changes hands, and it is the ONLY thing that moves the
 * P&L: the profit maths keys off the attendee's `Paid`/`Expected` booleans, not
 * the status enum, so a broken toggle silently zeroes the organizer's revenue
 * picture while every screen still looks populated.
 *
 * Two tiers:
 *   `@api` — the full round trip in BOTH directions (Expected → Paid → Expected →
 *            Paid), asserting the side effects a UI never shows: un-paying also
 *            ZEROES `paidEur`, and the status enum tracks the booleans. Plus the
 *            validation and authorization walls.
 *   `@ui`  — the organizer dashboard's Paid/Unpaid toggle drives the same round
 *            trip through the real button and badge.
 *
 * PROD-SAFE: operates only on an attendee this spec registered itself, and
 * deletes it in `finally`. It never touches a pre-existing row.
 */

import { test, expect } from '@playwright/test';

import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiOrganizerPage } from '../../pages/kefi/KefiOrganizerPage.js';
import {
  KefiAttendeeAdminClient,
  type OrganizerAttendee,
} from '../../helpers/kefi/kefiAttendeeAdminClient.js';
import { KefiDoorLedgerClient } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const PAID_EUR = 30;
const PAID_ON = '2026-07-19';
const UNKNOWN_ATTENDEE_ID = '00000000-0000-0000-0000-000000000000';
const STATUS_PAID = 'Paid';
const STATUS_EXPECTED = 'Expected';

/** Narrow a mark-payment response after its status has been asserted. */
function asAttendee(resp: { status: number; data: unknown }): OrganizerAttendee {
  return resp.data as OrganizerAttendee;
}

/**
 * Read one attendee's `paid` flag straight from the server via the organizer
 * ledger — a pure READ, so it can be used to verify a UI write without itself
 * performing one.
 */
async function readPaid(
  ops: { tenant: { slug: string; eventExternalId: string }; bearer: string },
  attendeeExternalId: string,
): Promise<boolean | null> {
  const ledger = new KefiDoorLedgerClient();
  const resp = await ledger.getLedgerByBearer(
    ops.tenant.slug,
    ops.bearer,
    ops.tenant.eventExternalId,
  );
  if (resp.status !== HTTP_OK) return null;
  const view = resp.data as { attendees: { attendeeExternalId: string; paid: boolean }[] };
  return view.attendees.find((a) => a.attendeeExternalId === attendeeExternalId)?.paid ?? null;
}

test.describe('Kefi mark-attendee-paid', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api toggles an attendee Paid → Expected → Paid with consistent amounts and status', async () => {
    const ops = await openEventOps();
    const payments = new KefiAttendeeAdminClient();
    try {
      const attendee = await ops.registerAttendee('paid');

      // ── Baseline: a self-registered visitor owes money ──────────────────
      const toPaid = await payments.markPayment(ops.bearer, attendee.externalId, {
        paid: true,
        paidEur: PAID_EUR,
        paymentMethod: 'cash',
        paidOn: PAID_ON,
      });
      expect(toPaid.status, 'marking an attendee paid succeeds').toBe(HTTP_OK);
      const paid = asAttendee(toPaid);
      expect(paid.paid, 'the row is now paid').toBe(true);
      expect(paid.expected, 'a paid row is no longer merely expected').toBe(false);
      expect(paid.paidEur, 'the amount received is recorded').toBe(PAID_EUR);
      // The admin DTO echoes the enum NAME (PascalCase); the ledger payload
      // lower-cases the same value. Asserting case-insensitively documents that
      // the two representations are deliberate, not accidental.
      expect(paid.paymentMethod.toLowerCase(), 'the payment method is recorded').toBe('cash');
      expect(paid.status, 'the status enum follows the booleans').toBe(STATUS_PAID);

      // ── Back to unpaid — the side effect a UI never shows ───────────────
      const toExpected = await payments.markPayment(ops.bearer, attendee.externalId, {
        paid: false,
      });
      expect(toExpected.status, 'marking an attendee unpaid succeeds').toBe(HTTP_OK);
      const expectedRow = asAttendee(toExpected);
      expect(expectedRow.paid, 'the row is no longer paid').toBe(false);
      expect(expectedRow.expected, 'un-paying returns the row to expected').toBe(true);
      expect(
        expectedRow.paidEur,
        'un-paying ZEROES the amount — a stale amount would inflate the P&L',
      ).toBe(0);
      expect(expectedRow.status, 'the status enum follows back').toBe(STATUS_EXPECTED);

      // ── And forward again: the toggle is genuinely reversible ───────────
      const rePaid = await payments.markPayment(ops.bearer, attendee.externalId, {
        paid: true,
        paidEur: PAID_EUR,
        paymentMethod: 'card',
      });
      expect(rePaid.status, 're-marking paid succeeds').toBe(HTTP_OK);
      expect(asAttendee(rePaid).paid, 'the row is paid again').toBe(true);
      expect(asAttendee(rePaid).paidEur, 'the amount is recorded again').toBe(PAID_EUR);
      expect(
        asAttendee(rePaid).paymentMethod.toLowerCase(),
        'the new payment method replaced the old one',
      ).toBe('card');

      // ── Validation walls ────────────────────────────────────────────────
      expect(
        (await payments.markPayment(ops.bearer, attendee.externalId, { paid: true, paidEur: -1 }))
          .status,
        'a negative amount is rejected',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        (
          await payments.markPayment(ops.bearer, attendee.externalId, {
            paid: true,
            paymentMethod: 'bitcoin',
          })
        ).status,
        'an unknown payment method is rejected',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        (
          await payments.markPayment(ops.bearer, attendee.externalId, {
            paid: true,
            paidOn: '19-07-2026',
          })
        ).status,
        'a non-ISO date is rejected',
      ).toBe(HTTP_BAD_REQUEST);

      // ── Authorization walls ─────────────────────────────────────────────
      expect(
        (await payments.markPayment('', attendee.externalId, { paid: true })).status,
        'an unauthenticated caller cannot mark payments',
      ).toBe(HTTP_UNAUTHORIZED);
      expect(
        (await payments.markPayment(ops.bearer, UNKNOWN_ATTENDEE_ID, { paid: true })).status,
        'an attendee outside the caller tenant is not found',
      ).toBe(HTTP_NOT_FOUND);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);
    }
  });

  test('@ui the organizer Paid/Unpaid toggle flips the badge and persists', async ({ page }) => {
    const ops = await openEventOps();

    try {
      const attendee = await ops.registerAttendee('paid-ui');

      const login = new KefiLoginPage(page);
      await login.goto();
      await login.signIn({
        email: ops.tenant.organizerEmail,
        password: ops.tenant.organizerPassword,
      });

      const organizer = new KefiOrganizerPage(page);
      await organizer.gotoEvent(ops.tenant.eventExternalId);
      await organizer.expectRendered();

      // The freshly registered visitor starts unpaid.
      await expect(
        organizer.paidBadge(attendee.externalId),
        'the new attendee shows as unpaid',
      ).toBeVisible({ timeout: 30_000 });

      // ── Mark paid through the real button ──────────────────────────────
      expect(
        await organizer.togglePaidAndAwaitWrite(attendee.externalId),
        'the toggle PATCHes successfully',
      ).toBe(HTTP_OK);

      // The server is the source of truth — assert the write landed there, not
      // just that a local badge re-rendered. This read is deliberately a READ
      // (the ledger), never another PATCH: asserting a write with a write would
      // pass against a completely broken toggle.
      await expect
        .poll(() => readPaid(ops, attendee.externalId), {
          message: 'the UI toggle persisted a paid attendee',
          timeout: 15_000,
        })
        .toBe(true);

      // ── And back again, so the UI toggle is proven reversible ───────────
      expect(
        await organizer.togglePaidAndAwaitWrite(attendee.externalId),
        'the toggle PATCHes back to unpaid',
      ).toBe(HTTP_OK);
      await expect
        .poll(() => readPaid(ops, attendee.externalId), {
          message: 'the UI toggle persisted the attendee back to unpaid',
          timeout: 15_000,
        })
        .toBe(false);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every row this test created was cleaned up').toEqual([]);
    }
  });
});
