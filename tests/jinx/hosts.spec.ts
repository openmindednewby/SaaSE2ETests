import { expect, test, type APIRequestContext } from '@playwright/test';

import { APP_URL } from './helpers/tracker';

const SITE_URL = process.env.JINX_SITE_URL ?? 'http://unconfigured.invalid';
const SITE_ASSET = /(?:href|src)="(\/_astro\/[^"]+\.[0-9A-Za-z_-]{8}\.(?:css|js))"/;
const APP_ENTRY = /src="(\/_expo\/static\/js\/web\/entry-[0-9a-f]{32}\.js)/;
const APP_ASSET = /(\/assets\/[^"'\s]+\.[0-9a-f]{32}\.png)/;

async function appHashedAsset(html: string, request: APIRequestContext): Promise<string | undefined> {
  const entryPath = APP_ENTRY.exec(html)?.[1];
  expect(entryPath, 'no entry bundle named in the HTML').toBeDefined();
  const entry = await request.get(`${APP_URL}${entryPath}`);
  expect(entry.headers()['cache-control']).toBe('no-cache');
  return APP_ASSET.exec(await entry.text())?.[1];
}

const HOSTS = [
  { host: SITE_URL, hashedAsset: async (html: string): Promise<string | undefined> => SITE_ASSET.exec(html)?.[1] },
  { host: APP_URL, hashedAsset: appHashedAsset },
];
const PLAIN_EMAIL = /mailto:|hello@dloizides\.com/;

for (const { host, hashedAsset } of HOSTS) {
  test(`AC-49 ${host}, Request, TLS valid; no-cache on HTML, immutable on hashed assets; contact assembled in JS`, async ({ request }) => {
    const entry = await request.get(`${host}/`);

    const html = await entry.text();
    expect(entry.status()).toBe(200);
    expect(entry.url().startsWith('https://')).toBe(true);
    expect.soft(entry.headers()['cache-control']).toBe('no-cache');
    expect.soft(html).not.toMatch(PLAIN_EMAIL);
    const assetPath = await hashedAsset(html, request);
    expect(assetPath, 'no hashed asset named in the HTML').toBeDefined();
    const assetResponse = await request.get(`${host}${assetPath}`);
    expect(assetResponse.status()).toBe(200);
    expect(assetResponse.headers()['cache-control']).toContain('immutable');
  });
}

test('AC-49 Site footer, Request, TLS valid; no-cache on HTML, immutable on hashed assets; contact assembled in JS', async ({ page }) => {
  await page.goto('/');

  const contact = page.locator('[data-contact-user]');

  await expect(contact).toHaveAttribute('href', 'mailto:hello@dloizides.com');
});
