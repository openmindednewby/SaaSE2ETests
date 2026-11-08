import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { livePatternSlug, NO_MATCH_QUERY, openRecolour, openSavedWithPattern, openTrackerLoadFailed } from './helpers/screens';
import { APP_URL, openNewTracker } from './helpers/tracker';

interface FocusRow {
  screen: string;
  open: (page: Page) => Promise<void>;
  control: (page: Page) => Locator;
}

const ROWS: FocusRow[] = [
  { screen: 'Browse', open: async (page) => { await page.goto('/browse'); }, control: (page) => page.getByTestId('browse-search-input') },
  { screen: 'Browse, no results', open: async (page) => { await page.goto(`/browse?q=${NO_MATCH_QUERY}`); }, control: (page) => page.getByTestId('clear-filters') },
  { screen: 'Pattern detail', open: async (page) => { await page.goto(`/patterns/${await livePatternSlug(page.request)}`); }, control: (page) => page.getByTestId('start-tracker') },
  { screen: 'Make a pattern', open: async (page) => { await page.goto(`${APP_URL}/make`); }, control: (page) => page.getByTestId('jinx-generator-generate') },
  { screen: 'Row tracker', open: openNewTracker, control: (page) => page.getByTestId('jinx-tracker-next-row') },
  { screen: 'Tracker, pattern failed to load', open: openTrackerLoadFailed, control: (page) => page.getByTestId('jinx-message-action') },
  { screen: 'Tracker, no pattern named', open: async (page) => { await page.goto(`${APP_URL}/tracker`); }, control: (page) => page.getByTestId('jinx-message-action') },
  { screen: 'Saved, with patterns', open: openSavedWithPattern, control: (page) => page.locator('[data-testid^="jinx-saved-open-"]').first() },
  { screen: 'Saved, empty', open: async (page) => { await page.goto(`${APP_URL}/saved`); }, control: (page) => page.getByTestId('jinx-message-action') },
  { screen: 'Recolour', open: openRecolour, control: (page) => page.getByTestId('jinx-recolour-save') },
  { screen: 'Sign-in, opened at /register', open: async (page) => { await page.goto(`${APP_URL}/register`); }, control: (page) => page.getByTestId('jinx-auth-otp-email') },
];

for (const row of ROWS) {
  test(`AC-53 ${row.screen}, Open, Focus on the control named in docs/design/focus-ledger.md, from screens.md`, async ({ page }) => {
    await row.open(page);

    const control = row.control(page);

    await expect(control).toBeFocused();
  });
}
