import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { DESKTOP, PHONE } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const VISIBLE_TEXT = 'body *:not(.skip):not(.dlz-consent__sr):not([id^="a11y-hint-"])';
const VIEWPORTS = [
  { label: '360x640', use: PHONE },
  { label: '1280x800', use: DESKTOP },
];
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const HTTP_NO_CONTENT = 204;
const TAP_RETRY_MS = 2_000;
const SCREEN_TIMEOUT_MS = 20_000;
const LISTING_PATH = '/bff/api/jinx/api/v1/patterns';

test.use({ serviceWorkers: 'block' });

function shown(page: Page, testId: string): Locator {
  return page.getByTestId(testId).locator('visible=true').first();
}

function watchDocumentLoads(page: Page): string[] {
  const loads: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads.push(request.url());
  });
  return loads;
}

async function enterApp(page: Page): Promise<string[]> {
  await page.route(`${APP_URL}/**`, async (route) => {
    if (READ_METHODS.includes(route.request().method())) await route.continue();
    else await route.fulfill({ status: HTTP_NO_CONTENT });
  });
  await page.goto(`${APP_URL}/make`);
  await expect(shown(page, 'jinx-nav-patterns')).toBeVisible();
  return watchDocumentLoads(page);
}

async function tapPatterns(page: Page): Promise<void> {
  await expect(async () => {
    await shown(page, 'jinx-nav-patterns').click();
    await expect(shown(page, 'jinx-browse-screen')).toBeVisible({ timeout: TAP_RETRY_MS });
  }).toPass({ timeout: SCREEN_TIMEOUT_MS });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-ONE-9 In the app at ${viewport.label}, tap Patterns, Browse opens with no document load and its text fits`, async ({ page }) => {
      const loads = await enterApp(page);

      await tapPatterns(page);

      await expect(shown(page, 'pattern-card')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
      await expect(page).toHaveURL(`${APP_URL}/browse`);
      expect(loads).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });

    test(`AC-ONE-9 On in-app Browse at ${viewport.label}, tap a card, the pattern opens with no document load and its text fits`, async ({ page }) => {
      const loads = await enterApp(page);
      await tapPatterns(page);
      await expect(shown(page, 'card-thumb')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });

      await shown(page, 'card-thumb').click();

      await expect(shown(page, 'jinx-pattern-screen')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
      await expect(shown(page, 'pattern-chart')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
      await expect(page).toHaveURL(new RegExp(`^${APP_URL}/patterns/[a-z0-9-]+$`));
      expect(loads).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });
  });
}

test.describe('360x640 filters', () => {
  test.use(PHONE);

  test('AC-ONE-9 In the in-app filter sheet, pick a stitch then a piece, both apply with no document load', async ({ page }) => {
    const stitch = 'peyote';
    const piece = 'bracelet';
    const loads = await enterApp(page);
    await tapPatterns(page);
    await shown(page, 'browse-filters-open').click();
    await shown(page, `browse-stitch-${stitch}`).click();
    const combined = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === LISTING_PATH && url.searchParams.get('stitch') === 'Peyote' && url.searchParams.get('piece') === 'Bracelet';
    });

    await shown(page, `browse-piece-${piece}`).click();

    expect((await combined).ok()).toBe(true);
    await expect(page).toHaveURL(`${APP_URL}/browse?stitch=${stitch}&piece=${piece}`);
    expect(loads).toEqual([]);
  });
});
