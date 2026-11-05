import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { APP_URL, openNewTracker } from './tracker';

export const PHONE = { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
export const DESKTOP = { viewport: { width: 1280, height: 800 } };
export const GUIDE_SLUGS = ['finish-a-bracelet', 'finish-earrings', 'finish-a-necklace'];
export const CONSENT_BANNER = 'cookie-consent-banner';
export const CONSENT_REJECT = 'cookie-consent-reject-all';
export const NO_MATCH_QUERY = 'zzzznothing';
export const UNKNOWN_PATTERN = 'no-such-pattern-e2e';

const MIN_HIT_PX = 44;
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const LOAD_FAILED_TIMEOUT_MS = 30_000;
const OFFLINE_READY_TIMEOUT_MS = 30_000;

export interface JinxScreen {
  name: string;
  open: (page: Page) => Promise<void>;
}

export async function livePatternSlug(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/browse')).text();
  const slug = /href="\/patterns\/([a-z0-9-]+)"/.exec(html)?.[1];
  expect(slug, 'GET /browse lists no pattern link').toBeDefined();
  return slug as string;
}

export async function rejectConsent(page: Page): Promise<void> {
  await page.getByTestId(CONSENT_REJECT).click();
  await expect(page.getByTestId(CONSENT_BANNER)).toBeHidden();
}

export function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!READ_METHODS.includes(request.method()) && /jinx/.test(new URL(request.url()).hostname)) writes.push(`${request.method()} ${request.url()}`);
  });
  return writes;
}

export async function readLayoutProblems(page: Page): Promise<string[]> {
  return page.evaluate((minHit) => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) found.push(`horizontal scroll ${root.scrollWidth} > ${root.clientWidth}`);
    document.querySelectorAll('a,button,select,input:not([type=hidden]),summary,[role="button"]').forEach((el) => {
      const box = el.getBoundingClientRect();
      const shown = box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      if (!shown || el.classList.contains('skip')) return;
      if (box.width < minHit || box.height < minHit) {
        const label = (el.textContent ?? '').trim().slice(0, 30) || el.getAttribute('data-testid') || el.getAttribute('aria-label') || '';
        found.push(`hit ${el.tagName} ${Math.round(box.width)}x${Math.round(box.height)} ${label}`);
      }
    });
    return found;
  }, MIN_HIT_PX);
}

async function openPattern(page: Page): Promise<void> {
  await page.goto(`/patterns/${await livePatternSlug(page.request)}`);
}

async function openApp(page: Page, path: string, testId: string): Promise<void> {
  await page.goto(`${APP_URL}${path}`);
  await expect(page.getByTestId(testId).first()).toBeVisible();
}

export async function openSavedWithPattern(page: Page): Promise<void> {
  await openNewTracker(page);
  await openApp(page, '/saved', 'jinx-saved-screen');
  await expect(page.locator('[data-testid^="jinx-saved-open-"]').first()).toBeVisible();
}

async function isStillAcrossTwoFrames(screen: Locator): Promise<boolean> {
  return screen.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const left = el.getBoundingClientRect().left;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.getBoundingClientRect().left === left)));
      }),
  );
}

export async function openRecolour(page: Page): Promise<void> {
  await openSavedWithPattern(page);
  await page.locator('[data-testid^="jinx-saved-recolour-"]').first().click();
  const screen = page.getByTestId('jinx-recolour-screen');
  await expect(screen).toBeVisible();
  await expect.poll(() => isStillAcrossTwoFrames(screen)).toBe(true);
}

async function waitForOfflineShell(page: Page): Promise<void> {
  await expect(page.getByTestId('jinx-tracker-offline-ready')).toBeVisible({ timeout: OFFLINE_READY_TIMEOUT_MS });
}

export async function openTrackerOffline(page: Page): Promise<void> {
  await openNewTracker(page);
  await waitForOfflineShell(page);
  await page.context().setOffline(true);
  // Reload proves the state survives a fresh page load.
  await page.reload();
  await expect(page.getByTestId('jinx-tracker-offline')).toBeVisible();
}

export async function openTrackerLoadFailed(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/tracker?id=${UNKNOWN_PATTERN}`);
  await expect(page.getByTestId('jinx-message-action')).toBeVisible({ timeout: LOAD_FAILED_TIMEOUT_MS });
}

export const SITE_SCREENS: JinxScreen[] = [
  { name: 'home', open: async (page) => { await page.goto('/'); } },
  { name: 'browse', open: async (page) => { await page.goto('/browse'); } },
  { name: 'browse empty', open: async (page) => { await page.goto(`/browse?q=${NO_MATCH_QUERY}`); } },
  { name: 'browse consent answered', open: async (page) => { await page.goto('/browse'); await rejectConsent(page); } },
  { name: 'pattern', open: openPattern },
  { name: 'pattern consent answered', open: async (page) => { await openPattern(page); await rejectConsent(page); } },
  { name: 'guides', open: async (page) => { await page.goto('/guides'); } },
  ...GUIDE_SLUGS.map((slug) => ({ name: `guide ${slug}`, open: async (page: Page) => { await page.goto(`/guides/${slug}`); } })),
  { name: 'attribution', open: async (page) => { await page.goto('/attribution'); } },
  { name: 'privacy', open: async (page) => { await page.goto('/privacy'); } },
  { name: 'not found', open: async (page) => { await page.goto('/no-such-page'); } },
];

export const APP_SCREENS: JinxScreen[] = [
  { name: 'make', open: (page) => openApp(page, '/make', 'jinx-generator-generate') },
  { name: 'tracker', open: openNewTracker },
  { name: 'tracker offline', open: openTrackerOffline },
  { name: 'tracker no pattern', open: (page) => openApp(page, '/tracker', 'jinx-message-action') },
  { name: 'tracker load failed', open: openTrackerLoadFailed },
  { name: 'saved empty', open: (page) => openApp(page, '/saved', 'jinx-message-action') },
  { name: 'saved with pattern', open: openSavedWithPattern },
  { name: 'recolour', open: openRecolour },
];
