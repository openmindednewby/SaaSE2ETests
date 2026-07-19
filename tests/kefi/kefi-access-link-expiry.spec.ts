/**
 * Kefi ACCESS-LINK EXPIRY / ONE-TIME E2E — the lifecycle a scoped, login-free
 * URL goes through, and the two status codes that must never be confused.
 *
 * `kefi-access-links.spec.ts` proves mint/list/revoke and the scope-filtering
 * model. This spec covers what shipped on top of that: an optional expiry, an
 * optional one-time flag, and the computed `status` the organizer reads. The
 * properties worth a test are all security properties:
 *
 *  1. **The expiry a caller asks for is the expiry they get, and the window is
 *     bounded.** The arithmetic is server-side; a link with no expiry keeps the
 *     exact pre-expiry behaviour, so every caller written before this shipped is
 *     unaffected.
 *
 *  2. **A one-time link is spent by its first use — visibly, and immediately.**
 *     `UsedAt` is stamped on the first successful validation and the organizer's
 *     status flips to `Used` there and then, even though a 30-minute grace
 *     window keeps the token working for the rest of that page-load's requests
 *     (otherwise the very page that just consumed the link would 404 its own
 *     follow-up calls). The grace is why this spec asserts the STATUS flip, not
 *     a 404 — a spec that waited 30 minutes for the hard rejection would be a
 *     30-minute spec.
 *
 * The 404-for-every-dead-reason vs 403-for-wrong-page distinction lives in its own
 * file, `kefi-access-link-dead-vs-forbidden.spec.ts`.
 *
 * Not covered here, and deliberately: the expired→404 transition itself. The
 * API's minimum expiry is 1 DAY (`AccessLinkExpiryWindow.MinDays`), so an
 * already-dead link cannot be minted through the public contract, and no E2E can
 * conjure one without reaching behind the API into the database. The expiry
 * ARITHMETIC is asserted here (the returned `expiresAt` lands on the right day);
 * the clock-crossing behaviour is left to `AccessLinkExpiryPolicy`'s unit tests,
 * which own it.
 *
 * Pure `@api`. PROD-SAFE: every link is revoked in `finally` via the tracked
 * event-ops teardown, and no pre-existing link is ever revoked or inspected.
 */

import { test, expect } from '@playwright/test';

import type { AccessLinkRow } from '../../helpers/kefi/kefiAccessLinkClient.js';
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

const EXPIRY_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** The arithmetic is server-side; allow a generous window for clock skew + latency. */
const EXPIRY_TOLERANCE_MS = 10 * 60 * 1000;

test.describe('Kefi access link expiry and one-time use', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api a link can be minted with an expiry, and the expiry window is validated', async () => {
    const ops = await openEventOps();
    try {
      const mintedAt = Date.now();
      const expiring = await ops.mintLink({
        recipientName: `${ops.marker} expiring`,
        scope: 'Door',
        expiresInDays: EXPIRY_DAYS,
      });

      expect(
        expiring.created.expiresAt,
        'a link minted WITH an expiry reports one',
      ).not.toBeNull();
      const expiresAtMs = Date.parse(expiring.created.expiresAt!);
      expect(
        Math.abs(expiresAtMs - (mintedAt + EXPIRY_DAYS * MS_PER_DAY)),
        `the expiry lands ${EXPIRY_DAYS} days out — the server did the arithmetic, not the client`,
      ).toBeLessThan(EXPIRY_TOLERANCE_MS);
      expect(
        expiring.created.status,
        'a freshly minted link with a future expiry is Active, not Expired',
      ).toBe('Active');

      // The default is unchanged for callers that never heard of expiry.
      const eternal = await ops.mintLink({
        recipientName: `${ops.marker} eternal`,
        scope: 'Door',
      });
      expect(
        eternal.created.expiresAt,
        'omitting expiresInDays keeps the pre-expiry behaviour — the link never dies',
      ).toBeNull();
      expect(eternal.created.oneTime, 'and is not one-time either').toBe(false);

      // Both facts survive the round trip into the organizer list.
      const rows = (await ops.links.list(ops.bearer, ops.tenant.eventExternalId))
        .data as AccessLinkRow[];
      const expiringRow = rows.find((r) => r.externalId === expiring.externalId);
      const eternalRow = rows.find((r) => r.externalId === eternal.externalId);
      expect(expiringRow?.expiresAt, 'the list reports the expiry it stored').not.toBeNull();
      expect(expiringRow?.status, 'and computes it as Active').toBe('Active');
      expect(eternalRow?.expiresAt, 'and reports null for the link that never expires').toBeNull();

      // ── The expiry window is bounded ────────────────────────────────────
      const mintWithDays = async (days: number): Promise<number> =>
        (
          await ops.links.mint(ops.bearer, ops.tenant.eventExternalId, {
            recipientName: `${ops.marker} range-${days}`,
            scope: 'Door',
            expiresInDays: days,
          })
        ).status;

      expect(await mintWithDays(0), 'a zero-day expiry is rejected — it would be born dead').toBe(
        HTTP_BAD_REQUEST,
      );
      expect(await mintWithDays(-1), 'a negative expiry is rejected').toBe(HTTP_BAD_REQUEST);
      expect(
        await mintWithDays(366),
        'an expiry beyond a year is rejected — an access link is not a permanent credential',
      ).toBe(HTTP_BAD_REQUEST);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link this test created was cleaned up').toEqual([]);
    }
  });

  test('@api a one-time link is stamped Used by its first use, while a multi-use link stays Active', async () => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    try {
      const once = await ops.mintLink({
        recipientName: `${ops.marker} one-time`,
        scope: 'Ledger',
        oneTime: true,
      });
      const many = await ops.mintLink({
        recipientName: `${ops.marker} multi-use`,
        scope: 'Ledger',
      });

      expect(once.created.oneTime, 'the one-time link reports itself one-time').toBe(true);
      expect(once.created.usedAt, 'and is untouched at mint').toBeNull();
      expect(once.created.status, 'and starts Active').toBe('Active');

      const statusOf = async (externalId: string): Promise<AccessLinkRow | undefined> => {
        const rows = (await ops.links.list(ops.bearer, ops.tenant.eventExternalId))
          .data as AccessLinkRow[];
        return rows.find((r) => r.externalId === externalId);
      };

      expect(
        (await statusOf(once.externalId))?.status,
        'an unused one-time link reads Active to the organizer',
      ).toBe('Active');

      // ── First use ───────────────────────────────────────────────────────
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, once.token)).status,
        'the one-time token opens the ledger on its first use',
      ).toBe(HTTP_OK);

      const afterFirstUse = await statusOf(once.externalId);
      expect(
        afterFirstUse?.usedAt,
        'the first successful validation STAMPED the use — validation is the consumption point',
      ).not.toBeNull();
      expect(
        afterFirstUse?.status,
        'and the organizer sees it as Used IMMEDIATELY, not once the grace window closes — ' +
          'the dashboard must not imply a spent link is still handable to someone',
      ).toBe('Used');
      expect(
        afterFirstUse?.revoked,
        'a spent link is not the same thing as a revoked one — the organizer never revoked it',
      ).toBe(false);

      // ── The grace window: the same working session keeps working ────────
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, once.token)).status,
        'the token still works inside the grace window — a door volunteer whose page just ' +
          'consumed the link must not have that same page 404 its follow-up requests',
      ).toBe(HTTP_OK);

      const stampedTwice = await statusOf(once.externalId);
      expect(
        stampedTwice?.usedAt,
        'and the stamp did NOT move — the grace is measured from the genuine first use and ' +
          'cannot be extended by hitting the link again',
      ).toBe(afterFirstUse?.usedAt);

      // ── A multi-use link is unaffected by any of this ────────────────────
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, many.token)).status,
        'a multi-use token opens the ledger',
      ).toBe(HTTP_OK);
      const multiRow = await statusOf(many.externalId);
      expect(multiRow?.oneTime, 'the multi-use link is not one-time').toBe(false);
      expect(multiRow?.usedAt, 'and is never stamped — there is nothing to spend').toBeNull();
      expect(multiRow?.status, 'so it stays Active however often it is used').toBe('Active');
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link this test created was cleaned up').toEqual([]);
    }
  });
});
