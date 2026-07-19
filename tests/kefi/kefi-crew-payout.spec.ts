/**
 * Kefi CREW PAYOUT E2E — the page a promoter, teacher or ambassador opens to
 * answer one question: "how much am I getting, and for whom?".
 *
 * Two things make this worth a spec rather than a smoke check:
 *
 *  1. **The money on this page must equal the money in the organizer's books.**
 *     `LedgerCrewDto.ExpectedPayoutEur` is taken straight from the P&L promoter
 *     line and never recomputed, precisely so the promoter's view and the
 *     organizer's ledger can never disagree. A promoter and an organizer looking
 *     at different numbers for the same night is not a rendering bug, it is an
 *     argument. So the `@api` tier asserts the crew block against the SAME
 *     event's Ledger-scope promoter line, rather than against a hard-coded figure.
 *
 *  2. **The crew block is Promoter-scope ONLY.** A Door or Ledger token gets a
 *     200 with no crew block at all — not an empty one, and not a €0 payout that
 *     would read as "you earned nothing" rather than "this isn't your page".
 *     Which panel the page then shows for each kind of link is pinned separately
 *     in `kefi-crew-link-states.spec.ts`.
 *
 * PROD-SAFE: every attendee and link is torn down via the tracked event-ops
 * teardown, and the crew-terms write goes through
 * `KefiCrewTermsClient.withTemporaryTerms`, which restores the organizer's own
 * copy in a `finally` even when the assertions throw.
 */

import { test, expect } from '@playwright/test';

import { KefiCrewPage } from '../../pages/kefi/KefiCrewPage.js';
import { KefiCrewTermsClient } from '../../helpers/kefi/kefiCrewTermsClient.js';
import { KefiDoorLedgerClient, type LedgerView } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { KefiPromoterClient } from '../../helpers/kefi/kefiPromoterClient.js';
import { openEventOps, type EventOpsSession } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureAttendeeEmail,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;
const PAID_EUR = 30;
const CENTS = 100;

/** Markup that survives the crew page's allowlist sanitiser unchanged. */
const TEST_TERMS_HTML =
  '<p>E2E crew terms — <strong>you keep 5 EUR per paid guest</strong>.</p>' +
  '<ul><li>Paid guests only.</li><li>Settled within 7 days.</li></ul>';

/** A distinctive phrase from the terms above, to assert they reached the page. */
const TERMS_PHRASE = 'you keep 5 EUR per paid guest';

/** Round euros to whole cents so decimals compare exactly. */
function cents(value: number): number {
  return Math.round(value * CENTS);
}

/**
 * Mirror of `formatEur` in `kefi-landings/src/lib/ledger-pnl.ts` — two decimals
 * with a trailing `.00` dropped, so €30 renders as "€30" and €30.50 as "€30.50".
 *
 * Duplicated rather than imported: the E2E suite must not take a build-time
 * dependency on the site's source, and asserting `toFixed(2)` instead would
 * silently pass on any page that happened to print the raw number.
 */
function formatEur(amount: number): string {
  return `€${(Math.round(amount * CENTS) / CENTS).toFixed(2).replace(/\.00$/, '')}`;
}

/**
 * Give the suite's promoter exactly one referred attendee, so the crew view is a
 * real slice rather than a vacuously empty one. `referredBy` is resolvable only
 * through the import path — the public register form carries no referral field.
 */
async function seedReferral(
  ops: EventOpsSession,
  promoterName: string,
  discriminator: string,
): Promise<{ surname: string }> {
  const surname = `${ops.marker}-${discriminator}`;
  await ops.importAttendee({
    name: 'E2E',
    surname,
    email: fixtureAttendeeEmail(ops.marker, discriminator),
    phone: '+35799000000',
    passCode: 'FULL',
    paidEur: PAID_EUR,
    paymentMethod: 'cash',
    referredBy: promoterName,
  });
  return { surname };
}

test.describe('Kefi crew payout', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api the crew block reaches a Promoter token only, and its payout equals the organizer P&L line', async () => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    const promoters = new KefiPromoterClient();
    try {
      const promoter = await promoters.ensurePromoter(ops.bearer, ops.tenant.eventExternalId);
      const referral = await seedReferral(ops, promoter.name, 'crew-api');

      const promoterLink = await ops.mintLink({
        recipientName: `${ops.marker} crew`,
        scope: 'Promoter',
        promoterExternalId: promoter.externalId,
      });
      const doorLink = await ops.mintLink({ recipientName: `${ops.marker} crew-door`, scope: 'Door' });
      const ledgerLink = await ops.mintLink({
        recipientName: `${ops.marker} crew-ledger`,
        scope: 'Ledger',
      });

      const read = async (token: string): Promise<LedgerView> => {
        const resp = await ledger.getLedgerByToken(ops.tenant.slug, token);
        expect(resp.status, 'a valid token opens the ledger endpoint').toBe(HTTP_OK);
        return resp.data as LedgerView;
      };

      const promoterView = await read(promoterLink.token);
      const doorView = await read(doorLink.token);
      const ledgerView = await read(ledgerLink.token);

      // ── The crew block is Promoter-scope ONLY ───────────────────────────
      expect(promoterView.crew, 'a Promoter token receives its crew block').not.toBeNull();
      expect(
        doorView.crew ?? null,
        'a DOOR token receives NO crew block — a door volunteer has no payout deal, and the ' +
          'page must show "wrong link" rather than an empty EUR 0 payout',
      ).toBeNull();
      expect(
        ledgerView.crew ?? null,
        'a LEDGER token receives no crew block either — the organizer already sees every ' +
          'payout line through the P&L',
      ).toBeNull();

      const crew = promoterView.crew!;
      expect(crew.promoterName, 'the crew block names the promoter the link is bound to').toBe(
        promoter.name,
      );
      expect(crew.role, 'and carries their role').toBeTruthy();

      // ── The money matches the organizer's books, exactly ────────────────
      const organizerLine = ledgerView.promoters.find(
        (p) => p.externalId === promoter.externalId,
      );
      expect(
        organizerLine,
        'the organizer P&L carries a payout line for this promoter',
      ).toBeDefined();
      expect(
        cents(crew.expectedPayoutEur),
        'the promoter sees EXACTLY the payout the organizer sees — the crew view reads the ' +
          'P&L line rather than recomputing, so these can never legitimately diverge',
      ).toBe(cents(organizerLine!.payoutEur));
      expect(
        crew.settled,
        'and the settled flag agrees with the organizer line too',
      ).toBe(organizerLine!.paid);

      // ── The referral list is the promoter's own, and only theirs ────────
      expect(
        crew.referrals.some((r) => r.surname === referral.surname),
        'the attendee we referred to this promoter appears in their crew referrals',
      ).toBe(true);
      expect(
        crew.referrals.length,
        'and the crew referral list matches the scope-filtered attendee list exactly — a ' +
          'promoter never sees someone else\'s guest',
      ).toBe(promoterView.attendees.length);
      expect(
        crew.referrals.length,
        'which is a strict subset of the whole event',
      ).toBeLessThan(ledgerView.attendees.length);

      expect(
        crew.paidReferralCount,
        'the paid-referral count agrees with the rows it is derived from',
      ).toBe(crew.referrals.filter((r) => r.paid).length);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });

  test('@ui the crew page renders the payout, the referrals and the terms for a Promoter link', async ({
    page,
  }) => {
    const ops = await openEventOps();
    const ledger = new KefiDoorLedgerClient();
    const promoters = new KefiPromoterClient();
    const terms = new KefiCrewTermsClient();
    try {
      const promoter = await promoters.ensurePromoter(ops.bearer, ops.tenant.eventExternalId);
      const referral = await seedReferral(ops, promoter.name, 'crew-ui');
      const promoterLink = await ops.mintLink({
        recipientName: `${ops.marker} crew-ui`,
        scope: 'Promoter',
        promoterExternalId: promoter.externalId,
      });

      const view = await ledger.getLedgerByToken(ops.tenant.slug, promoterLink.token);
      expect(view.status, 'the Promoter token opens the ledger endpoint').toBe(HTTP_OK);
      const crew = (view.data as LedgerView).crew!;

      await terms.withTemporaryTerms(
        ops.bearer,
        ops.tenant.eventExternalId,
        TEST_TERMS_HTML,
        async () => {
          const crewPage = new KefiCrewPage(page);
          await crewPage.openPayout(ops.tenant.siteUrl, promoterLink.token);

          // The headline: who they are and what they are owed.
          await expect(crewPage.promoterName, 'the page names the promoter').toHaveText(
            promoter.name,
          );
          await expect(
            crewPage.payoutAmount,
            'the headline payout shows EXACTLY the server figure, in the page\'s own euro ' +
              'format — this is the one number the promoter came for',
          ).toHaveText(formatEur(crew.expectedPayoutEur));
          await expect(crewPage.settledBadge, 'the settle state is shown').toBeVisible();
          await expect(
            crewPage.broughtLine,
            'and the page says how many they brought',
          ).toContainText(String(crew.referrals.length));

          // Their people.
          await expect(
            crewPage.referralRowByText(referral.surname),
            'the attendee they referred is listed on their own page',
          ).toBeVisible();
          await expect(
            crewPage.statTile('Expected payout'),
            'the stat tiles render',
          ).toBeVisible();

          // The organizer-authored terms, sanitised and rendered.
          await expect(
            crewPage.termsCard,
            'the terms card appears once the organizer has published terms',
          ).toBeVisible();
          await expect(crewPage.terms, 'and shows the published copy').toContainText(
            TERMS_PHRASE,
          );
          await expect(
            crewPage.terms.locator('li'),
            'including its list structure — the allowlist sanitiser keeps real markup',
          ).toHaveCount(2);

          // The print affordance this page exists to hand a promoter.
          await expect(
            crewPage.printButton,
            'the promoter can print or save their payout as a PDF',
          ).toBeVisible();

          // And none of the failure panels won.
          await expect(crewPage.wrongScopePanel, 'no wrong-scope panel').toBeHidden();
          await expect(crewPage.linkInvalidPanel, 'no invalid-link panel').toBeHidden();
        },
      );
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every link and row this test created was cleaned up').toEqual([]);
    }
  });
});
