/**
 * Kefi PRINT / SAVE-AS-PDF affordance E2E — the door list, the ledger and the
 * crew payout must all be printable, on all three pages, in the same way.
 *
 * This is a deliberately SHALLOW spec, and that is the point. Generating a real
 * PDF and diffing it would be slow, flaky and would mostly test Chromium; what
 * actually regresses here is someone editing one of the three near-identical
 * Astro pages and dropping the print stylesheet or the button from that one page
 * while the other two keep working. Three pages that must stay in step is
 * exactly the shape of bug a cheap presence check catches and a human never does
 * — nobody prints the door list until the night they need it on paper.
 *
 * So the assertions are: the `@media print` block is in the served stylesheet,
 * the print control is in the document, and the screen-hidden print header
 * exists to title the printout. Anything deeper belongs to `print-view.ts`'s
 * unit tests, which own the header-line and document-title formatting.
 *
 * `@ui`, but token-free: all three checks are on markup baked into the static
 * page at publish time, so no access link is minted and nothing is created —
 * making this the only Kefi event-ops spec with no teardown to get wrong.
 */

import { test, expect, type Page } from '@playwright/test';

import {
  getKefiFixtureTenant,
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

/** The three token-gated operational pages, all of which are printed in anger. */
const PRINTABLE_PAGES = ['door', 'ledger', 'crew'] as const;

/**
 * Read every stylesheet the document carries as one string.
 *
 * These pages inline all their CSS (an external `/_astro/*.css` 404s under the
 * per-tenant nginx root), so `<style>` text IS the stylesheet — no network
 * fetch, and no CSSOM walk that would need same-origin sheets.
 */
async function inlineStyles(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n'),
  );
}

test.describe('Kefi print / Save-as-PDF affordance', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  for (const pageName of PRINTABLE_PAGES) {
    test(`@ui the ${pageName} page ships a print stylesheet and a print control`, async ({
      page,
    }) => {
      const tenant = getKefiFixtureTenant();
      await page.goto(`${tenant.siteUrl}/${pageName}/`);

      const css = await inlineStyles(page);
      expect(
        css,
        `the ${pageName} page carries an @media print block — without it a printout is the ` +
          'dark screen theme, which is unreadable on paper and empties a toner cartridge',
      ).toContain('@media print');
      expect(
        css,
        `the ${pageName} print stylesheet drops the page to a white background`,
      ).toMatch(/@media print[\s\S]*background:\s*#fff/);

      await expect(
        page.locator('#print-btn'),
        `the ${pageName} page has exactly one print / Save-as-PDF control`,
      ).toHaveCount(1);

      await expect(
        page.locator('.print-header'),
        `the ${pageName} page has a screen-hidden print header to title the printout`,
      ).toHaveCount(1);
      await expect(
        page.locator('.print-header'),
        'which is hidden on screen — it exists for the printed page only',
      ).toBeHidden();
    });
  }
});
