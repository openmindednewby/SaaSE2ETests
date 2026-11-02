import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { livePatternSlug, recordWrites } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const UNMATCHED = 'Unmatched Route';
const PER_LINK_MS = 20_000;
const SCREEN_BY_PATH: Record<string, string> = {
  '/make': 'jinx-generator-screen',
  '/tracker': 'jinx-tracker-screen',
  '/recolour': 'jinx-recolour-screen',
  '/saved': 'jinx-saved-screen',
  '/login': 'jinx-login-page',
};
const SOURCES: { name: string; path: (request: APIRequestContext) => Promise<string> }[] = [
  { name: '/browse', path: async () => '/browse' },
  { name: 'a pattern page', path: async (request) => `/patterns/${await livePatternSlug(request)}` },
];

async function readAppLinks(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  const hrefs = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
  const appOrigin = new URL(APP_URL).origin;
  return [...new Set(hrefs.filter((href) => new URL(href).origin === appOrigin))];
}

for (const source of SOURCES) {
  test(`Regression app links on ${source.name}, each opened in a browser, lands on its screen and never on "${UNMATCHED}"`, async ({ page, request }) => {
    const links = await readAppLinks(page, await source.path(request));
    expect(links.length).toBeGreaterThan(0);
    test.setTimeout(links.length * PER_LINK_MS);
    const writes = recordWrites(page);

    for (const link of links) {
      const screen = SCREEN_BY_PATH[new URL(link).pathname];
      await page.goto(link);

      expect.soft(screen, `${link} has no known screen`).toBeDefined();
      await expect.soft(page.getByTestId(screen ?? UNMATCHED), `${link} did not show ${screen}`).toBeVisible();
      await expect.soft(page.getByText(UNMATCHED), `${link} shows ${UNMATCHED}`).toBeHidden();
    }

    expect(writes).toEqual([]);
  });
}

test(`Regression a route the app does not have, opened in a browser, shows "${UNMATCHED}" and none of the screens`, async ({ page }) => {
  const route = `${APP_URL}/no-such-route-e2e`;

  await page.goto(route);

  await expect(page.getByText(UNMATCHED)).toBeVisible();
  for (const screen of Object.values(SCREEN_BY_PATH)) await expect(page.getByTestId(screen)).toBeHidden();
});
