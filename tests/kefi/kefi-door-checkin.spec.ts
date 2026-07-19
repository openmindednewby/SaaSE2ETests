/**
 * Kefi DOOR CHECK-IN E2E.
 *
 * `POST /api/v1/t/{slug}/checkin?token=…` is the highest-stakes write in the
 * product: it runs on a volunteer's phone, on venue wifi, against a queue of
 * people at the door. Two failure modes matter and both look fine on screen:
 *
 *  1. **A check-in that doesn't stick.** The checkbox ticks, the request fails
 *     or the write is lost, and the same person is admitted twice. So this spec
 *     never trusts the response alone — it RE-READS the row from the server and
 *     asserts persistence.
 *  2. **A promoter checking people in.** Promoter links exist so an ambassador
 *     can see their own referrals; they must not confer door authority. The
 *     capability ladder is Promoter < Door < Ledger, so a Promoter token is 403
 *     while a Ledger token may check in.
 *
 * Two tiers:
 *   `@api` — toggle on, prove it persisted, toggle off, prove that persisted too;
 *            then the scope and token walls.
 *   `@ui`  — the real door page ticks someone in and the "checked in" count moves.
 *
 * PROD-SAFE: only ever checks in an attendee this spec registered, then deletes
 * it; all minted links are revoked in `finally`.
 */

import { test, expect } from '@playwright/test';

import { KefiDoorPage } from '../../pages/kefi/KefiDoorPage.js';
import { KefiDoorLedgerClient } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { KefiPromoterClient } from '../../helpers/kefi/kefiPromoterClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/**
 * A well-formed but non-existent attendee id.
 *
 * Deliberately NOT the all-zeros GUID: `CheckInAttendeeValidator` applies
 * `NotEmpty()` to `attendeeExternalId`, so `Guid.Empty` is rejected as a
 * MALFORMED request (400) before the lookup ever runs. Using it here would
 * assert the validator, not the not-found path — two different behaviours that
 * happen to both be "an error".
 */
const UNKNOWN_ATTENDEE_ID = 'a1b2c3d4-0000-4000-8000-abcdefabcdef';
/** The empty GUID — the validator's own case, asserted separately below. */
const EMPTY_ATTENDEE_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Kefi door check-in', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api a Door token checks an attendee in and the change PERSISTS; a Promoter token cannot', async () => {
    const ops = await openEventOps();
    const door = new KefiDoorLedgerClient();
    const promoters = new KefiPromoterClient();
    try {
      const attendee = await ops.registerAttendee('checkin');
      const doorLink = await ops.mintLink({ recipientName: `${ops.marker} door`, scope: 'Door' });

      // ── Baseline: a new registration has not been through the door ──────
      const initial = await door.readAttendeeRow(
        ops.tenant.slug,
        doorLink.token,
        attendee.externalId,
      );
      expect(initial, 'the new attendee appears on the door list').not.toBeNull();
      expect(initial!.checkedIn, 'a new registration starts un-checked-in').toBe(false);

      // ── Check in ────────────────────────────────────────────────────────
      const checkedIn = await door.checkIn({
        slug: ops.tenant.slug,
        token: doorLink.token,
        attendeeExternalId: attendee.externalId,
        checkedIn: true,
      });
      expect(checkedIn.status, 'a Door token may check someone in').toBe(HTTP_OK);
      expect(
        (checkedIn.data as { checkedIn: boolean }).checkedIn,
        'the response reports the attendee as checked in',
      ).toBe(true);

      // ── ...and it STUCK. This re-read is the whole point of the test. ───
      const afterCheckIn = await door.readAttendeeRow(
        ops.tenant.slug,
        doorLink.token,
        attendee.externalId,
      );
      expect(
        afterCheckIn!.checkedIn,
        'a fresh read from the server confirms the check-in was persisted',
      ).toBe(true);

      // ── Un-check (a mis-tap at the door must be correctable) ────────────
      const undone = await door.checkIn({
        slug: ops.tenant.slug,
        token: doorLink.token,
        attendeeExternalId: attendee.externalId,
        checkedIn: false,
      });
      expect(undone.status, 'a check-in can be undone').toBe(HTTP_OK);
      const afterUndo = await door.readAttendeeRow(
        ops.tenant.slug,
        doorLink.token,
        attendee.externalId,
      );
      expect(afterUndo!.checkedIn, 'the un-check persisted too').toBe(false);

      // ── A Promoter token must NOT be able to check anyone in ────────────
      const promoter = await promoters.ensurePromoter(ops.bearer, ops.tenant.eventExternalId);
      const promoterLink = await ops.mintLink({
        recipientName: `${ops.marker} promoter`,
        scope: 'Promoter',
        promoterExternalId: promoter.externalId,
      });
      const promoterAttempt = await door.checkIn({
        slug: ops.tenant.slug,
        token: promoterLink.token,
        attendeeExternalId: attendee.externalId,
        checkedIn: true,
      });
      expect(
        promoterAttempt.status,
        'a Promoter token is forbidden from checking people in — it is not door authority',
      ).toBe(HTTP_FORBIDDEN);
      const afterPromoterAttempt = await door.readAttendeeRow(
        ops.tenant.slug,
        doorLink.token,
        attendee.externalId,
      );
      expect(
        afterPromoterAttempt!.checkedIn,
        'and the refused attempt changed nothing',
      ).toBe(false);

      // ── A Ledger token sits ABOVE Door on the capability ladder ─────────
      const ledgerLink = await ops.mintLink({
        recipientName: `${ops.marker} ledger`,
        scope: 'Ledger',
      });
      const byLedger = await door.checkIn({
        slug: ops.tenant.slug,
        token: ledgerLink.token,
        attendeeExternalId: attendee.externalId,
        checkedIn: true,
      });
      expect(byLedger.status, 'a Ledger token outranks Door and may check in').toBe(HTTP_OK);

      // ── Token + attendee walls ──────────────────────────────────────────
      expect(
        (
          await door.checkIn({
            slug: ops.tenant.slug,
            token: 'not-a-real-token',
            attendeeExternalId: attendee.externalId,
            checkedIn: true,
          })
        ).status,
        'a made-up token cannot check anyone in',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (
          await door.checkIn({
            slug: ops.tenant.slug,
            token: doorLink.token,
            attendeeExternalId: UNKNOWN_ATTENDEE_ID,
            checkedIn: true,
          })
        ).status,
        'an attendee outside the token event is not found',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (
          await door.checkIn({
            slug: ops.tenant.slug,
            token: doorLink.token,
            attendeeExternalId: EMPTY_ATTENDEE_ID,
            checkedIn: true,
          })
        ).status,
        'an empty attendee id is a malformed request, rejected before any lookup',
      ).toBe(HTTP_BAD_REQUEST);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });

  test('@ui the door page ticks an attendee in and the checked-in count moves', async ({ page }) => {
    const ops = await openEventOps();
    const api = new KefiDoorLedgerClient();
    try {
      const attendee = await ops.registerAttendee('checkin-ui');
      const doorLink = await ops.mintLink({
        recipientName: `${ops.marker} door-ui`,
        scope: 'Door',
      });

      const doorPage = new KefiDoorPage(page);
      await doorPage.gotoWithToken(ops.tenant.siteUrl, doorLink.token);

      // Narrow ~160 rows to ours the way a real door person would.
      await doorPage.searchFor(attendee.surname);
      await expect(
        doorPage.row(attendee.externalId),
        'the attendee we registered is on the door list',
      ).toBeVisible();

      const countBefore = (await doorPage.checkedCount.textContent()) ?? '';
      await expect(
        doorPage.checkInBox(attendee.externalId),
        'they start un-checked-in',
      ).not.toBeChecked();

      // ── Tick them in ────────────────────────────────────────────────────
      expect(
        await doorPage.checkInAndAwaitWrite(ops.tenant.slug, attendee.externalId),
        'the door page writes the check-in back to the API',
      ).toBe(HTTP_OK);

      await expect(
        doorPage.checkInBox(attendee.externalId),
        'the checkbox reflects the check-in',
      ).toBeChecked();
      await expect(
        doorPage.checkedCount,
        'the checked-in headline count moved',
      ).not.toHaveText(countBefore);

      // And the server agrees — not just the page's own optimistic state.
      const persisted = await api.readAttendeeRow(
        ops.tenant.slug,
        doorLink.token,
        attendee.externalId,
      );
      expect(persisted!.checkedIn, 'the UI check-in persisted server-side').toBe(true);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });
});
