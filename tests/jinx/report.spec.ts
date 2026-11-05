import { expect, test, type APIRequestContext } from '@playwright/test';

import { BFF_API, holdPosts, patternExternalId, WRITE_HEADERS } from './helpers/live-api';
import { livePatternSlug, PHONE } from './helpers/screens';
import { ACCOUNT_TEST_MS, newJinxAccount, publishRandomChart, removeAccount, removeOwnPattern, signedInApi, uniqueTitle } from './helpers/signed-in';
import { newestMailbox } from './helpers/test-accounts';
import { APP_URL } from './helpers/tracker';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000e2e';
const REPORTER = 'e2e-report@example.com';
const STATEMENT = 'E2E probe, no report is stored';
const MAX_ATTEMPTS = 30;
const RECEIVED = 'Report received';

function reportBody(reporterEmail: string): object {
  return { patternId: UNKNOWN_ID, kind: 'Spam', reporterEmail, statement: STATEMENT };
}

test('AC-21 Reader on a pattern, Follow report link, submit, 202; reporter emailed', async ({ page }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const reporter = `e2e-bot+report-${Date.now()}@dloizides.com`;
  const account = await newJinxAccount();
  let owner: APIRequestContext | undefined;
  let externalId = '';
  try {
    owner = await signedInApi(account.email, account.password);
    const published = await publishRandomChart(owner, uniqueTitle('report'));
    externalId = published.externalId;
    await page.goto(`/patterns/${published.slug}`);
    await page.getByTestId('report-pattern').click();
    await page.getByTestId('jinx-report-email').fill(reporter);
    await page.getByTestId('jinx-report-statement').fill(STATEMENT);
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/reports'));

    await page.getByTestId('jinx-report-submit').click();

    expect((await answered).status()).toBe(202);
    await expect(page.getByTestId('jinx-report-status')).toContainText(RECEIVED);
    const mailbox = newestMailbox();
    const mail = await mailbox.waitForMessageTo(reporter);
    expect(JSON.stringify(mail)).toContain('We received your report');
    await mailbox.expungeMessages([mail.uid]);
  } finally {
    if (owner !== undefined && externalId !== '') await removeOwnPattern(owner, externalId);
    await owner?.dispose();
    await removeAccount(account);
  }
});

test('AC-21 report naming an unknown pattern id, returns 404', async ({ request }) => {
  const data = reportBody(REPORTER);

  const response = await request.post(`${BFF_API}/reports`, { headers: WRITE_HEADERS, data });

  expect(response.status()).toBe(404);
});

test('AC-21 report with a malformed email, returns 400', async ({ request }) => {
  const data = reportBody('not-an-email');

  const response = await request.post(`${BFF_API}/reports`, { headers: WRITE_HEADERS, data });

  expect(response.status()).toBe(400);
});

test('AC-21 report link on a live pattern page, opens the form naming that pattern', async ({ page, request }) => {
  const slug = await livePatternSlug(request);
  await page.goto(`/patterns/${slug}`);

  await page.getByTestId('report-pattern').click();

  await expect(page).toHaveURL(`${APP_URL}/report?id=${slug}`);
  await expect(page.getByTestId('jinx-report-email')).toBeFocused();
  await expect(page.getByTestId('jinx-report-pattern')).toBeHidden();
});

test('AC-21 form submit on a live pattern, posts its real id once and shows received', async ({ page, request }) => {
  const slug = await livePatternSlug(request);
  const patternId = await patternExternalId(request, slug);
  const posts = await holdPosts(page, '/reports', 202, {});
  await page.goto(`${APP_URL}/report?id=${slug}`);
  await page.getByTestId('jinx-report-email').fill(REPORTER);
  await page.getByTestId('jinx-report-statement').fill(STATEMENT);

  await page.getByTestId('jinx-report-submit').click();

  await expect(page.getByTestId('jinx-report-status')).toContainText(RECEIVED);
  expect(posts).toEqual([{ patternId, kind: 'Copyright', reporterEmail: REPORTER, statement: STATEMENT }]);
});

test.describe('AC-21 pressing Send at 360x640', () => {
  test.use(PHONE);

  test('with a pattern that does not exist, shows why inside the screen', async ({ page }) => {
    await page.goto(`${APP_URL}/report?id=no-such-pattern-e2e`);
    await page.getByTestId('jinx-report-email').fill(REPORTER);
    await page.getByTestId('jinx-report-statement').fill(STATEMENT);

    await page.getByTestId('jinx-report-submit').click();

    await expect(page.getByTestId('jinx-report-status')).toBeInViewport({ ratio: 1 });
  });

  test('with nothing filled in, moves to the first field that needs fixing', async ({ page }) => {
    await page.goto(`${APP_URL}/report`);

    await page.getByTestId('jinx-report-submit').click();

    await expect(page.getByTestId('jinx-report-pattern')).toBeFocused();
    await expect(page.getByTestId('jinx-report-pattern')).toBeInViewport({ ratio: 1 });
  });
});

test('AC-21 repeated reports from one client, answer 429 after the limit', async ({ request }) => {
  const data = reportBody(REPORTER);
  const statuses: number[] = [];

  while (statuses.length < MAX_ATTEMPTS && !statuses.includes(429)) {
    statuses.push((await request.post(`${BFF_API}/reports`, { headers: WRITE_HEADERS, data })).status());
  }

  expect(statuses).toContain(429);
  expect(statuses.slice(0, -1).every((status) => status === 404), statuses.join(',')).toBe(true);
});
