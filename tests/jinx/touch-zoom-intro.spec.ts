import { expectTextFits } from '@dloizides/game-e2e';
import { devices, expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { DESKTOP, rejectConsent } from './helpers/screens';

const PIXEL = devices['Pixel 5'];
const TOUCH_PHONE = {
  userAgent: PIXEL.userAgent,
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: PIXEL.deviceScaleFactor,
  isMobile: PIXEL.isMobile,
  hasTouch: PIXEL.hasTouch,
};
const VIEWPORTS = [
  { label: '360x640', use: TOUCH_PHONE },
  { label: '1280x800', use: DESKTOP },
];
const VISIBLE_TEXT = 'body *:not(.skip):not(.dlz-consent__sr):not([id^="a11y-hint-"])';
const MIN_HIT = 44;
const BUTTON_ZOOM = 4;
const INTRO_LIMIT_MS = 1200;
const REPLAY_MS = 90_000;
const GESTURE_STEPS = 8;
const STEP_MS = 16;
const SCROLL_SETTLE_MS = 400;
const NAV_CONTROLS = 4;
const CORNER_INSET = 6;

interface Finger {
  x: number;
  y: number;
}

interface ChartScroll {
  left: number;
  top: number;
  pageY: number;
  clientHeight: number;
  maxTop: number;
}

async function pagedPatternSlug(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/browse')).text();
  const slugs = [...new Set([...html.matchAll(/href="\/patterns\/([a-z0-9-]+)"/g)].map((match) => match[1]))];
  for (const slug of slugs) {
    if ((await (await request.get(`/patterns/${slug}`)).text()).includes('data-chart-next')) return slug;
  }
  throw new Error(`none of the ${slugs.length} patterns on /browse has paged rows`);
}

async function openChart(page: Page): Promise<void> {
  await page.goto(`/patterns/${await pagedPatternSlug(page.request)}`);
  await rejectConsent(page);
}

async function gesture(page: Page, from: Finger[], to: Finger[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (step: number): Finger[] => from.map((finger, i) => ({
    x: finger.x + ((to[i].x - finger.x) * step) / GESTURE_STEPS,
    y: finger.y + ((to[i].y - finger.y) * step) / GESTURE_STEPS,
  }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let step = 1; step <= GESTURE_STEPS; step += 1) {
    await page.waitForTimeout(STEP_MS);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function chartCentre(page: Page): Promise<Finger> {
  const box = await page.locator('[data-chart-window]').boundingBox();
  if (box === null) throw new Error('chart window has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const chartWidth = (page: Page): Promise<number> => page.locator('[data-chart-window] svg').evaluate((el) => el.getBoundingClientRect().width);

const readScroll = (page: Page): Promise<ChartScroll> => page.locator('[data-chart-window]').evaluate((el) => ({
  left: el.scrollLeft,
  top: el.scrollTop,
  pageY: window.scrollY,
  clientHeight: el.clientHeight,
  maxTop: el.scrollHeight - el.clientHeight,
}));

const logoAnimationEnds = (page: Page): Promise<number[]> => page.locator('.top .logo').evaluate((el) => el.getAnimations({ subtree: true }).map((animation) => Number(animation.effect?.getComputedTiming().endTime ?? 0)));

const visibleBeadCentres = (page: Page): Promise<Finger[]> => page.locator('[data-chart-window]').evaluate((chart) => {
  const frame = chart.getBoundingClientRect();
  return [...chart.querySelectorAll('svg rect')]
    .map((bead) => bead.getBoundingClientRect())
    .map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }))
    .filter(({ x, y }) => x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom);
});

test.describe('D-BEAD-48 phone chart on touch', () => {
  test.use(TOUCH_PHONE);

  test('AC-UI-chart-mobile Pinch, Spread two fingers on the chart, the chart grows and the page does not zoom', async ({ page }) => {
    await openChart(page);
    const before = await chartWidth(page);
    const { x, y } = await chartCentre(page);

    await gesture(page, [{ x: x - 20, y }, { x: x + 20, y }], [{ x: x - 60, y }, { x: x + 60, y }]);

    expect(await chartWidth(page)).toBeGreaterThan(before * 2);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('AC-UI-chart-mobile Pinch, Bring two fingers together on a zoomed chart, the chart shrinks back', async ({ page }) => {
    await openChart(page);
    const before = await chartWidth(page);
    await page.getByTestId('chart-zoom').tap();
    const { x, y } = await chartCentre(page);

    await gesture(page, [{ x: x - 100, y }, { x: x + 100, y }], [{ x: x - 25, y }, { x: x + 25, y }]);

    expect(await chartWidth(page)).toBeCloseTo(before, 0);
  });

  test('AC-UI-chart-mobile Button, Tap Zoom in then Close zoom, the same zoom without a pinch and the chart returns', async ({ page }) => {
    await openChart(page);
    const before = await chartWidth(page);
    const button = page.getByTestId('chart-zoom');
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(MIN_HIT);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_HIT);

    await button.tap();

    expect(await chartWidth(page)).toBeCloseTo(before * BUTTON_ZOOM, 0);
    await expect(button).toHaveAttribute('aria-label', /Close/);
    await expect(page.getByTestId('chart-zoom-pane')).toBeHidden();
    await button.tap();
    expect(await chartWidth(page)).toBeCloseTo(before, 0);
    await expect(button).toHaveAttribute('aria-label', /Zoom in/);
  });

  test('AC-UI-chart-mobile Drag, One finger on a zoomed chart, the chart pans and the page stays', async ({ page }) => {
    await openChart(page);
    await page.getByTestId('chart-zoom').tap();
    const before = await readScroll(page);
    const { x, y } = await chartCentre(page);

    await gesture(page, [{ x: x + 60, y: y + 60 }], [{ x: x - 60, y: y - 60 }]);
    await page.waitForTimeout(SCROLL_SETTLE_MS);

    const after = await readScroll(page);
    expect(after.left).toBeGreaterThan(before.left);
    expect(after.top).toBeGreaterThan(before.top);
    expect(after.pageY).toBe(before.pageY);
  });

  test('AC-UI-chart-mobile Next rows, Tap Next on a zoomed chart, moves one whole zoomed page', async ({ page }) => {
    await openChart(page);
    await page.getByTestId('chart-zoom').tap();
    await page.locator('[data-chart-window]').evaluate((el) => { el.scrollTop = 0; });

    await page.getByTestId('chart-next').tap();

    const { top, clientHeight, maxTop } = await readScroll(page);
    expect(top).toBeCloseTo(Math.min(clientHeight * BUTTON_ZOOM, maxTop), 0);
    await expect(page.getByTestId('chart-previous')).toBeEnabled();
  });

  test('AC-UI-chart-mobile Keep, Without zoom, one finger scrolls the page and Next moves the rows', async ({ page }) => {
    await openChart(page);
    const label = page.getByTestId('chart-window-label');
    const first = await label.textContent();

    await page.getByTestId('chart-next').tap();

    await expect(label).not.toHaveText(first ?? '');
    const box = await label.boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await gesture(page, [{ x, y }], [{ x, y: y - 240 }]);
    await page.waitForTimeout(SCROLL_SETTLE_MS);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('D-BEAD-55 Nav row, Open a paged chart, no visible bead centre sits under the zoom button', async ({ page }) => {
    await openChart(page);

    const box = await page.getByTestId('chart-zoom').boundingBox();
    const centres = await visibleBeadCentres(page);

    expect(centres.length).toBeGreaterThan(0);
    if (box === null) throw new Error('zoom button has no box');
    expect(centres.filter(({ x, y }) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height)).toEqual([]);
  });

  test('D-BEAD-55 Nav row, Zoom in, the row holds its four controls side by side inside the screen', async ({ page }) => {
    await openChart(page);

    await page.getByTestId('chart-zoom').tap();

    const boxes = await page.locator('.chart-nav > *').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON() as { left: number; right: number }));
    expect(boxes).toHaveLength(NAV_CONTROLS);
    boxes.slice(1).forEach((box, i) => expect(box.left).toBeGreaterThanOrEqual(boxes[i].right));
    expect(boxes[NAV_CONTROLS - 1].right).toBeLessThanOrEqual(TOUCH_PHONE.viewport.width);
    await expectTextFits(page, '.chart-nav *');
  });

  test('TEXT-FIT-1 Zoomed chart at 360x640, Walk, expectTextFits passes with no sideways scroll', async ({ page }) => {
    await openChart(page);

    await page.getByTestId('chart-zoom').tap();

    await expectTextFits(page, VISIBLE_TEXT);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('D-BEAD-48 computer chart stays on hover', () => {
  test.use(DESKTOP);

  test('AC-UI-chart-desktop Hover, Hover the chart, the pane opens and the chart keeps its size', async ({ page }) => {
    await openChart(page);
    const before = await chartWidth(page);

    await page.locator('[data-chart-window] svg').hover();

    await expect(page.getByTestId('chart-zoom-pane')).toBeVisible();
    expect(await chartWidth(page)).toBeCloseTo(before, 0);
  });

  test('D-BEAD-55 Computer, Open a paged chart, the zoom button stays in the chart corner and the nav row stays hidden', async ({ page }) => {
    await openChart(page);

    const plate = await page.getByTestId('pattern-chart').boundingBox();
    const box = await page.getByTestId('chart-zoom').boundingBox();

    if (plate === null || box === null) throw new Error('plate or zoom button has no box');
    expect(box.y - plate.y).toBeCloseTo(CORNER_INSET, 0);
    expect(plate.x + plate.width - (box.x + box.width)).toBeCloseTo(CORNER_INSET, 0);
    await expect(page.getByTestId('chart-next')).toBeHidden();
  });

  test('TEXT-FIT-1 Pinned zoom at 1280x800, Walk, expectTextFits passes and the chart keeps its size', async ({ page }) => {
    await openChart(page);
    const before = await chartWidth(page);

    await page.getByTestId('chart-zoom').click();

    await expect(page.getByTestId('chart-zoom-pane')).toBeVisible();
    await expectTextFits(page, VISIBLE_TEXT);
    expect(await chartWidth(page)).toBeCloseTo(before, 0);
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`D-BEAD-51 /browse logo at ${viewport.label}`, () => {
    test.use(viewport.use);

    test('AC-40 Browse load, Open /browse, the intro plays and ends within 1.2 s', async ({ page }) => {
      await page.goto('/browse');

      const ends = await logoAnimationEnds(page);

      expect(ends.length).toBeGreaterThan(0);
      expect(Math.max(...ends)).toBeLessThanOrEqual(INTRO_LIMIT_MS);
    });

    test('AC-40 Browse replay, 90 seconds pass, the logo plays again', async ({ page }) => {
      await page.clock.install();
      await page.goto('/browse');
      await page.locator('.top .logo').evaluate((el) => {
        const log: string[] = [];
        (window as unknown as { logoClassLog: string[] }).logoClassLog = log;
        new MutationObserver((records) => records.forEach(() => log.push(el.className))).observe(el, { attributes: true, attributeFilter: ['class'] });
      });

      await page.clock.fastForward(REPLAY_MS);

      await expect.poll(() => page.evaluate(() => (window as unknown as { logoClassLog: string[] }).logoClassLog.length)).toBeGreaterThanOrEqual(2);
      await expect(page.locator('.top .logo')).toHaveClass(/intro/);
    });

    test('AC-40 Browse reduced motion, Open /browse, the logo plays nothing and has no intro class', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });

      await page.goto('/browse');

      await expect(page.locator('.top .logo')).not.toHaveClass(/intro/);
      expect(await logoAnimationEnds(page)).toEqual([]);
    });

    test('TEXT-FIT-1 Browse with the intro, Walk, expectTextFits passes', async ({ page }) => {
      await page.goto('/browse');
      await rejectConsent(page);

      await expectTextFits(page, VISIBLE_TEXT);
    });
  });
}
