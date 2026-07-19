/**
 * Page Object for the token-gated DOOR check-in page served at
 * `https://{slug}.kefi.dloizides.com/door?token=…`.
 *
 * A STATIC Astro page (`kefi-landings/src/pages/t/[slug]/door.astro`) whose
 * inline script reads `?token=` from its own URL, fetches
 * `GET /api/v1/t/{slug}/ledger?token=…` and writes back through
 * `POST /api/v1/t/{slug}/checkin?token=…`. No RN `testID`s exist here; the page's
 * stable element ids and the per-row `data-id` attributes are the contract.
 *
 * Page states are mutually exclusive `hidden` panels: `#gate` (no token),
 * `#loading`, `#error` (token rejected), `#door-view` (success).
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class KefiDoorPage {
  readonly page: Page;
  readonly gate: Locator;
  readonly errorPanel: Locator;
  readonly errorMessage: Locator;
  readonly doorView: Locator;
  readonly search: Locator;
  /** The "checked / total" headline, e.g. `3 / 160`. */
  readonly checkedCount: Locator;

  constructor(page: Page) {
    this.page = page;
    this.gate = page.locator('#gate');
    this.errorPanel = page.locator('#error');
    this.errorMessage = page.locator('#error-msg');
    this.doorView = page.locator('#door-view');
    this.search = page.locator('#d-search');
    this.checkedCount = page.locator('#d-checked-value');
  }

  /** Open the door page with a token and wait for the list to render. */
  async gotoWithToken(siteUrl: string, token: string): Promise<void> {
    await this.page.goto(`${siteUrl}/door?token=${encodeURIComponent(token)}`);
    await expect(this.doorView, 'the door list renders for a valid Door token').toBeVisible({
      timeout: 30_000,
    });
  }

  /** The check-in checkbox for one attendee (rows carry `data-id="{externalId}"`). */
  checkInBox(attendeeExternalId: string): Locator {
    return this.page.locator(`input.checkin-cb[data-id="${attendeeExternalId}"]`);
  }

  /** The row container for one attendee. */
  row(attendeeExternalId: string): Locator {
    return this.page.locator(`.person[data-id="${attendeeExternalId}"]`);
  }

  /**
   * Narrow the list to one attendee via the page's own search box. With ~160
   * rows this is both faster and closer to what a real door person does than
   * scrolling, and it keeps the subsequent locators unambiguous.
   */
  async searchFor(term: string): Promise<void> {
    await this.search.fill(term);
  }

  /**
   * Tick an attendee in and wait for the check-in POST to resolve. Waiting on the
   * response (rather than a timeout) is what makes the persistence assertion that
   * follows deterministic — the write has provably reached the server.
   */
  async checkInAndAwaitWrite(slug: string, attendeeExternalId: string): Promise<number> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes(`/t/${slug}/checkin`) && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await this.checkInBox(attendeeExternalId).check();
    const response = await responsePromise;
    return response.status();
  }
}
