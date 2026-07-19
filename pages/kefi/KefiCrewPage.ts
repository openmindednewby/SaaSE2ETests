/**
 * Page Object for the token-gated CREW PAYOUT page served at
 * `https://{slug}.kefi.dloizides.com/crew?token=…`.
 *
 * A STATIC Astro page (`kefi-landings/src/pages/t/[slug]/crew.astro`) whose
 * inline script fetches `GET /api/v1/t/{slug}/ledger?token=…` and renders the
 * `crew` block the server attaches for PROMOTER-scope tokens only.
 *
 * The page has four mutually-exclusive outcome panels, and telling them apart is
 * the whole point of the spec that drives this object:
 *
 *   `#crew-view`    the payout — the token was a Promoter link
 *   `#wrong-scope`  "this link doesn't grant the crew view" — a live Door/Ledger
 *                   token, which the API answers 200-with-no-crew-block (a Door
 *                   token OUTRANKS Promoter on the ledger read, so it is not a
 *                   403); the page infers wrong-scope from the missing block
 *   `#link-invalid` "this link is no longer valid" — the API's 404, which every
 *                   dead-link reason collapses into
 *   `#gate`         no token supplied at all
 *
 * Conflating the middle two is a real bug this page has already had: a promoter
 * holding a perfectly good door link was told their link had expired and sent
 * back to the organizer for a replacement they did not need.
 *
 * Stable element ids are the contract for this surface; there are no RN testIDs.
 */

import { type Locator, type Page, expect } from '@playwright/test';

const RENDER_TIMEOUT_MS = 30_000;

export class KefiCrewPage {
  readonly page: Page;
  /** The payout view — visible only for a Promoter-scope token. */
  readonly crewView: Locator;
  /** "This link doesn't grant the crew view" — a live token, wrong page. */
  readonly wrongScopePanel: Locator;
  /** "This link is no longer valid" — the dead-link 404. */
  readonly linkInvalidPanel: Locator;
  /** The paste-your-link gate, shown when no token is in the URL. */
  readonly gate: Locator;
  readonly errorPanel: Locator;

  readonly promoterName: Locator;
  readonly role: Locator;
  /** The headline "you're expected to receive" figure. */
  readonly payoutAmount: Locator;
  readonly settledBadge: Locator;
  readonly broughtLine: Locator;
  readonly stats: Locator;
  readonly referralTable: Locator;
  readonly termsCard: Locator;
  readonly terms: Locator;
  /** The print / Save-as-PDF affordance. */
  readonly printButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.crewView = page.locator('#crew-view');
    this.wrongScopePanel = page.locator('#wrong-scope');
    this.linkInvalidPanel = page.locator('#link-invalid');
    this.gate = page.locator('#gate');
    this.errorPanel = page.locator('#error');

    this.promoterName = page.locator('#c-name');
    this.role = page.locator('#c-role');
    this.payoutAmount = page.locator('#c-amount');
    this.settledBadge = page.locator('#c-settled');
    this.broughtLine = page.locator('#c-brought');
    this.stats = page.locator('#c-stats');
    this.referralTable = page.locator('#c-referrals');
    this.termsCard = page.locator('#c-terms-card');
    this.terms = page.locator('#c-terms');
    this.printButton = page.locator('#print-btn');
  }

  /** Open the crew page with a token. Does NOT assert which panel wins. */
  async gotoWithToken(siteUrl: string, token: string): Promise<void> {
    await this.page.goto(`${siteUrl}/crew?token=${encodeURIComponent(token)}`);
  }

  /** Open with a Promoter token and wait for the payout to render. */
  async openPayout(siteUrl: string, token: string): Promise<void> {
    await this.gotoWithToken(siteUrl, token);
    await expect(
      this.crewView,
      'the payout renders for a valid Promoter-scope token',
    ).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
  }

  /** One headline stat tile by its label ("Expected payout", "Paid referrals"). */
  statTile(label: string): Locator {
    return this.stats.locator('.stat').filter({
      has: this.page.locator('.stat-label', { hasText: label }),
    });
  }

  /** One referral row, addressed by the (suite-generated, unique) surname. */
  referralRowByText(text: string): Locator {
    return this.referralTable.locator('tbody tr').filter({ hasText: text });
  }
}
