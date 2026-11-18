import fs from 'fs';

import { expect, test } from '@playwright/test';

import { getKefiUrls } from '../../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../../helpers/target.js';
import { NAV_TIMEOUT_MS, signInFixtureOrganizer } from './kefi-tour-session.js';

import type { Page } from '@playwright/test';
import type { StorageState } from './kefi-tour-session.js';

interface TextPair {
  readonly name: string;
  readonly color: string;
  readonly background: string;
}

interface Measure {
  readonly texts: readonly TextPair[];
  readonly ringColor: string;
  readonly behindRing: string;
  readonly pageBg: string;
  readonly scrim: string;
  readonly underScrim: string;
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
const DARK_PAGE_MAX_LUMINANCE = 0.2;
const RING_TIMEOUT_MS = 20_000;
const OUT_DIR = 'test-results/kefi-tour-contrast';

function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channels(color: string): number[] {
  const values = (color.match(/[\d.]+/g) ?? []).map(Number);
  const srgb = color.startsWith('color(');
  const rgb = values.slice(0, 3).map((value) => (srgb ? value * 255 : value));
  return [...rgb, values[3] ?? 1];
}

function seenThroughScrim(scrim: string, page: string): string {
  const [sr, sg, sb, alpha] = channels(scrim);
  const [pr, pg, pb] = channels(page);
  const mix = (top: number, under: number): number => Math.round(top * alpha + under * (1 - alpha));
  return `rgb(${mix(sr, pr)}, ${mix(sg, pg)}, ${mix(sb, pb)})`;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const opaque = (bg: string): boolean => bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg);
    const fillOf = (start: Element | null): string => {
      for (let node = start; node !== null; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (opaque(bg)) return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    const caption = document.querySelector('[data-testid="tour-caption"]') as HTMLElement;
    const text = document.querySelector('[data-testid="tour-text"]') as HTMLElement;
    const ring = document.querySelector('[data-testid="tour-ring"]') as HTMLElement;
    const hint = caption.querySelector('[data-testid="tour-back"]')?.parentElement?.querySelector('span') ?? null;
    const nodes: [string, Element | null][] = [
      ['step label', caption.firstElementChild],
      ['body', text],
      ['note', caption.querySelector('[data-testid="tour-note"]')],
      ['Back', caption.querySelector('[data-testid="tour-back"]')],
      ['Next', caption.querySelector('[data-testid="tour-next"], [data-testid="tour-skip"]')],
      ['End', caption.querySelector('[data-testid="tour-end"]')],
      ['hint', hint],
    ];
    const texts = nodes
      .filter((entry): entry is [string, Element] => entry[1] !== null && (entry[1].textContent ?? '').trim() !== '')
      .map(([name, node]) => ({ name, color: getComputedStyle(node).color, background: fillOf(node) }));
    const box = ring.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(ring).borderTopWidth) + 2;
    const under = document.elementsFromPoint(box.left + inset, box.top + box.height / 2).find((node) => node.closest('[data-tour-overlay], [data-testid="tour-caption"]') === null) ?? null;
    const caption2 = caption.getBoundingClientRect();
    const inside = (x: number, y: number, r: DOMRect): boolean => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const corners: [number, number][] = [[4, 4], [innerWidth - 4, 4], [4, innerHeight - 4], [innerWidth - 4, innerHeight - 4]];
    const [sx, sy] = corners.find(([x, y]) => !inside(x, y, box) && !inside(x, y, caption2)) ?? corners[0];
    const outside = document.elementsFromPoint(sx, sy).find((node) => node.closest('[data-tour-overlay], [data-testid="tour-caption"]') === null) ?? null;
    const scrim = getComputedStyle(ring).boxShadow.match(/(rgba?|color)\([^)]*\)/)?.[0] ?? 'transparent';
    const fits = (node: HTMLElement): boolean => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
    return {
      texts,
      ringColor: getComputedStyle(ring).borderTopColor,
      behindRing: fillOf(under),
      pageBg: fillOf(document.body),
      scrim,
      underScrim: fillOf(outside),
      fontFamily: getComputedStyle(caption).fontFamily,
      overflow: !fits(caption) || !fits(text),
    };
  });
}

async function waitForRingToSettle(page: Page): Promise<void> {
  const ring = page.locator('[data-testid="tour-ring"]');
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await ring.boundingBox());
    const settled = now === last;
    last = now;
    return settled;
  }, { message: 'tour ring stops moving', timeout: RING_TIMEOUT_MS, intervals: [400] }).toBe(true);
}

test.describe('TOUR-3 kefi caption and ring contrast', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    state = await signInFixtureOrganizer(browser);
  });

  for (const scheme of SCHEMES) {
    for (const viewport of VIEWPORTS) {
      test(`AC6 ${scheme} at ${viewport.width}x${viewport.height}, every caption text and the ring pass contrast and fit`, async ({ browser }) => {
        const context = await browser.newContext({ storageState: state, viewport, colorScheme: scheme, ignoreHTTPSErrors: true });
        await context.addInitScript((mode: string) => {
          localStorage.setItem('DARK_MODE_PREFERENCE', mode);
          sessionStorage.setItem('__tour-state', JSON.stringify({ tourId: 'organizer-first-event', step: 0, mode: 'guide' }));
        }, scheme);
        const page = await context.newPage();
        await page.goto(`${getKefiUrls().webUrl}/organizer/events`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await expect(page.locator('[data-testid="tour-ring"]')).toBeVisible({ timeout: RING_TIMEOUT_MS });
        await waitForRingToSettle(page);

        const result = await measure(page);

        const texts = result.texts.map((pair) => ({ ...pair, ratio: contrast(pair.color, pair.background) }));
        const dimmedPage = seenThroughScrim(result.scrim, result.underScrim);
        const ringRatio = contrast(result.ringColor, result.behindRing);
        fs.mkdirSync(OUT_DIR, { recursive: true });
        await page.screenshot({ path: `${OUT_DIR}/${scheme}-${viewport.width}.png` });
        fs.writeFileSync(`${OUT_DIR}/${scheme}-${viewport.width}.json`, JSON.stringify({ ...result, texts, ringRatio, dimmedPage, dimmedLuminance: luminance(dimmedPage) }, null, 2));
        await context.close();
        expect(texts.map((pair) => pair.name), 'caption shows step label, body and Back/Next/End').toEqual(expect.arrayContaining(['step label', 'body', 'Back', 'Next', 'End']));
        for (const pair of texts) {
          expect.soft(pair.ratio, `${pair.name} text ${pair.color} on ${pair.background}`).toBeGreaterThanOrEqual(TEXT_MIN);
        }
        expect.soft(ringRatio, `ring ${result.ringColor} against the page behind it ${result.behindRing}`).toBeGreaterThanOrEqual(RING_MIN);
        if (scheme === 'dark') {
          expect.soft(luminance(dimmedPage), `page under the scrim ${result.scrim} over ${result.underScrim} is ${dimmedPage}, dark`).toBeLessThan(DARK_PAGE_MAX_LUMINANCE);
          expect.soft(luminance(result.pageBg), `page background ${result.pageBg} follows the dark scheme`).toBeLessThanOrEqual(DARK_PAGE_MAX_LUMINANCE);
        }
        expect.soft(result.overflow, 'caption text fits its box').toBe(false);
      });
    }
  }
});
