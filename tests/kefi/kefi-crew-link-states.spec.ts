/**
 * Kefi CREW-LINK STATE E2E — the crew page must say the RIGHT wrong thing.
 *
 * A promoter who opens a link that does not work gets one of three screens, and
 * which one they get decides what they do next:
 *
 *   `#crew-view`     their payout — a Promoter-scope link
 *   `#wrong-scope`   "this link doesn't grant the crew view" — a LIVE door or
 *                    ledger link. Their credential is fine; they opened the wrong
 *                    one, or were sent the wrong one.
 *   `#link-invalid`  "this link is no longer valid" — the API's 404, which every
 *                    dead-link reason (revoked / expired / spent / unknown)
 *                    collapses into.
 *
 * The page used to render the middle case as the third, which is not a cosmetic
 * mix-up: it tells someone holding a working credential that it is dead, and
 * sends them back to the organizer for a replacement they do not need.
 *
 * Worth knowing, because it is not the obvious mechanism: a Door token on this
 * page does NOT get a 403. Door OUTRANKS Promoter for the ledger read
 * (`AccessLinkScopeCapability`), so the API returns 200 — with no `crew` block,
 * because that block is attached on the Promoter branch alone. The page infers
 * "wrong scope" from the missing block. The genuine 403 lives on the check-in
 * route and is pinned in `kefi-access-link-dead-vs-forbidden.spec.ts`.
 *
 * `@ui`. PROD-SAFE: every link is revoked in `finally` via the tracked event-ops
 * teardown; this spec creates no attendees at all.
 */

import { test, expect } from '@playwright/test';

import { KefiCrewPage } from '../../pages/kefi/KefiCrewPage.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

test.describe('Kefi crew link states', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui a Door link shows "wrong link for this page", NOT "link expired" — and a dead link shows the opposite', async ({
    page,
  }) => {
    const ops = await openEventOps();
    try {
      const doorLink = await ops.mintLink({
        recipientName: `${ops.marker} crew-wrongscope`,
        scope: 'Door',
      });
      // A second link we then revoke. Its scope is irrelevant — a dead link is
      // dead before scope is ever considered.
      const revokedLink = await ops.mintLink({
        recipientName: `${ops.marker} crew-revoked`,
        scope: 'Door',
      });

      const crewPage = new KefiCrewPage(page);

      // ── A LIVE token that is simply not for this page ───────────────────
      await crewPage.gotoWithToken(ops.tenant.siteUrl, doorLink.token);
      await expect(
        crewPage.wrongScopePanel,
        'a live Door link says the link does not grant the crew view',
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        crewPage.linkInvalidPanel,
        'and specifically does NOT claim the link is expired or revoked — it is a perfectly ' +
          'good credential, just not for this page. Telling the holder otherwise sends them ' +
          'back to the organizer for a replacement they do not need.',
      ).toBeHidden();
      await expect(crewPage.crewView, 'and no payout is rendered').toBeHidden();

      // ── A genuinely DEAD token ──────────────────────────────────────────
      await ops.links.revoke(ops.bearer, ops.tenant.eventExternalId, revokedLink.externalId);
      await crewPage.gotoWithToken(ops.tenant.siteUrl, revokedLink.token);
      await expect(
        crewPage.linkInvalidPanel,
        'a REVOKED link says the link is no longer valid',
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        crewPage.wrongScopePanel,
        'and does not blame the scope — the two states never swap',
      ).toBeHidden();

      // ── No token at all ─────────────────────────────────────────────────
      await page.goto(`${ops.tenant.siteUrl}/crew/`);
      await expect(
        crewPage.gate,
        'with no token the page offers the paste-your-link gate rather than an error',
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link this test created was cleaned up').toEqual([]);
    }
  });
});
