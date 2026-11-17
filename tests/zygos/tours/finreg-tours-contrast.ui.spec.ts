import fs from 'fs';

import { expect, test } from '@playwright/test';

import { enterConsoleAs, merchantAccount, resolveDemoAccounts, sessionFor } from '../zygos-master.js';

import type { Page } from '@playwright/test';

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

function channels(color: string): number[] {
  const parts = color.match(/[\d.]+/g) ?? [];
  return parts.slice(0, 3).map(Number);
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((value) => {
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
    const shell = document.querySelector('[data-testid="zygos-app-shell"]') ?? document.body;
    return {
      textColor: getComputedStyle(text).color,
      captionBg: getComputedStyle(caption).backgroundColor,
      ringColor: getComputedStyle(ring).borderTopColor,
      pageBg: getComputedStyle(shell).backgroundColor,
      fontFamily: getComputedStyle(caption).fontFamily,
      overflow: caption.scrollWidth > caption.clientWidth + 1 || text.scrollWidth > text.clientWidth + 1,
    };
  });
}

test.describe('TOUR-1 caption and ring contrast', () => {
  for (const scheme of SCHEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${scheme} at ${viewport.width}x${viewport.height}, caption text and ring pass contrast and fit`, async ({ page }) => {
        const session = await sessionFor(merchantAccount(await resolveDemoAccounts()));
        expect(session).not.toBeNull();
        await page.setViewportSize(viewport);
        await page.addInitScript((mode: string) => {
          localStorage.setItem('DARK_MODE_PREFERENCE', mode);
          sessionStorage.setItem('__tour-state', JSON.stringify({ tourId: 'page-help-on-every-screen', step: 0, mode: 'guide' }));
        }, scheme);

        await enterConsoleAs(page, session!, '/instructions');
        await expect(page.locator('[data-testid="tour-ring"]')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(RING_SETTLE_MS);
        const result = await measure(page);

        const textRatio = contrast(result.textColor, result.captionBg);
        const ringRatio = contrast(result.ringColor, result.pageBg);
        fs.mkdirSync('test-results/tour-contrast', { recursive: true });
        await page.screenshot({ path: `test-results/tour-contrast/${scheme}-${viewport.width}.png` });
        fs.writeFileSync(`test-results/tour-contrast/${scheme}-${viewport.width}.json`, JSON.stringify({ ...result, textRatio, ringRatio }, null, 2));
        expect(textRatio).toBeGreaterThanOrEqual(TEXT_MIN);
        expect(ringRatio).toBeGreaterThanOrEqual(RING_MIN);
        expect(result.overflow).toBe(false);
      });
    }
  }
});
