import { expect, test } from '@playwright/test';

import { BFF_API, WRITE_HEADERS } from './helpers/live-api';
import { ACCOUNT_TEST_MS, newJinxAccount, pollSitemap, publishRandomChart, removeAccount, removeOwnPattern, signedInApi, uniqueTitle } from './helpers/signed-in';

const SITEMAP_WITHIN_MS = 60_000;

test('AC-25 Signed-in user, verified email, Publish, Fetch without JS at once: 200 with index,follow; in sitemap within 60 s', async ({ request }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const chartTitle = uniqueTitle('publish');
  const account = await newJinxAccount();
  const api = await signedInApi(account.email, account.password);
  let externalId = '';
  try {
    const published = await publishRandomChart(api, chartTitle);
    externalId = published.externalId;

    const page = await request.get(`/patterns/${published.slug}`);

    expect(published.indexable).toBe(true);
    expect(page.status()).toBe(200);
    const html = await page.text();
    expect(html).toContain('<meta name="robots" content="index,follow"');
    expect(html).toContain(chartTitle);
    await pollSitemap(request, published.slug, SITEMAP_WITHIN_MS).toBe(true);
  } finally {
    if (externalId !== '') await removeOwnPattern(api, externalId);
    await api.dispose();
    await removeAccount(account);
  }
});

test('AC-25 anonymous publish, returns 401', async ({ request }) => {
  const data = { title: 'E2E anonymous' };

  const response = await request.post(`${BFF_API}/patterns`, { headers: WRITE_HEADERS, data });

  expect(response.status()).toBe(401);
});
