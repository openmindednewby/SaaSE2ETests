import { expect, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';

import { BFF_API } from './live-api';
import { livePatternSlug } from './screens';
import { APP_URL } from './tracker';

const SEARCH_PATH = `${new URL(BFF_API).pathname}/patterns`;
const FIELD = 'jinx-report-pattern';

export const REPORT_URL = `${APP_URL}/report`;
export const LISTBOX_ID = `${FIELD}-listbox`;

export interface SearchRow {
  slug: string;
  title: string;
  stitch: string;
  piece: string;
  width: number;
  height: number;
  beadTotal: number;
}

export interface LivePattern {
  slug: string;
  title: string;
  externalId: string;
}

export interface HeldSearch {
  reached: Promise<void>;
  release: () => Promise<void>;
}

interface TimedWindow {
  e2eLastInputAt: number;
  e2eSearchWaits: number[];
}

export const patternField = (page: Page): Locator => page.getByTestId(FIELD);
export const patternMenu = (page: Page): Locator => page.getByTestId(`${FIELD}-menu`);
export const patternRows = (page: Page): Locator => page.getByRole('option');
export const patternRowId = (slug: string): string => `${FIELD}-option-${slug}`;
export const patternRow = (page: Page, slug: string): Locator => page.getByTestId(patternRowId(slug));

export async function livePattern(request: APIRequestContext): Promise<LivePattern> {
  const slug = await livePatternSlug(request);
  const response = await request.get(`${BFF_API}/patterns/${slug}`);
  expect(response.status(), `GET pattern ${slug}`).toBe(200);
  const { summary } = await response.json();
  return { slug, title: summary.title as string, externalId: summary.externalId as string };
}

export async function liveSearchSlugs(request: APIRequestContext, query: string): Promise<string[]> {
  const response = await request.get(`${BFF_API}/patterns`, { params: { q: query } });
  expect(response.status(), `GET patterns q=${query}`).toBe(200);
  return ((await response.json()).items as { slug: string }[]).map((item) => item.slug);
}

export async function liveTitleAndDescription(request: APIRequestContext, slug: string): Promise<string> {
  const pattern = await (await request.get(`${BFF_API}/patterns/${slug}`)).json();
  return `${pattern.summary.title as string} ${pattern.description as string}`;
}

export async function fillReporter(page: Page, email: string, statement: string): Promise<void> {
  await page.getByTestId('jinx-report-email').fill(email);
  await page.getByTestId('jinx-report-statement').fill(statement);
}

export async function routeSearch(page: Page, answer: (query: string, route: Route) => Promise<void>): Promise<void> {
  await page.route(
    (url) => url.pathname === SEARCH_PATH,
    (route) => answer(new URL(route.request().url()).searchParams.get('q') ?? '', route),
  );
}

export function answerRows(route: Route, items: SearchRow[]): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) });
}

export function isSearchRequest(url: string): boolean {
  return new URL(url).pathname === SEARCH_PATH;
}

export async function openOneRowList(page: Page, row: SearchRow): Promise<Locator> {
  await routeSearch(page, (_query, route) => answerRows(route, [row]));
  await page.goto(REPORT_URL);
  await patternField(page).fill('e2e');
  const shown = patternRow(page, row.slug);
  await expect(shown).toBeVisible();
  return shown;
}

export async function pickFirstRowByKeys(page: Page, slug: string): Promise<void> {
  await expect(patternRow(page, slug)).toBeVisible();
  await patternField(page).press('ArrowDown');
  await patternField(page).press('Enter');
}

export async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function holdSearch(page: Page, heldQuery: string, heldRows: SearchRow[], otherRows: SearchRow[]): Promise<HeldSearch> {
  let markReached = (): void => undefined;
  let letGo = (): void => undefined;
  let markDone = (): void => undefined;
  const reached = new Promise<void>((resolve) => { markReached = resolve; });
  const released = new Promise<void>((resolve) => { letGo = resolve; });
  const done = new Promise<void>((resolve) => { markDone = resolve; });
  await routeSearch(page, async (query, route) => {
    if (query !== heldQuery) {
      await answerRows(route, otherRows);
      return;
    }
    markReached();
    await released;
    await answerRows(route, heldRows).catch(() => undefined);
    markDone();
  });
  return { reached, release: async () => { letGo(); await done; await settleFrames(page); } };
}

export async function recordSearchWaits(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const timed = window as unknown as TimedWindow;
    timed.e2eLastInputAt = 0;
    timed.e2eSearchWaits = [];
    window.addEventListener('input', () => { timed.e2eLastInputAt = performance.now(); }, true);
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patched(this: XMLHttpRequest, ...args: unknown[]): void {
      if (String(args[1]).includes('/patterns?')) timed.e2eSearchWaits.push(performance.now() - timed.e2eLastInputAt);
      (open as (...inner: unknown[]) => void).apply(this, args);
    };
  });
}

export function readSearchWaits(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as TimedWindow).e2eSearchWaits);
}
