/**
 * Kefi LEDGER / P&L E2E — the number the organizer actually cares about.
 *
 * `GET /api/v1/t/{slug}/ledger` returns a server-computed profit-and-loss
 * snapshot. A wrong total here is worse than a crash: a crash gets reported, a
 * quietly-wrong €4,410 gets believed. So the assertions are about INTERNAL
 * CONSISTENCY — the aggregate must equal the sum of its parts — not about a
 * hard-coded figure that would rot the moment the fixture tenant changes.
 *
 * The checks that would catch a real regression:
 *   - gross == sum of the per-pass revenue lines
 *   - gross == sum of `paidEur` over the attendees actually flagged paid
 *   - paid/expected counts match the attendee rows
 *   - net == gross − venue − promoter payouts − fixed − crew
 *   - marking one attendee paid moves gross by EXACTLY their amount
 *
 * Two tiers:
 *   `@api` — the arithmetic above, plus the dual-auth contract (an organizer
 *            bearer reaches the same full-scope payload as a Ledger token).
 *   `@ui`  — the real ledger page renders the headline P&L and the attendee table.
 *
 * PROD-SAFE: the delta test uses only an attendee this spec created, and restores
 * it before deleting it. It never re-prices a pre-existing row.
 */

import { test, expect } from '@playwright/test';

import { KefiLedgerPage } from '../../pages/kefi/KefiLedgerPage.js';
import { KefiAttendeeAdminClient } from '../../helpers/kefi/kefiAttendeeAdminClient.js';
import { KefiDoorLedgerClient, type LedgerView } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
/** Money is decimal on the server; compare in cents to dodge float noise. */
const CENTS = 100;

/** Round a euro amount to whole cents so summed decimals compare exactly. */
function cents(value: number): number {
  return Math.round(value * CENTS);
}

/** Sum a list of euro amounts in cents. */
function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + cents(value), 0);
}

test.describe('Kefi ledger / P&L', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api the computed P&L is internally consistent and moves by exactly one payment', async () => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    const payments = new KefiAttendeeAdminClient();
    try {
      const link = await ops.mintLink({ recipientName: `${ops.marker} ledger`, scope: 'Ledger' });

      const resp = await ledger.getLedgerByToken(ops.tenant.slug, link.token);
      expect(resp.status, 'a Ledger token opens the ledger').toBe(HTTP_OK);
      const view = resp.data as LedgerView;
      const pnl = view.pnl;
      expect(pnl, 'Ledger scope carries the computed P&L').not.toBeNull();

      expect(view.event.externalId, 'the ledger is for the fixture event').toBe(
        ops.tenant.eventExternalId,
      );

      // ── gross == the sum of its own per-pass lines ──────────────────────
      expect(
        sumCents(pnl!.passLines.map((line) => line.grossRevenueEur)),
        'gross pass revenue equals the sum of the per-pass lines',
      ).toBe(cents(pnl!.grossPassRevenueEur));

      // ── gross == the sum of what paid attendees actually paid ───────────
      const paidRows = view.attendees.filter((a) => a.paid);
      expect(
        sumCents(paidRows.map((a) => a.paidEur)),
        'gross pass revenue equals the money recorded against paid attendees',
      ).toBe(cents(pnl!.grossPassRevenueEur));

      // ── the counts match the rows ───────────────────────────────────────
      expect(pnl!.paidAttendeeCount, 'the paid count matches the paid rows').toBe(paidRows.length);
      expect(
        pnl!.expectedAttendeeCount,
        'the expected count matches the rows still owing money',
      ).toBe(view.attendees.filter((a) => a.expected).length);
      expect(
        pnl!.passLines.reduce((total, line) => total + line.paidCount, 0),
        'the per-pass paid counts add up to the total paid count',
      ).toBe(pnl!.paidAttendeeCount);

      // ── net is gross minus every cost the payload declares ──────────────
      const expectedNet =
        cents(pnl!.grossPassRevenueEur) -
        cents(pnl!.venueShareEur) -
        cents(pnl!.promoterPayoutTotalEur) -
        cents(pnl!.fixedCostTotalEur) -
        cents(pnl!.crewCostTotalEur);
      expect(
        cents(pnl!.netProfitEur),
        'net profit is gross less venue share, promoter payouts, fixed costs and crew costs',
      ).toBe(expectedNet);

      // ── One payment moves gross by exactly that payment ─────────────────
      const attendee = await ops.registerAttendee('pnl');
      const amount = 20;
      const before = (
        (await ledger.getLedgerByToken(ops.tenant.slug, link.token)).data as LedgerView
      ).pnl!;

      await payments.markPayment(ops.bearer, attendee.externalId, {
        paid: true,
        paidEur: amount,
        paymentMethod: 'cash',
      });

      const after = (
        (await ledger.getLedgerByToken(ops.tenant.slug, link.token)).data as LedgerView
      ).pnl!;
      expect(
        cents(after.grossPassRevenueEur) - cents(before.grossPassRevenueEur),
        'recording one €20 payment raises gross by exactly €20',
      ).toBe(cents(amount));
      expect(
        after.paidAttendeeCount - before.paidAttendeeCount,
        'and by exactly one paid attendee',
      ).toBe(1);

      // ── Dual auth: an organizer bearer reaches the same full scope ──────
      const byBearer = await ledger.getLedgerByBearer(
        ops.tenant.slug,
        ops.bearer,
        ops.tenant.eventExternalId,
      );
      expect(byBearer.status, 'a logged-in organizer can read the ledger').toBe(HTTP_OK);
      const bearerView = byBearer.data as LedgerView;
      expect(bearerView.scope, 'an organizer login is full Ledger scope').toBe('Ledger');
      expect(
        cents(bearerView.pnl!.grossPassRevenueEur),
        'the organizer path and the token path agree on the numbers',
      ).toBe(cents(after.grossPassRevenueEur));

      // ── ...and a caller with neither credential gets nothing ────────────
      expect(
        (await ledger.getLedgerByBearer(ops.tenant.slug, '')).status,
        'an anonymous caller with no token cannot read the ledger',
      ).toBe(HTTP_FORBIDDEN);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });

  test('@ui the ledger page renders the headline P&L and the attendee table', async ({ page }) => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    try {
      const attendee = await ops.registerAttendee('pnl-ui');
      const link = await ops.mintLink({
        recipientName: `${ops.marker} ledger-ui`,
        scope: 'Ledger',
      });

      const view = (
        (await ledger.getLedgerByToken(ops.tenant.slug, link.token)).data as LedgerView
      );

      const ledgerPage = new KefiLedgerPage(page);
      await ledgerPage.gotoWithToken(ops.tenant.siteUrl, link.token);

      // The headline P&L block renders the lines an organizer looks for.
      await expect(
        ledgerPage.pnlRow('Gross ticket revenue'),
        'the ledger shows gross ticket revenue',
      ).toBeVisible();
      await expect(ledgerPage.pnlRow('Promoter payouts'), 'and promoter payouts').toBeVisible();
      await expect(ledgerPage.pnlRow('Net profit'), 'and the net profit line').toBeVisible();

      // The rendered gross must be the SERVER's gross, not a client recomputation
      // — the page only falls back to computing its own when `pnl` is null.
      const renderedGross = (await ledgerPage.pnlAmount('Gross ticket revenue').textContent()) ?? '';
      expect(
        renderedGross.replace(/[^\d]/g, ''),
        'the rendered gross matches the P&L the API computed',
      ).toContain(String(Math.trunc(view.pnl!.grossPassRevenueEur)));

      // The stat tiles and the attendee table are populated.
      await expect(ledgerPage.statTile('Net profit'), 'the net-profit stat tile renders').toBeVisible();
      await expect(ledgerPage.statTile('Attendees'), 'the attendee stat tile renders').toBeVisible();
      await ledgerPage.search.fill(attendee.surname);
      await expect(
        ledgerPage.attendeeRowByText(attendee.surname),
        'the attendee we registered appears in the ledger table',
      ).toBeVisible();
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });
});
