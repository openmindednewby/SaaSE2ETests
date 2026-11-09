import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { DESKTOP, PHONE } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const RN_WEB_OPACITY_ZERO = '.r-orgf3d';
const VISIBLE_TEXT = `body *:not(.skip):not(.dlz-consent__sr):not([id^="a11y-hint-"]):not(${RN_WEB_OPACITY_ZERO})`;
const VIEWPORTS = [
  { label: '360x640', use: PHONE },
  { label: '1280x800', use: DESKTOP },
];
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const HTTP_NO_CONTENT = 204;
const TAP_RETRY_MS = 2_000;
const SCREEN_TIMEOUT_MS = 20_000;
const LISTING_PATH = '/bff/api/jinx/api/v1/patterns';
/** RN-web keeps the hint in a visually hidden node inside the button, so it is part of the button's text. */
const FILTERS_HINT = 'Opens the pattern filters';

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

async function pickStitchThenPieceAndClose(page: Page, stitch: string, piece: string): Promise<void> {
  await shown(page, 'browse-filters-open').click();
  await shown(page, `browse-stitch-${stitch}`).click();
  await expect(page).toHaveURL(`${APP_URL}/browse?stitch=${stitch}`);
  await shown(page, `browse-piece-${piece}`).click();
  await expect(page).toHaveURL(`${APP_URL}/browse?stitch=${stitch}&piece=${piece}`);
  await shown(page, 'browse-show-results').click();
  await expect(page.getByTestId('browse-filter-sheet').locator('visible=true')).toHaveCount(0);
}

async function innerScrollOverflow(panel: Locator): Promise<number> {
  return panel.evaluate((element) => {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node.scrollHeight - node.clientHeight;
    }
    throw new Error('The filter sheet has no scrolling body around its filters');
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-ONE-9 In the app at ${viewport.label}, tap Patterns, Browse opens with no document load and its text fits`, async ({ page }) => {
      const loads = await enterApp(page);

      await tapPatterns(page);

      await expect(shown(page, 'pattern-card')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
      await expect(page).toHaveURL(`${APP_URL}/browse`);
      await expect(shown(page, 'ad-slot')).toBeVisible();
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
      await expect(shown(page, 'ad-slot')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`^${APP_URL}/patterns/[a-z0-9-]+$`));
      expect(loads).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });
  });
}

test.describe('360x640 filter sheet and Back', () => {
  test.use(PHONE);

  test('AC-UI-2 With a stitch then a piece picked and the sheet closed, Back once, the piece goes and the stitch stays with no document load', async ({ page }) => {
    const stitch = 'peyote';
    const piece = 'bracelet';
    const oneFilterLabel = 'Filters (1)';
    const loads = await enterApp(page);
    await tapPatterns(page);
    await pickStitchThenPieceAndClose(page, stitch, piece);

    await page.goBack();

    await expect(page).toHaveURL(`${APP_URL}/browse?stitch=${stitch}`);
    await expect(shown(page, 'browse-filters-open')).toHaveText(`${oneFilterLabel}${FILTERS_HINT}`);
    await expect(page.getByTestId('browse-filter-sheet').locator('visible=true')).toHaveCount(0);
    expect(loads).toEqual([]);
  });

  test('AC-UI-2 With a stitch then a piece picked and the sheet closed, Back twice, both filters are gone with no document load', async ({ page }) => {
    const stitch = 'peyote';
    const piece = 'bracelet';
    const noFilterLabel = 'Filters';
    const loads = await enterApp(page);
    await tapPatterns(page);
    await pickStitchThenPieceAndClose(page, stitch, piece);

    await page.goBack();
    await page.goBack();

    await expect(page).toHaveURL(`${APP_URL}/browse`);
    await expect(shown(page, 'browse-filters-open')).toHaveText(`${noFilterLabel}${FILTERS_HINT}`);
    await expect(page.getByTestId('browse-filter-sheet').locator('visible=true')).toHaveCount(0);
    expect(loads).toEqual([]);
  });

  test('AC-UI-1 On in-app Browse at 360x640, open the filter sheet, Show patterns is in the viewport and the sheet body has no inner scroll', async ({ page }) => {
    const noOverflowPx = 0;
    await enterApp(page);
    await tapPatterns(page);

    await shown(page, 'browse-filters-open').click();

    const sheet = shown(page, 'browse-filter-sheet');
    await expect(sheet.getByTestId('browse-show-results')).toBeInViewport({ ratio: 1 });
    await expect(sheet.getByTestId('browse-colour-wall')).toBeInViewport({ ratio: 1 });
    await expect.poll(() => innerScrollOverflow(sheet.getByTestId('browse-filters')), { message: 'filter sheet body overflow in px' }).toBeLessThanOrEqual(noOverflowPx);
  });
});

test.describe('1280x800 tray keyboard', () => {
  test.use(DESKTOP);

  test('AC-UI-6 On in-app Browse at 1280x800 with the tray focused, ArrowRight twice, ArrowLeft, Enter, focus walks the tray and Enter picks White with no document load', async ({ page }) => {
    const firstPill = 'browse-tray-best';
    const walkedToPill = 'browse-tray-white';
    const loads = await enterApp(page);
    await tapPatterns(page);
    await expect(shown(page, 'pattern-card')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
    await shown(page, firstPill).focus();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');

    await expect(shown(page, walkedToPill)).toBeFocused();
    await expect(shown(page, walkedToPill)).toHaveAttribute('aria-pressed', 'true');
    await expect(shown(page, firstPill)).toHaveAttribute('aria-pressed', 'false');
    expect(loads).toEqual([]);
  });
});

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
