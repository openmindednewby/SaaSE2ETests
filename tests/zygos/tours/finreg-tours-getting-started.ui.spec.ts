import { expect, test } from '@playwright/test';
import { playAllToursInAuto } from '@dloizides/ui-tour/playwright';

import { enterConsoleAs, merchantAccount, resolveDemoAccounts, sessionFor } from '../zygos-master.js';
import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'module-home-payments-crm-accounting', persona: 'merchant', route: '/modules', steps: 6 },
  { id: 'page-help-on-every-screen', persona: 'merchant', route: '/instructions', steps: 4 },
];

const UMAMI_SEND = 'https://analytics.dloizides.com/api/send';

interface UmamiPayload {
  readonly payload?: { readonly website?: string; readonly name?: string; readonly data?: Record<string, string> };
}

test.describe('TOUR-1 finreg tours: gettingStarted', () => {
  runTourCategory(TOURS);
});

test.describe('TOUR-3 finreg tour analytics', () => {
  test('AC7 starting a tour in Auto, sends a tour_start event to Umami', async ({ page }) => {
    const websiteId = 'e45da01b-d794-46a1-b0ec-bbe581370609';
    const tourId = 'page-help-on-every-screen';
    const sent: UmamiPayload[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(UMAMI_SEND)) sent.push(request.postDataJSON() as UmamiPayload);
    });
    const session = await sessionFor(merchantAccount(await resolveDemoAccounts()));
    expect(session, 'demo merchant account').not.toBeNull();
    await enterConsoleAs(page, session!, '/instructions');

    await playAllToursInAuto(page, { ids: [tourId] });

    const starts = sent.filter((body) => body.payload?.name === 'tour_start');
    expect(starts, `Umami tour_start requests among ${sent.length} sent`).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ website: websiteId, name: 'tour_start', data: expect.objectContaining({ tourId, mode: 'auto' }) }) }),
    ]);
  });
});
