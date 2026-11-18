import { expect, test } from '@playwright/test';
import { playAllToursInAuto } from '@dloizides/ui-tour/playwright';

import { getKefiUrls } from '../../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../../helpers/target.js';
import { NAV_TIMEOUT_MS, signInFixtureOrganizer } from './kefi-tour-session.js';

import type { StorageState } from './kefi-tour-session.js';

interface TourSighting {
  readonly steps: number;
  readonly ringed: number[];
}

const RUN_BUDGET_MS = 25 * 60_000;
const SAMPLE_MS = 100;

test.describe('TOUR-3 kefi tours', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    state = await signInFixtureOrganizer(browser);
  });

  test('AC6 every kefi tour in the picker, plays to the end in Auto with at most half its steps skipped', async ({ browser }) => {
    test.setTimeout(RUN_BUDGET_MS);
    const expectedIds = [
      'organizer-first-event', 'sign-in-methods', 'account-settings', 'attendee-roster', 'pending-payments',
      'registration-approvals', 'ledger-pnl', 'messaging-send', 'door-checkin', 'admit-scan',
      'passes-pricing', 'landing-builder', 'go-live', 'promoters-crew', 'attendee-register',
    ];
    const context = await browser.newContext({ storageState: state, ignoreHTTPSErrors: true });
    await context.addInitScript((sampleMs: number) => {
      window.setInterval(() => {
        const caption = document.querySelector('[data-testid="tour-caption"]');
        if (caption === null) return;
        const key = '__tour-sightings';
        const all = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, { steps: number; ringed: number[] }>;
        const id = caption.getAttribute('data-tour-id') ?? '';
        const entry = all[id] ?? { steps: Number(caption.getAttribute('data-tour-steps')), ringed: [] };
        const step = Number(caption.getAttribute('data-tour-step'));
        if (document.querySelector('[data-testid="tour-ring"]') !== null && !entry.ringed.includes(step)) entry.ringed.push(step);
        all[id] = entry;
        sessionStorage.setItem(key, JSON.stringify(all));
      }, sampleMs);
    }, SAMPLE_MS);
    const page = await context.newPage();
    await page.goto(`${getKefiUrls().webUrl}/organizer/events`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await expect(page.getByTestId('kefi-events-page'), 'organizer events page mounted before F2').toBeVisible({ timeout: NAV_TIMEOUT_MS });

    const runs = await playAllToursInAuto(page);

    const sightings = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__tour-sightings') ?? '{}') as Record<string, TourSighting>);
    const report = runs.map((run) => {
      const seen = sightings[run.tourId];
      const skipped = seen === undefined ? run.steps : run.steps - seen.ringed.length;
      return { tourId: run.tourId, passed: run.passed, steps: run.steps, skipped, message: run.message };
    });
    console.log(`[kefi-tours] ${JSON.stringify(report)}`);
    await context.close();
    expect(runs.map((run) => run.tourId).sort(), 'tour ids in the picker').toEqual([...expectedIds].sort());
    expect(report.filter((row) => !row.passed), 'tours that did not play to the end').toEqual([]);
    expect(report.filter((row) => row.skipped * 2 > row.steps), 'skip-heavy tours (more than half the steps skipped)').toEqual([]);
  });
});
