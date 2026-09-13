import { expect, test, type Page } from '@playwright/test';

import { interceptAnalytics, SPA_URL, TestIds } from '../../fixtures/nextgame-web';

const CLAIM_TIMEOUT_MS = 15_000;
const RELOAD_WINDOW_MS = 3_000;
/** The first-install guard in the @dloizides/pwa-sw generated register script. */
const FIRST_INSTALL_GUARD = 'if (!hadController) { hadController = true; return; }';

/**
 * Counts DOCUMENT loads of the main frame — deliberately not `framenavigated`. Expo Router
 * calls history.replaceState twice while hydrating, and Playwright reports each as a
 * same-document navigation; that miscount was first read as "the SW reloads the page twice".
 */
function countDocumentLoads(page: Page): { loads: number } {
  const counter = { loads: 0 };
  page.on('load', () => {
    counter.loads += 1;
  });
  return counter;
}

/** First visit to /age, then wait until the service worker has claimed the page. */
async function firstVisitUntilClaimed(page: Page): Promise<void> {
  await interceptAnalytics(page);
  await page.goto(`${SPA_URL}/age`);
  await expect(page.getByTestId(TestIds.AGE_SCREEN)).toBeVisible();
  // clients.claim() fires controllerchange here — the event a broken guard reloads on.
  await expect
    .poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: CLAIM_TIMEOUT_MS })
    .toBe(true);
}

test.describe('nextgame service worker on a first visit', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the SW takes control without reloading the page', async ({ page }) => {
    const counter = countDocumentLoads(page);
    await firstVisitUntilClaimed(page);
    const outcome = await page
      .waitForEvent('load', { timeout: RELOAD_WINDOW_MS })
      .then(() => 'reloaded', () => 'settled');
    expect(outcome, 'a load event fired after the SW claimed the page').toBe('settled');
    expect(counter.loads, 'document loads on a first visit').toBe(1);
  });

  test('negative control: without the first-install guard the counter sees the reload', async ({ context, page }) => {
    await context.route('**/sw-register.js', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source, 'served register script no longer carries the guard').toContain(FIRST_INSTALL_GUARD);
      await route.fulfill({ response, body: source.replace(FIRST_INSTALL_GUARD, '') });
    });
    const counter = countDocumentLoads(page);
    await firstVisitUntilClaimed(page);
    await expect.poll(() => counter.loads, { timeout: RELOAD_WINDOW_MS }).toBeGreaterThan(1);
  });
});
