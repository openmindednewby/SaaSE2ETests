import { expect, test } from '@playwright/test';

import { BFF_API, WRITE_HEADERS } from './helpers/live-api';
import { ACCOUNT_TEST_MS, ADMIN_USERNAME, adminPassword, newJinxAccount, pollSitemap, publishRandomChart, removeAccount, removeOwnPattern, signedInApi, uniqueTitle } from './helpers/signed-in';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000e2e';
const REMOVED_WITHIN_MS = 60_000;
const GONE_POLL_MS = 1000;

test('AC-22 Live indexed pattern, Admin removes, Page 410 within 60 s, sitemap row gone, browse row gone', async ({ request }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const chartTitle = uniqueTitle('takedown');
  const browseUrl = `/browse?q=${encodeURIComponent(chartTitle)}`;
  const account = await newJinxAccount();
  const owner = await signedInApi(account.email, account.password);
  let externalId = '';
  try {
    const admin = await signedInApi(ADMIN_USERNAME, adminPassword());
    const published = await publishRandomChart(owner, chartTitle);
    externalId = published.externalId;
    expect((await request.get(`/patterns/${published.slug}`)).status()).toBe(200);
    expect(await (await request.get(browseUrl)).text()).toContain(published.slug);

    const removal = await admin.post(`${BFF_API}/admin/patterns/${externalId}/remove`, { data: { reason: 'E2E takedown check' } });

    await admin.dispose();
    expect(removal.status()).toBe(204);
    expect((await request.get(`${BFF_API}/patterns/${published.slug}`)).status()).toBe(410);
    await expect
      .poll(async () => (await request.get(`/patterns/${published.slug}`)).status(), { intervals: [GONE_POLL_MS], timeout: REMOVED_WITHIN_MS })
      .toBe(410);
    await pollSitemap(request, published.slug, REMOVED_WITHIN_MS).toBe(false);
    expect(await (await request.get(browseUrl)).text()).not.toContain(published.slug);
  } finally {
    if (externalId !== '') await removeOwnPattern(owner, externalId);
    await owner.dispose();
    await removeAccount(account);
  }
});

test('AC-22 anonymous admin remove, returns 401', async ({ request }) => {
  const data = { reason: 'E2E anonymous' };

  const response = await request.post(`${BFF_API}/admin/patterns/${UNKNOWN_ID}/remove`, { headers: WRITE_HEADERS, data });

  expect(response.status()).toBe(401);
});

test('AC-22 anonymous owner delete, returns 401', async ({ request }) => {
  const url = `${BFF_API}/patterns/${UNKNOWN_ID}`;

  const response = await request.delete(url, { headers: WRITE_HEADERS });

  expect(response.status()).toBe(401);
});
