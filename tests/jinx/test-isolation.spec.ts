import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, test } from '@playwright/test';

import { BFF_API } from './helpers/live-api';
import { publishRandomChart, removeOwnPattern, signedInApi, sitemapHasSlug, uniqueTitle } from './helpers/signed-in';

const PUBLISHER = 'e2e-bot+jinx-publisher@dloizides.com';
const PUBLISHER_SECRET_FILE = process.env.E2E_JINX_PUBLISHER_SECRET_FILE ?? '/run/e2e-jinx-publisher.secret';
const SITE_CACHE_OUTLASTED_MS = 65_000;

test('AC-31 e2e-jinx account publishes, Read browse + sitemap, Pattern absent from both', async ({ request }) => {
  test.setTimeout(180_000);
  const chartTitle = uniqueTitle('isolation');
  const search = `${BFF_API}/patterns?q=${encodeURIComponent(chartTitle)}`;
  const browseUrl = `/browse?q=${encodeURIComponent(chartTitle)}`;
  const publisher = await signedInApi(PUBLISHER, readFileSync(PUBLISHER_SECRET_FILE, 'utf8').trim());
  let externalId = '';
  try {
    const published = await publishRandomChart(publisher, chartTitle);
    externalId = published.externalId;
    expect(published.indexable).toBe(false);
    expect(await (await publisher.get(`${BFF_API}/me/patterns`)).text()).toContain(published.slug);

    await delay(SITE_CACHE_OUTLASTED_MS);

    expect((await (await request.get(search)).json()).total).toBe(0);
    expect(await (await request.get(browseUrl)).text()).not.toContain(published.slug);
    expect(await sitemapHasSlug(request, published.slug)).toBe(false);
  } finally {
    if (externalId !== '') await removeOwnPattern(publisher, externalId);
    await publisher.dispose();
  }
});
