import { expect, test } from '@playwright/test';

import { openNewTracker, pressNextRowTo } from './helpers/tracker';

test('AC-16 Pattern saved, then browser offline, Reload tracker, Tracker works, progress persists, offline status shown', async ({ page, context }) => {
  await openNewTracker(page);
  await pressNextRowTo(page, 4);
  await page.waitForFunction(async () => {
    const cached = await caches.match(location.href);
    return cached !== undefined && navigator.serviceWorker.controller !== null;
  });
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByTestId('jinx-tracker-screen')).toBeVisible();
  await expect(page.getByTestId('jinx-tracker-row')).toHaveText('Row 4');
  await expect(page.getByTestId('jinx-tracker-offline')).toBeVisible();

  await page.getByTestId('jinx-tracker-next-row').click();
  await expect(page.getByTestId('jinx-tracker-row')).toHaveText('Row 5');
  await expect(page.getByTestId('jinx-tracker-offline')).toHaveText('Offline, 1 row to sync');

  await page.reload();
  await expect(page.getByTestId('jinx-tracker-row')).toHaveText('Row 5');
});
