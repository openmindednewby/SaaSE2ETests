import { expect, test } from '@playwright/test';

import { APP_URL } from './helpers/tracker';

const SITE_URL = process.env.JINX_SITE_URL ?? 'http://unconfigured.invalid';
const REAL_ID = /data-website-id="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/;
const PAGEVIEW = /\/api\/send$/;
const PAGEVIEW_WAIT_MS = 10_000;

for (const host of [SITE_URL, APP_URL]) {
  test(`AC-48 ${host}, Load, Umami snippet with a real id; pageview request observed`, async ({ page, request }) => {
    const html = await (await request.get(`${host}/`)).text();
    const pageview = page.waitForRequest(PAGEVIEW, { timeout: PAGEVIEW_WAIT_MS }).then(() => true).catch(() => false);

    await page.goto(`${host}/`);

    expect.soft(html).toMatch(REAL_ID);
    expect(await pageview, 'no Umami pageview request').toBe(true);
  });
}
