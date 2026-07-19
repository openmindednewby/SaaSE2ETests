/**
 * Kefi ACCESS-LINK E2E — mint / list / revoke, and the scope model they enforce.
 *
 * Access links are Kefi's answer to "my door person has no account": a scoped,
 * login-free URL. That makes them a CREDENTIAL, and this spec treats them as one.
 * Three properties matter more than the happy path:
 *
 *  1. **Revocation actually revokes.** A revoked token must stop opening the
 *     door, immediately. Anything less means an ex-volunteer keeps their access.
 *  2. **Scope is enforced server-side, not by the page they land on.** A Door
 *     token must not see the money (`pnl` is null) and a Promoter token must not
 *     see other promoters' people. If the filtering lived in the page, anyone
 *     could read the whole ledger by calling the API directly — so the assertions
 *     here deliberately hit the API, bypassing the UI entirely.
 *  3. **The raw token is shown exactly once.** It lives only inside the mint
 *     response's `url`; the list response must never leak it or its hash.
 *
 * Pure `@api`. PROD-SAFE: every link this spec mints is revoked in `finally`,
 * every attendee it creates is deleted, and it never revokes a pre-existing link.
 */

import { test, expect } from '@playwright/test';

import { KefiAccessLinkClient, type AccessLinkRow } from '../../helpers/kefi/kefiAccessLinkClient.js';
import { KefiDoorLedgerClient, type LedgerView } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { KefiPromoterClient } from '../../helpers/kefi/kefiPromoterClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;

const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const UNKNOWN_EVENT_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Kefi access links', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api mints Door/Ledger/Promoter links, lists them without leaking tokens, and revokes them', async () => {
    const ops = await openEventOps();
    const links = new KefiAccessLinkClient();
    const ledger = new KefiDoorLedgerClient();
    const promoters = new KefiPromoterClient();
    try {
      const promoter = await promoters.ensurePromoter(ops.bearer, ops.tenant.eventExternalId);

      // ── Mint one link of each scope ─────────────────────────────────────
      const door = await ops.mintLink({ recipientName: `${ops.marker} door`, scope: 'Door' });
      const ledgerLink = await ops.mintLink({
        recipientName: `${ops.marker} ledger`,
        scope: 'Ledger',
      });
      const promoterLink = await ops.mintLink({
        recipientName: `${ops.marker} promoter`,
        scope: 'Promoter',
        promoterExternalId: promoter.externalId,
      });

      // The minted URL points the recipient at the right page for their job.
      expect(door.url, 'a Door link opens the door page').toContain('/door?token=');
      expect(ledgerLink.url, 'a Ledger link opens the ledger page').toContain('/ledger?token=');
      expect(
        promoterLink.url,
        'a Promoter link opens the ledger page (scope-filtered server-side)',
      ).toContain('/ledger?token=');

      // ── The list shows them but never leaks the credential ──────────────
      const listed = await links.list(ops.bearer, ops.tenant.eventExternalId);
      expect(listed.status, 'the organizer can list their links').toBe(HTTP_OK);
      const rows = listed.data as AccessLinkRow[];
      const ourRows = rows.filter((r) => r.recipientName.startsWith(ops.marker));
      expect(ourRows, 'all three minted links are listed').toHaveLength(3);
      for (const row of ourRows) {
        expect(row.revoked, `${row.scope} link starts un-revoked`).toBe(false);
        expect(
          JSON.stringify(row),
          `the ${row.scope} list row leaks no raw token — it is shown only once, at mint`,
        ).not.toContain(door.token);
      }
      const promoterRow = ourRows.find((r) => r.scope === 'Promoter');
      expect(
        promoterRow?.promoterExternalId,
        'a promoter link records which promoter it is bound to',
      ).toBe(promoter.externalId);

      // ── Validation walls on minting ─────────────────────────────────────
      expect(
        (
          await links.mint(ops.bearer, ops.tenant.eventExternalId, {
            recipientName: `${ops.marker} bad`,
            scope: 'Wizard',
          })
        ).status,
        'an unknown scope is rejected',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        (
          await links.mint(ops.bearer, ops.tenant.eventExternalId, {
            recipientName: '',
            scope: 'Door',
          })
        ).status,
        'a link must name its recipient, so it can be audited and revoked',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        (
          await links.mint(ops.bearer, ops.tenant.eventExternalId, {
            recipientName: `${ops.marker} promoterless`,
            scope: 'Promoter',
          })
        ).status,
        'a promoter-scope link without a promoter is rejected',
      ).toBe(HTTP_BAD_REQUEST);

      // ── Authorization walls ─────────────────────────────────────────────
      expect(
        (await links.list('', ops.tenant.eventExternalId)).status,
        'an unauthenticated caller cannot list access links',
      ).toBe(HTTP_UNAUTHORIZED);
      expect(
        (await links.list(ops.bearer, UNKNOWN_EVENT_ID)).status,
        'an event outside the caller tenant is not found',
      ).toBe(HTTP_NOT_FOUND);

      // ── Revocation actually revokes ─────────────────────────────────────
      // Prove it worked BEFORE revoking, so the 404 after cannot be a false pass.
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, door.token)).status,
        'the Door token opens the ledger before revocation',
      ).toBe(HTTP_OK);

      const revoked = await links.revoke(ops.bearer, ops.tenant.eventExternalId, door.externalId);
      expect(revoked.status, 'revoking a link succeeds').toBe(HTTP_NO_CONTENT);
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, door.token)).status,
        'a REVOKED token no longer opens the ledger',
      ).toBe(HTTP_NOT_FOUND);

      // Revocation is idempotent, and the list reflects the new state.
      expect(
        (await links.revoke(ops.bearer, ops.tenant.eventExternalId, door.externalId)).status,
        'revoking twice is idempotent',
      ).toBe(HTTP_NO_CONTENT);
      const afterRevoke = (await links.list(ops.bearer, ops.tenant.eventExternalId))
        .data as AccessLinkRow[];
      expect(
        afterRevoke.find((r) => r.externalId === door.externalId)?.revoked,
        'the revoked link is flagged in the list',
      ).toBe(true);

      // A garbage token was never valid in the first place.
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, 'not-a-real-token')).status,
        'a made-up token is rejected',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await ledger.getLedgerByToken(ops.tenant.slug, '')).status,
        'no token at all is rejected (there is no anonymous ledger)',
      ).not.toBe(HTTP_OK);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });

  test('@api each scope sees exactly its own slice — Ledger the money, Door the people, Promoter only their referrals', async () => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    const promoters = new KefiPromoterClient();
    try {
      const promoter = await promoters.ensurePromoter(ops.bearer, ops.tenant.eventExternalId);

      // One attendee referred BY our promoter, so the promoter slice is a real
      // subset rather than a vacuously empty list. (`referredBy` is resolvable
      // only through the import path — the public form has no referral field.)
      const referred = await ops.importAttendee({
        name: 'E2E',
        surname: `${ops.marker}-referred`,
        email: fixtureAttendeeEmail(ops.marker, 'referred'),
        phone: '+35799000000',
        passCode: 'FULL',
        paidEur: 30,
        paymentMethod: 'cash',
        referredBy: promoter.name,
      });

      const door = await ops.mintLink({ recipientName: `${ops.marker} door-s`, scope: 'Door' });
      const full = await ops.mintLink({ recipientName: `${ops.marker} ledger-s`, scope: 'Ledger' });
      const promo = await ops.mintLink({
        recipientName: `${ops.marker} promoter-s`,
        scope: 'Promoter',
        promoterExternalId: promoter.externalId,
      });

      const read = async (token: string): Promise<LedgerView> => {
        const resp = await ledger.getLedgerByToken(ops.tenant.slug, token);
        expect(resp.status, 'a valid token opens the ledger').toBe(HTTP_OK);
        return resp.data as LedgerView;
      };

      const ledgerView = await read(full.token);
      const doorView = await read(door.token);
      const promoterView = await read(promo.token);

      // ── Ledger scope — the full financial picture ───────────────────────
      expect(ledgerView.scope, 'a Ledger token reports Ledger scope').toBe('Ledger');
      expect(ledgerView.pnl, 'a Ledger token receives the computed P&L').not.toBeNull();
      expect(
        ledgerView.pnl!.grossPassRevenueEur,
        'the P&L reports real gross revenue for a populated event',
      ).toBeGreaterThan(0);

      // ── Door scope — the people, none of the money ──────────────────────
      expect(doorView.scope, 'a Door token reports Door scope').toBe('Door');
      expect(
        doorView.pnl,
        'a Door token receives NO P&L — door staff must not see the takings',
      ).toBeNull();
      expect(
        doorView.compRules,
        'a Door token receives no comp rules — those are financial config',
      ).toEqual([]);
      expect(
        doorView.promoters,
        'a Door token receives no promoter payout lines',
      ).toEqual([]);
      expect(
        doorView.attendees.length,
        'a Door token still receives the full attendee list — it has to check people in',
      ).toBe(ledgerView.attendees.length);

      // ── Promoter scope — only their own people, and no aggregates ───────
      expect(promoterView.scope, 'a Promoter token reports Promoter scope').toBe('Promoter');
      expect(
        promoterView.pnl,
        'a Promoter token receives NO aggregate P&L',
      ).toBeNull();
      expect(
        promoterView.promoters,
        'a Promoter token sees exactly one promoter line — their own',
      ).toHaveLength(1);
      expect(
        promoterView.promoters[0].externalId,
        'and that line is the promoter the link is bound to',
      ).toBe(promoter.externalId);
      expect(
        promoterView.attendees.map((a) => a.attendeeExternalId),
        'a Promoter token sees ONLY the attendees they referred',
      ).toEqual([referred.externalId]);
      expect(
        promoterView.attendees.length,
        'and that is a strict subset of the full list',
      ).toBeLessThan(ledgerView.attendees.length);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });
});
