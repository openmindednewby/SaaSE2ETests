import { expect, test } from '@playwright/test';

const HOST = 'https://jinxbeadpatterns.dloizides.com';
const OLD_HOST = 'https://jinxbeadpatterns-app.dloizides.com';
const APP_ROUTES = ['/make', '/saved', '/tracker', '/colour', '/recolour', '/report', '/login', '/register', '/verify-email', '/favourites', '/my-patterns', '/publish', '/admin', '/delete-account'];
const SERVER_PAGES = [
  { path: '/', mark: '<h1' },
  { path: '/browse', mark: 'data-testid="pattern-card"' },
  { path: '/guides/finish-a-bracelet', mark: '<h1' },
  { path: '/patterns/harbour-lozenge-cuff', mark: '<svg' },
];
const OLD_URLS = ['/make', '/saved?x=1', '/tracker?id=band', '/login', '/manifest.json'];
const STATUS_OK = 200;
const STATUS_MOVED = 301;
const STATUS_NOT_FOUND = 404;

for (const route of APP_ROUTES) {
  test(`AC-ONE-1 App screen on the one host, GET ${route}, 200 HTML from the app, kept out of search`, async ({ request }) => {
    const response = await request.get(`${HOST}${route}`, { maxRedirects: 0 });

    const html = await response.text();

    expect(response.status()).toBe(STATUS_OK);
    expect(html).toContain('noindex');
    expect(html).not.toContain('rel="canonical"');
  });
}

for (const { path, mark } of SERVER_PAGES) {
  test(`AC-ONE-10 First visit, GET ${path}, full server HTML with no script run`, async ({ request }) => {
    const response = await request.get(`${HOST}${path}`, { maxRedirects: 0 });

    const html = await response.text();

    expect(response.status()).toBe(STATUS_OK);
    expect(html).toContain(mark);
    expect(html).toContain('rel="canonical"');
  });
}

test('AC-ONE-3 One host, GET the manifests and worker, one manifest opening on /browse and one worker', async ({ request }) => {
  const manifest = await request.get(`${HOST}/manifest.json`);
  const retired = await request.get(`${HOST}/manifest.webmanifest`);
  const worker = await request.get(`${HOST}/service-worker.js`);

  const body = (await manifest.json()) as { start_url: string; scope: string };

  expect(body.start_url).toBe('/browse?source=pwa');
  expect(body.scope).toBe('/');
  expect(retired.status()).toBe(STATUS_NOT_FOUND);
  expect(worker.status()).toBe(STATUS_OK);
  expect(await worker.text()).toContain('const SHELL_URL = "/make"');
});

test('AC-ONE-6 On Make, tap Patterns then Make, stays in one tab on one host', async ({ page, context }) => {
  await page.goto(`${HOST}/make`);

  await page.getByTestId('jinx-nav-patterns').first().click();
  await page.waitForURL(`${HOST}/`);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Make' }).click();
  await page.waitForURL(`${HOST}/make`);

  expect(context.pages()).toHaveLength(1);
});

for (const url of OLD_URLS) {
  test(`AC-ONE-2 Old app host, GET ${url}, 301 to the same path on the one host`, async ({ request }) => {
    const response = await request.get(`${OLD_HOST}${url}`, { maxRedirects: 0 });

    expect(response.status()).toBe(STATUS_MOVED);
    expect(response.headers().location).toBe(`${HOST}${url}`);
  });
}

test('AC-ONE-2 Old app host, GET the worker, stays 200 and is the retiring worker', async ({ request }) => {
  const response = await request.get(`${OLD_HOST}/service-worker.js`, { maxRedirects: 0 });

  expect(response.status()).toBe(STATUS_OK);
  expect(await response.text()).toContain('kill-switch');
});
