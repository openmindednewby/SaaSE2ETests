import { devices, expect } from '@playwright/test';

import { parkedCookies } from '../zygos-session.js';

import type { Locator, Page } from '@playwright/test';

const { defaultBrowserType: _p, ...GALAXY_S5 } = devices['Galaxy S5'];
const { defaultBrowserType: _d, ...DESKTOP_CHROME } = devices['Desktop Chrome'];

export const PHONE = { ...GALAXY_S5 };
export const DESKTOP = { ...DESKTOP_CHROME, viewport: { width: 1280, height: 800 } };

export const VIEWPORTS = [
  { label: '360x640', use: PHONE, phone: true },
  { label: '1280x800', use: DESKTOP, phone: false },
] as const;

const RN_WEB_OPACITY_ZERO = '[style*="opacity: 0"]';
export const VISIBLE_TEXT = `body *:not([id^="a11y-hint-"]):not(${RN_WEB_OPACITY_ZERO})`;

export const SHELL = 'zygos-app-shell';
export const MIN_HIT = 44;

export const id = (testId: string): string => `[data-testid="${testId}"]`;
export const byPrefix = (prefix: string): string => `[data-testid^="${prefix}-"]`;

const SIGHT_DIR = process.env.SIGHT_DIR ?? 'test-results/sighted';

export async function enterAs(page: Page, username: string, path: string): Promise<void> {
  const cookies = await parkedCookies(username);
  expect(cookies.length, `no session could be minted for ${username}`).toBeGreaterThan(0);
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(SHELL)), `shell did not render for ${username} at ${path}`).toBeVisible({ timeout: 20_000 });
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

export async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'element has no bounding box (not rendered)').not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

export async function sight(page: Page, task: string, name: string): Promise<void> {
  await page.screenshot({ path: `${SIGHT_DIR}/${task}/${name}.png`, fullPage: false });
}
