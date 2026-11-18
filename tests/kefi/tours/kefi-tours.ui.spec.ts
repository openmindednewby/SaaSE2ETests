import { expect, test } from '@playwright/test';
import { playAllToursInAuto } from '@dloizides/ui-tour/playwright';

import { getKefiUrls } from '../../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../../helpers/target.js';
import { NAV_TIMEOUT_MS, signInFixtureOrganizer } from './kefi-tour-session.js';

import type { StorageState } from './kefi-tour-session.js';

const RUN_BUDGET_MS = 25 * 60_000;
const MAX_SKIPPED_RATIO = 0.25;

test.describe('TOUR-3 kefi tours', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    state = await signInFixtureOrganizer(browser);
  });

  test('AC6 every kefi tour in the picker, plays to the end in Auto with at most a quarter of its steps skipped', async ({ browser }) => {
    test.setTimeout(RUN_BUDGET_MS);
    const expectedIds = [
      'organizer-first-event', 'sign-in-methods', 'account-settings', 'attendee-roster', 'pending-payments',
      'registration-approvals', 'ledger-pnl', 'messaging-send', 'door-checkin', 'admit-scan',
      'passes-pricing', 'landing-builder', 'go-live', 'promoters-crew', 'attendee-register',
    ];
    const context = await browser.newContext({ storageState: state, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`${getKefiUrls().webUrl}/organizer/events`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await expect(page.getByTestId('kefi-events-page'), 'organizer events page mounted before F2').toBeVisible({ timeout: NAV_TIMEOUT_MS });

    const runs = await playAllToursInAuto(page);

    const report = runs.map(({ tourId, passed, steps, skipped, message }) => ({ tourId, passed, steps, skipped, message }));
    console.log(`[kefi-tours] ${JSON.stringify(report)}`);
    await context.close();
    expect(runs.map((run) => run.tourId).sort(), 'tour ids in the picker').toEqual([...expectedIds].sort());
    expect(report.filter((row) => !row.passed), 'tours that did not play to the end').toEqual([]);
    expect(report.filter((row) => row.skipped > MAX_SKIPPED_RATIO * row.steps), 'skip-heavy tours (more than a quarter of the steps skipped)').toEqual([]);
  });
});
