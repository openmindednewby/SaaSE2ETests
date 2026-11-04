import { expect, test, type Page } from '@playwright/test';

import { APP_URL } from './helpers/tracker';

const CLASP_MS = 800;
const INTRO_WITH_COLOUR_MS = 1200;
const PRESS_MS = 200;
const SLIDE_MS = 400;
const SLIDE_TOLERANCE_MS = 150;

interface LogoRecord {
  readonly total: number;
  readonly colour: boolean;
}

async function recordLogoAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: Array<{ total: number; colour: boolean }> = [];
    Object.assign(window, { logoAnimations: log });
    const original = Element.prototype.animate;
    Element.prototype.animate = function animate(frames, options) {
      if (typeof options === 'object' && this.closest('[data-testid="jinx-logo"]') !== null) {
        log.push({ total: Number(options.delay ?? 0) + Number(options.duration ?? 0), colour: JSON.stringify(frames).includes('"color"') });
      }
      return original.call(this, frames, options);
    };
  });
}

async function logoEnd(page: Page): Promise<number> {
  const records = await page.evaluate(() => (window as unknown as { logoAnimations: LogoRecord[] }).logoAnimations);
  return Math.max(0, ...records.map((record) => record.total));
}

async function claspEnd(page: Page): Promise<number> {
  const records = await page.evaluate(() => (window as unknown as { logoAnimations: LogoRecord[] }).logoAnimations);
  return Math.max(0, ...records.filter((record) => !record.colour).map((record) => record.total));
}

async function recordSlide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: Array<{ at: number; x: number }> = [];
    Object.assign(window, { slideSamples: samples });
    const sample = (): void => {
      const element = document.querySelector('[data-testid="jinx-screen-slide"]');
      if (element !== null) {
        samples.push({ at: performance.now(), x: new DOMMatrix(getComputedStyle(element).transform).m41 });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function slideSamples(page: Page): Promise<Array<{ at: number; x: number }>> {
  return page.evaluate(() => (window as unknown as { slideSamples: Array<{ at: number; x: number }> }).slideSamples);
}

test('AC-40 App load, Logo plays, 800 ms clasp then colour to 1200 ms; press 200 ms; reduced motion = still', async ({ page }) => {
  await recordLogoAnimations(page);
  await page.goto(`${APP_URL}/make`);
  await expect(page.getByTestId('jinx-logo')).toBeVisible();
  await expect.poll(() => logoEnd(page)).toBe(INTRO_WITH_COLOUR_MS);
  expect(await claspEnd(page)).toBe(CLASP_MS);
  await page.evaluate(() => {
    (window as unknown as { logoAnimations: LogoRecord[] }).logoAnimations.length = 0;
  });

  await page.getByTestId('jinx-logo').click();

  await expect.poll(() => logoEnd(page)).toBe(PRESS_MS);
});

test('AC-40 with reduced motion, the logo plays nothing and shows its final frame', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await recordLogoAnimations(page);

  await page.goto(`${APP_URL}/make`);

  await expect(page.getByTestId('jinx-logo')).toBeVisible();
  await expect(page.locator('[data-testid="jinx-logo"] [data-motion-layer="word"]')).toHaveCSS('opacity', '1');
  expect(await logoEnd(page)).toBe(0);
  await context.close();
});

test('AC-43 Navigate, Screen slides, From the right, 400 ms; reduced motion none', async ({ page }) => {
  await page.goto(`${APP_URL}/make`);
  await expect(page.getByTestId('jinx-generator-screen')).toBeVisible();
  await recordSlide(page);

  await page.getByTestId('jinx-nav-saved').click();

  await expect(page.getByTestId('jinx-saved-screen')).toBeVisible();
  await page.waitForTimeout(SLIDE_MS + SLIDE_TOLERANCE_MS * 2);
  const samples = await slideSamples(page);
  const moving = samples.filter((sample) => sample.x > 0.5);
  expect(moving.length).toBeGreaterThan(0);
  expect(moving[0].x).toBeGreaterThan(moving[moving.length - 1].x);
  const elapsed = moving[moving.length - 1].at - moving[0].at;
  expect(elapsed).toBeLessThanOrEqual(SLIDE_MS + SLIDE_TOLERANCE_MS);
  expect(samples[samples.length - 1].x).toBe(0);
});

test('AC-43 with reduced motion, the next screen appears with no slide', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${APP_URL}/make`);
  await expect(page.getByTestId('jinx-generator-screen')).toBeVisible();
  await recordSlide(page);

  await page.getByTestId('jinx-nav-saved').click();

  await expect(page.getByTestId('jinx-saved-screen')).toBeVisible();
  await page.waitForTimeout(SLIDE_MS);
  const samples = await slideSamples(page);
  expect(samples.filter((sample) => sample.x > 0.5)).toEqual([]);
  await context.close();
});
