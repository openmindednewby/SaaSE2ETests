/**
 * Page Object for the token-gated LEDGER / P&L page served at
 * `https://{slug}.kefi.dloizides.com/ledger?token=…`.
 *
 * A STATIC Astro page (`kefi-landings/src/pages/t/[slug]/ledger.astro`) whose
 * inline script fetches `GET /api/v1/t/{slug}/ledger?token=…` and renders the
 * headline P&L from the server's `pnl` block. (It has a client-side fallback that
 * recomputes totals from the attendee array, but that path runs ONLY when `pnl`
 * is null — i.e. Door / Promoter scope — so a Ledger-scope assertion here is
 * genuinely asserting the SERVER's numbers.)
 *
 * Stable element ids are the contract for this surface; there are no RN testIDs.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class KefiLedgerPage {
  readonly page: Page;
  readonly ledgerView: Locator;
  readonly errorPanel: Locator;
  readonly title: Locator;
  readonly eventLine: Locator;
  /** The P&L rows block: gross, payouts, net. */
  readonly pnlBlock: Locator;
  /** The headline stat tiles (Gross / Promoter payouts / Net profit / Attendees). */
  readonly stats: Locator;
  readonly attendeeTable: Locator;
  readonly search: Locator;

  constructor(page: Page) {
    this.page = page;
    this.ledgerView = page.locator('#ledger-view');
    this.errorPanel = page.locator('#error');
    this.title = page.locator('#l-title');
    this.eventLine = page.locator('#l-event');
    this.pnlBlock = page.locator('#l-pl');
    this.stats = page.locator('#l-stats');
    this.attendeeTable = page.locator('#l-attendees');
    this.search = page.locator('#l-search');
  }

  /** Open the ledger page with a token and wait for the view to render. */
  async gotoWithToken(siteUrl: string, token: string): Promise<void> {
    await this.page.goto(`${siteUrl}/ledger?token=${encodeURIComponent(token)}`);
    await expect(this.ledgerView, 'the ledger renders for a valid Ledger token').toBeVisible({
      timeout: 30_000,
    });
  }

  /** One named P&L line ("Gross ticket revenue (paid)", "Net profit", …). */
  pnlRow(label: string): Locator {
    return this.pnlBlock.locator('.pl-row', { hasText: label });
  }

  /** The amount cell of a named P&L line. */
  pnlAmount(label: string): Locator {
    return this.pnlRow(label).locator('.amount');
  }

  /** One headline stat tile by its label ("Gross", "Net profit", "Attendees"). */
  statTile(label: string): Locator {
    return this.stats.locator('.stat').filter({
      has: this.page.locator('.stat-label', { hasText: label }),
    });
  }

  /**
   * The attendee row matching some text.
   *
   * The ledger table renders `<tr data-search="…">` and carries NO external id —
   * unlike the door page, whose rows need `data-id` for the check-in writeback.
   * So a row is addressed by its (suite-generated, unique) surname, which is what
   * the page's own search box matches on too.
   */
  attendeeRowByText(text: string): Locator {
    return this.attendeeTable.locator('tbody tr').filter({ hasText: text });
  }
}
