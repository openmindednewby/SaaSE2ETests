import fs from 'fs';

import { expect, test } from '@playwright/test';

import { getKefiUrls } from '../../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../../helpers/target.js';
import { NAV_TIMEOUT_MS, signInFixtureOrganizer } from './kefi-tour-session.js';

import type { Page } from '@playwright/test';
import type { StorageState } from './kefi-tour-session.js';

interface Measure {
  readonly textColor: string;
  readonly captionBg: string;
  readonly ringColor: string;
  readonly pageBg: string;
  readonly fontFamily: string;
  readonly overflow: boolean;
}

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const TEXT_MIN = 4.5;
const RING_MIN = 3;
const RING_SETTLE_MS = 800;
const RING_TIMEOUT_MS = 20_000;
const OUT_DIR = 'test-results/kefi-tour-contrast';

function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const caption = document.querySelector('[data-testid="tour-caption"]') as HTMLElement;
    const text = document.querySelector('[data-testid="tour-text"]') as HTMLElement;
    const ring = document.querySelector('[data-testid="tour-ring"]') as HTMLElement;
    const opaque = [document.body, document.documentElement].map((node) => getComputedStyle(node).backgroundColor).find((bg) => bg !== 'rgba(0, 0, 0, 0)');
    const fits = (node: HTMLElement): boolean => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
    return {
      textColor: getComputedStyle(text).color,
      captionBg: getComputedStyle(caption).backgroundColor,
      ringColor: getComputedStyle(ring).borderTopColor,
      pageBg: opaque ?? 'rgb(255, 255, 255)',
      fontFamily: getComputedStyle(caption).fontFamily,
      overflow: !fits(caption) || !fits(text),
    };
  });
}

test.describe('TOUR-3 kefi caption and ring contrast', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    state = await signInFixtureOrganizer(browser);
  });

  for (const scheme of SCHEMES) {
    for (const viewport of VIEWPORTS) {
      test(`AC6 ${scheme} at ${viewport.width}x${viewport.height}, caption text and ring pass contrast and fit`, async ({ browser }) => {
        const context = await browser.newContext({ storageState: state, viewport, colorScheme: scheme, ignoreHTTPSErrors: true });
        await context.addInitScript((mode: string) => {
          localStorage.setItem('DARK_MODE_PREFERENCE', mode);
          sessionStorage.setItem('__tour-state', JSON.stringify({ tourId: 'organizer-first-event', step: 0, mode: 'guide' }));
        }, scheme);
        const page = await context.newPage();
        await page.goto(`${getKefiUrls().webUrl}/organizer/events`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await expect(page.locator('[data-testid="tour-ring"]')).toBeVisible({ timeout: RING_TIMEOUT_MS });
        await page.waitForTimeout(RING_SETTLE_MS);

        const result = await measure(page);

        const textRatio = contrast(result.textColor, result.captionBg);
        const ringRatio = contrast(result.ringColor, result.pageBg);
        fs.mkdirSync(OUT_DIR, { recursive: true });
        await page.screenshot({ path: `${OUT_DIR}/${scheme}-${viewport.width}.png` });
        fs.writeFileSync(`${OUT_DIR}/${scheme}-${viewport.width}.json`, JSON.stringify({ ...result, textRatio, ringRatio }, null, 2));
        await context.close();
        expect(textRatio, 'caption text contrast').toBeGreaterThanOrEqual(TEXT_MIN);
        expect(ringRatio, 'ring contrast against the page').toBeGreaterThanOrEqual(RING_MIN);
        expect(result.overflow, 'caption text fits its box').toBe(false);
      });
    }
  }
});
