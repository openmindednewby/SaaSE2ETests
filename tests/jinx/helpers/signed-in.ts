import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { createTestAccount, type TestAccount } from '@dloizides/e2e-helpers';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

import { BFF_API, openPublishForNewChart, SESSION_HINT_KEY, WRITE_HEADERS } from './live-api';
import { apiContext, expungeLeftoverMail, newestMailbox, pacedContext, postPaced } from './test-accounts';
import { APP_URL } from './tracker';

export const ACCOUNT_TEST_MS = 600_000;
export const ADMIN_USERNAME = 'e2e-bot-jinx-admin';

const ADMIN_SECRET_FILE = process.env.E2E_JINX_ADMIN_SECRET_FILE ?? '/run/e2e-jinx-admin.secret';
const AUTH_RATE_WINDOW_MS = 60_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const MAX_LOGIN_ATTEMPTS = 8;
const CHART_SIDE = 8;
const LOOM_STITCH_NUMBER = 3;
const PALETTE = ['DB0001', 'DB0010'];
const SITEMAP_POLL_MS = 5000;
const PUBLISH_DESCRIPTION = 'Automated test pattern, removed straight after the check.';

export interface Published {
  externalId: string;
  slug: string;
  indexable: boolean;
}

export function uniqueTitle(label: string): string {
  return `E2E ${label} ${randomBytes(4).toString('hex')}`;
}

export function newJinxAccount(): Promise<TestAccount> {
  return createTestAccount({ app: 'jinx', baseUrl: APP_URL, newContext: pacedContext(), mailbox: newestMailbox() });
}

export async function removeAccount(account: TestAccount): Promise<void> {
  const disposed = await account.dispose();
  expect.soft(disposed.confirmStatus, `dispose ${account.email}`).toBe(200);
  await expungeLeftoverMail(account.email);
}

export async function signedInApi(username: string, password: string): Promise<APIRequestContext> {
  const context = await apiContext(APP_URL);
  const login = await postPaced(context, '/bff/login', { data: { username, password } }, AUTH_RATE_WINDOW_MS);
  expect(login.status(), `POST /bff/login as ${username}`).toBe(200);
  return context;
}

export function adminPassword(): string {
  return readFileSync(ADMIN_SECRET_FILE, 'utf8').trim();
}

function randomChart(): object {
  const rows = Array.from({ length: CHART_SIDE }, () =>
    Array.from({ length: CHART_SIDE }, () => randomBytes(1)[0] % PALETTE.length),
  );
  return {
    stitch: 'Loom',
    piece: 'Bracelet',
    width: CHART_SIDE,
    height: CHART_SIDE,
    cells: rows.flat().map((index) => PALETTE[index]),
    chartDoc: { version: 1, stitch: LOOM_STITCH_NUMBER, width: CHART_SIDE, height: CHART_SIDE, palette: PALETTE, cells: rows },
  };
}

export async function publishRandomChart(api: APIRequestContext, title: string): Promise<Published> {
  const data = { title, description: PUBLISH_DESCRIPTION, licence: 'MakeSellCredit', ...randomChart() };
  const response = await api.post(`${BFF_API}/patterns`, { data });
  expect(response.status(), `POST /patterns: ${(await response.text()).slice(0, 300)}`).toBe(201);
  return (await response.json()) as Published;
}

export async function removeOwnPattern(api: APIRequestContext, externalId: string): Promise<void> {
  const response = await api.delete(`${BFF_API}/patterns/${externalId}`);
  expect.soft(response.status(), `owner delete ${externalId}`).toBe(204);
}

export async function sitemapHasSlug(request: APIRequestContext, slug: string): Promise<boolean> {
  const index = await (await request.get('/sitemap.xml')).text();
  const pages = [...index.matchAll(/<loc>([^<]+sitemap-patterns[^<]+)<\/loc>/g)].map((match) => match[1]);
  const bodies = await Promise.all(pages.map(async (page) => (await request.get(page)).text()));
  return bodies.some((body) => body.includes(`/patterns/${slug}<`));
}

export function pollSitemap(request: APIRequestContext, slug: string, timeout: number): ReturnType<typeof expect.poll> {
  return expect.poll(() => sitemapHasSlug(request, slug), { message: `sitemap row ${slug}`, intervals: [SITEMAP_POLL_MS], timeout });
}

export async function signInPage(page: Page, username: string, password: string): Promise<void> {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), SESSION_HINT_KEY);
  const login = await postPaced(
    page.request,
    `${APP_URL}/bff/login`,
    { headers: WRITE_HEADERS, data: { username, password } },
    AUTH_RATE_WINDOW_MS,
  );
  expect(login.status(), `POST /bff/login as ${username}`).toBe(200);
}

export async function publishThroughForm(page: Page, name: string): Promise<Published> {
  await openPublishForNewChart(page);
  await page.getByTestId('jinx-publish-rights').click();
  await page.getByTestId('jinx-publish-name').fill(name);
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/patterns'),
  );

  await page.getByTestId('jinx-publish-submit').click();

  const response = await answered;
  expect(response.status(), `form POST /patterns: ${(await response.text()).slice(0, 300)}`).toBe(201);
  await expect(page.getByTestId('jinx-publish-outcome')).toBeVisible();
  return (await response.json()) as Published;
}

export async function pressEnterForLogin(page: Page): Promise<APIResponse> {
  for (let attempt = 1; ; attempt += 1) {
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/bff/login');
    await page.locator('input[type="password"]').press('Enter');
    const response = (await answered) as unknown as APIResponse;
    if (response.status() !== HTTP_TOO_MANY_REQUESTS || attempt === MAX_LOGIN_ATTEMPTS) return response;
    await delay(AUTH_RATE_WINDOW_MS);
  }
}
