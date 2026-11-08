import { expect, test } from '@playwright/test';

import { removeCodeAccount, signInByCode } from './helpers/code-sign-in';
import { BFF_API, holdPosts, openPublishForNewChart, pretendSignedIn } from './helpers/live-api';
import { livePatternSlug } from './helpers/screens';
import { ACCOUNT_TEST_MS, publishThroughForm, removeOwnPattern, uniqueTitle } from './helpers/signed-in';

test.use({ serviceWorkers: 'block' });

test('AC-27 Publish form, Open, publish, search, MakeSellCredit preselected; licence on page; licence filter works', async ({ page }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const name = uniqueTitle('licence');
  const search = `${BFF_API}/patterns?q=${encodeURIComponent(name)}`;
  const account = await signInByCode(page);
  let externalId = '';
  try {
    const published = await publishThroughForm(page, name);

    externalId = published.externalId;
    const found = await (await page.request.get(search)).json();
    expect(found.items.map((item: { slug: string; licence: string }) => [item.slug, item.licence])).toEqual([[published.slug, 'MakeSellCredit']]);
    expect((await (await page.request.get(`${search}&licence=MakeSellCredit`)).json()).total).toBe(1);
    expect((await (await page.request.get(`${search}&licence=PersonalOnly`)).json()).total).toBe(0);
    await page.goto(`/patterns/${published.slug}`);
    await expect(page.getByTestId('pattern-licence')).toContainText(/credit/i);
  } finally {
    if (externalId !== '') await removeOwnPattern(page.request, externalId);
    await removeCodeAccount(page, account.email);
  }
});

test('AC-27 API licence filter, returns only that licence and nothing for an unused one', async ({ request }) => {
  const used = 'MakeSellCredit';
  const unused = 'PersonalOnly';

  const matching = await (await request.get(`${BFF_API}/patterns?licence=${used}`)).json();
  const empty = await (await request.get(`${BFF_API}/patterns?licence=${unused}`)).json();

  expect(matching.total).toBeGreaterThan(0);
  expect(matching.items.every((item: { licence: string }) => item.licence === used)).toBe(true);
  expect(empty.total).toBe(0);
});

test('AC-27 browse filtered to an unused licence, shows the empty result; the used licence shows cards', async ({ page }) => {
  const usedFilter = '/browse?licence=make-sell';
  const unusedFilter = '/browse?licence=personal';

  await page.goto(unusedFilter);
  await expect(page.getByTestId('clear-filters')).toBeVisible();
  await page.goto(usedFilter);

  await expect(page.getByTestId('clear-filters')).toBeHidden();
  await expect(page.locator('a[href^="/patterns/"]').first()).toBeVisible();
});

test('AC-27 live pattern page, names the licence the API holds', async ({ page, request }) => {
  const slug = await livePatternSlug(request);
  const held = (await (await request.get(`${BFF_API}/patterns/${slug}`)).json()).summary.licence;
  expect(held).toBe('MakeSellCredit');

  await page.goto(`/patterns/${slug}`);

  await expect(page.getByTestId('pattern-licence')).toContainText(/credit/i);
});

test('AC-27 publish form untouched, posts MakeSellCredit', async ({ page }) => {
  const name = 'E2E Licence Band';
  const posts = await holdPosts(page, '/patterns', 201, { externalId: '00000000-0000-4000-8000-00000000e2e2', slug: 'e2e-licence-band', indexable: false });
  await pretendSignedIn(page);
  await openPublishForNewChart(page);
  await page.getByTestId('jinx-publish-rights').click();
  await page.getByTestId('jinx-publish-name').fill(name);

  await page.getByTestId('jinx-publish-submit').click();

  await expect(page.getByTestId('jinx-publish-outcome')).toBeVisible();
  expect(posts[0]).toMatchObject({ title: name, licence: 'MakeSellCredit' });
});
