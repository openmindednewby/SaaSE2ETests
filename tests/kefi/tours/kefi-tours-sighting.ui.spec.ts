import fs from 'fs';

import { expect, test } from '@playwright/test';

import { getKefiUrls } from '../../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../../helpers/target.js';
import { NAV_TIMEOUT_MS, signInFixtureOrganizer } from './kefi-tour-session.js';

import type { BrowserContext } from '@playwright/test';
import type { StorageState } from './kefi-tour-session.js';

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
] as const;
const SCHEMES = [
  { scheme: 'light', suffix: '' },
  { scheme: 'dark', suffix: '-dark' },
] as const;
const MID_TOUR = { tourId: 'organizer-first-event', step: 1 } as const;
const RING_TIMEOUT_MS = 20_000;
const OUT_DIR = 'test-results/kefi-tour-sight';

async function openEvents(context: BrowserContext): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  await page.goto(`${getKefiUrls().webUrl}/organizer/events`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await expect(page.getByTestId('kefi-events-page'), 'organizer events page mounted').toBeVisible({ timeout: NAV_TIMEOUT_MS });
  return page;
}

test.describe('TOUR-3 kefi tours sighting captures', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    state = await signInFixtureOrganizer(browser);
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const { scheme, suffix } of SCHEMES) {
    for (const viewport of VIEWPORTS) {
      test(`AC6 ${scheme} picker opened from the header at ${viewport.width}x${viewport.height}, lists tour start buttons`, async ({ browser }) => {
        const context = await browser.newContext({ storageState: state, viewport, colorScheme: scheme, ignoreHTTPSErrors: true });
        const page = await openEvents(context);
        const button = page.getByTestId('take-tour');

        if (await button.isVisible()) await button.click();
        else await page.keyboard.press('F2');

        await expect(page.getByTestId('tour-picker'), 'tour picker open').toBeVisible({ timeout: RING_TIMEOUT_MS });
        await expect(page.locator('[data-testid^="tour-start-"]').first(), 'picker lists a tour').toBeVisible();
        await page.screenshot({ path: `${OUT_DIR}/picker-${viewport.width}x${viewport.height}${suffix}.png`, fullPage: true });
        await context.close();
      });

      test(`AC6 ${scheme} ${MID_TOUR.tourId} at step ${MID_TOUR.step + 1} at ${viewport.width}x${viewport.height}, shows caption and ring`, async ({ browser }) => {
        const context = await browser.newContext({ storageState: state, viewport, colorScheme: scheme, ignoreHTTPSErrors: true });
        await context.addInitScript((tour: typeof MID_TOUR) => {
          sessionStorage.setItem('__tour-state', JSON.stringify({ tourId: tour.tourId, step: tour.step, mode: 'guide' }));
        }, MID_TOUR);
        const page = await openEvents(context);

        const caption = page.getByTestId('tour-caption');

        await expect(caption, 'tour caption visible mid-tour').toBeVisible({ timeout: RING_TIMEOUT_MS });
        await expect(page.getByTestId('tour-ring'), 'tour ring visible mid-tour').toBeVisible({ timeout: RING_TIMEOUT_MS });
        await expect(caption, 'caption reports the mid-tour step').toHaveAttribute('data-tour-step', String(MID_TOUR.step + 1));
        await page.screenshot({ path: `${OUT_DIR}/caption-${viewport.width}x${viewport.height}${suffix}.png`, fullPage: true });
        await context.close();
      });
    }
  }
});
