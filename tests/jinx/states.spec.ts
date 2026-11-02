import { expect, test } from '@playwright/test';

import { CONSENT_BANNER, CONSENT_REJECT, NO_MATCH_QUERY, openTrackerLoadFailed, openTrackerOffline, rejectConsent, UNKNOWN_PATTERN } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const SUFFIX = 'Force each, Matches first-option frames in docs/design/states/frames, owner review pending';

test(`AC-50 Empty state on browse, ${SUFFIX}`, async ({ page }) => {
  const response = await page.goto(`/browse?q=${NO_MATCH_QUERY}`);

  const clear = page.getByTestId('clear-filters');

  expect(response?.status()).toBe(200);
  await expect(clear).toBeVisible();
  await expect(clear).toHaveAttribute('href', '/browse');
  await expect(page.getByTestId('pattern-card')).toHaveCount(0);
  await expect(page.getByTestId('ad-slot')).toHaveCount(0);
});

test(`AC-50 Error state on tracker with unknown pattern ${UNKNOWN_PATTERN}, ${SUFFIX}`, async ({ page }) => {
  await openTrackerLoadFailed(page);

  const panel = page.getByTestId('jinx-message-panel');

  await expect(panel).toBeVisible();
  await expect(page.getByTestId('jinx-tracker-screen')).toHaveCount(0);
  await expect(page.locator('[data-ad-slot], ins.adsbygoogle, [data-testid*="ad-slot"]')).toHaveCount(0);
});

test(`AC-50 Error state on the site for a missing page, ${SUFFIX}`, async ({ page }) => {
  const response = await page.goto('/no-such-page');

  const state = page.getByTestId('state-screen');

  expect(response?.status()).toBe(404);
  await expect(state).toBeVisible();
  await expect(page.getByTestId('ad-slot')).toHaveCount(0);
});

test(`AC-50 Tracker with no pattern named, ${SUFFIX}`, async ({ page }) => {
  await page.goto(`${APP_URL}/tracker`);

  const action = page.getByTestId('jinx-message-action');

  await expect(action).toBeVisible();
});

test(`AC-50 Offline state on tracker, ${SUFFIX}`, async ({ page }) => {
  await openTrackerOffline(page);

  const notice = page.getByTestId('jinx-tracker-offline');

  await expect(notice).toBeVisible();
  await expect(page.getByTestId('jinx-tracker-next-row')).toBeEnabled();
});

test(`AC-50 Consent state on first visit, ${SUFFIX}`, async ({ page }) => {
  await page.goto('/browse');

  const banner = page.getByTestId(CONSENT_BANNER);

  await expect(banner).toBeVisible();
  await expect(page.getByTestId(CONSENT_REJECT)).toBeVisible();
  await expect(page.getByTestId('cookie-consent-accept-all')).toBeVisible();
  await rejectConsent(page);
  // Reload proves the state survives a fresh page load.
  await page.reload();
  await expect(banner).toBeHidden();
});
