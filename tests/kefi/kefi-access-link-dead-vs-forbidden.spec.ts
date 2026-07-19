/**
 * Kefi ACCESS-LINK STATUS-CODE E2E — 404 means "dead", 403 means "not for you",
 * and the two must never be confused.
 *
 * This is one test, and it is here on its own because the distinction it pins is
 * a security property AND a UX property at the same time:
 *
 *  - **A dead link 404s for EVERY reason.** Revoked, expired, spent and
 *    never-existed all return the same 404 from `AccessLinkTokenValidator`,
 *    deliberately: someone probing a leaked link learns only that it does not
 *    work, never why, so it cannot be fingerprinted. A test that checked only the
 *    revoked path would happily let a future "helpful" 410-for-expired through.
 *
 *  - **A live token on the wrong page is 403, not 404.** The credential is fine;
 *    the action is not for them. The door, ledger and crew pages branch on
 *    exactly this pair — 404 renders "this link is no longer valid", 403 renders
 *    "this link doesn't grant this view". Collapsing them is what told promoters
 *    holding a perfectly good link that it had expired, sending them back to the
 *    organizer for a replacement they did not need.
 *
 * The gate that produces a genuine 403 is CHECK-IN, not the ledger read: reading
 * the ledger needs only Promoter rank and every scope clears that, but checking
 * someone in needs Door rank (`AccessLinkScopeCapability`). So a Promoter token on
 * the check-in route is the one clean valid-but-forbidden case in the system.
 *
 * Pure `@api`. PROD-SAFE: every link is revoked and every attendee deleted in
 * `finally` via the tracked event-ops teardown.
 */

import { test, expect } from '@playwright/test';

import { KefiDoorLedgerClient, type LedgerView } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { KefiPromoterClient } from '../../helpers/kefi/kefiPromoterClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

test.describe('Kefi access link dead-vs-forbidden', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api a dead link is 404 for EVERY reason, but a live token on the wrong page is 403', async () => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    const promoters = new KefiPromoterClient();
    try {
      const promoter = await promoters.ensurePromoter(ops.bearer, ops.tenant.eventExternalId);

      const doomed = await ops.mintLink({ recipientName: `${ops.marker} doomed`, scope: 'Door' });
      const promoterLink = await ops.mintLink({
        recipientName: `${ops.marker} promo-403`,
        scope: 'Promoter',
        promoterExternalId: promoter.externalId,
      });

      // Prove the token works BEFORE killing it, so the 404 after cannot be a
      // false pass caused by the token never having worked at all.
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, doomed.token)).status,
        'the Door token opens the ledger while it is alive',
      ).toBe(HTTP_OK);

      // ── DEAD: revoked ───────────────────────────────────────────────────
      await ops.links.revoke(ops.bearer, ops.tenant.eventExternalId, doomed.externalId);
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, doomed.token)).status,
        'a REVOKED token is 404 — not 401, not 403, not 410',
      ).toBe(HTTP_NOT_FOUND);

      // ── DEAD: never existed ─────────────────────────────────────────────
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, 'never-was-a-token')).status,
        'a token that never existed is 404 — INDISTINGUISHABLE from the revoked one, so a ' +
          'leaked link cannot be fingerprinted by probing',
      ).toBe(HTTP_NOT_FOUND);

      // ── DEAD: structurally plausible but unknown ────────────────────────
      expect(
        (
          await ledger.getLedgerByToken(
            ops.tenant.slug,
            'a'.repeat(doomed.token.length),
          )
        ).status,
        'a token of the RIGHT SHAPE but unknown value is the same 404 — the response does ' +
          'not leak whether a hash matched',
      ).toBe(HTTP_NOT_FOUND);

      // ── ALIVE but wrong page: 403, and it must NOT be 404 ───────────────
      // Reading the ledger needs Promoter rank (any link clears it); checking
      // someone in needs Door rank, which a Promoter link does not have.
      //
      // The target must be a REAL attendee. `CheckInAttendeeValidator` rejects an
      // empty guid with a 400 before the scope wall is ever reached, so aiming at
      // a made-up id would assert nothing about scope at all.
      const target = await ops.registerAttendee('scope-403');
      const wrongPage = await ledger.checkIn({
        slug: ops.tenant.slug,
        token: promoterLink.token,
        attendeeExternalId: target.externalId,
        checkedIn: true,
      });
      expect(
        wrongPage.status,
        'a LIVE Promoter token on the check-in route is 403 — the credential is fine, the ' +
          'page is not for them. Collapsing this into 404 is what told promoters holding a ' +
          'perfectly good link that it had "expired".',
      ).toBe(HTTP_FORBIDDEN);
      expect(
        wrongPage.status,
        'and it is specifically NOT the dead-link 404 — these two codes drive two different ' +
          'screens, and the pages branch on exactly this',
      ).not.toBe(HTTP_NOT_FOUND);

      // The same live token is still perfectly good on the page it IS for.
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, promoterLink.token)).status,
        'the very same Promoter token opens the ledger it is scoped to — proving the 403 ' +
          'above was about the ACTION, not a dead credential',
      ).toBe(HTTP_OK);

      // And the wall HELD. A 403 that still wrote the row would be worse than no
      // wall at all, because it would look like it was working. Read back through
      // the ORGANIZER bearer — the promoter's own token cannot see this attendee
      // (they did not refer them), which is the whole point of the scope filter.
      const organizerView = await ledger.getLedgerByBearer(
        ops.tenant.slug,
        ops.bearer,
        ops.tenant.eventExternalId,
      );
      expect(organizerView.status, 'the organizer can read the full ledger').toBe(HTTP_OK);
      const row = (organizerView.data as LedgerView).attendees.find(
        (a) => a.attendeeExternalId === target.externalId,
      );
      expect(row, 'the attendee we registered is on the event').toBeDefined();
      expect(
        row!.checkedIn,
        'the rejected check-in did NOT happen — the 403 refused the write, it did not merely ' +
          'report one',
      ).toBe(false);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link this test created was cleaned up').toEqual([]);
    }
  });
});
