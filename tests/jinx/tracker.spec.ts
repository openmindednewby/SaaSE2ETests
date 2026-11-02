import { expect, test } from '@playwright/test';

import { openNewTracker, pressNextRowTo } from './helpers/tracker';

const AD_HOSTS = /googlesyndication|doubleclick|adservice|adsbygoogle/;
const BEADS_IN_LATER_PEYOTE_ROW_OF_WIDTH_12 = 6;

function beadCountOf(runsText: string): number {
  return runsText
    .split(/\s+/)
    .filter((part) => /^\d+$/.test(part))
    .reduce((sum, part) => sum + Number(part), 0);
}

test('AC-13 Tracker at row 3, Press next row, Row 4, word chart shows row 4; undo returns to 3', async ({ page }) => {
  await openNewTracker(page);
  await pressNextRowTo(page, 3);
  const runsOfRow3 = await page.getByTestId('jinx-tracker-runs').innerText();

  await page.getByTestId('jinx-tracker-next-row').click();

  await expect(page.getByTestId('jinx-tracker-row')).toHaveText('Row 4');
  const runsOfRow4 = await page.getByTestId('jinx-tracker-runs').innerText();
  expect(beadCountOf(runsOfRow4)).toBe(BEADS_IN_LATER_PEYOTE_ROW_OF_WIDTH_12);

  await page.getByTestId('jinx-tracker-undo').click();

  await expect(page.getByTestId('jinx-tracker-row')).toHaveText('Row 3');
  expect(await page.getByTestId('jinx-tracker-runs').innerText()).toBe(runsOfRow3);
});

test('AC-17 Tracker route, any consent, Load, No ad slot in DOM, no ad network request', async ({ page }) => {
  const adRequests: string[] = [];
  page.on('request', (request) => {
    if (AD_HOSTS.test(request.url())) adRequests.push(request.url());
  });

  await openNewTracker(page);
  await page.reload();
  await expect(page.getByTestId('jinx-tracker-screen')).toBeVisible();

  await expect(page.locator('[data-ad-slot], ins.adsbygoogle, [data-testid*="ad-slot"]')).toHaveCount(0);
  expect(adRequests).toEqual([]);
});
