import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { APP_URL } from './tracker';

export const BFF_API = `${APP_URL}/bff/api/jinx/api/v1`;
export const WRITE_HEADERS = { 'X-BFF-Csrf': '1', Origin: APP_URL };

const API_PATH = '/bff/api/jinx/api/v1';
const SESSION_HINT_KEY = 'jinx.session.known';

export async function patternExternalId(request: APIRequestContext, slug: string): Promise<string> {
  const response = await request.get(`${BFF_API}/patterns/${slug}`);
  expect(response.status(), `GET pattern ${slug}`).toBe(200);
  return (await response.json()).summary.externalId as string;
}

export async function holdPosts(page: Page, resource: string, status: number, reply: object): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(
    (url) => url.pathname === `${API_PATH}${resource}`,
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply) });
    },
  );
  return bodies;
}

export async function pretendSignedIn(page: Page): Promise<void> {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), SESSION_HINT_KEY);
  await page.route('**/bff/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sub: 'e2e-jinx-stub', name: 'E2E Jinx', email: 'e2e-jinx@example.com' }) }),
  );
}

export async function openPublishForNewChart(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/make`);
  await page.getByTestId('jinx-generator-publish').click();
  await expect(page.getByTestId('jinx-publish-form')).toBeVisible();
}
