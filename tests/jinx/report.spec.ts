import { expect, test } from '@playwright/test';

import { BFF_API, holdPosts, patternExternalId, WRITE_HEADERS } from './helpers/live-api';
import { livePatternSlug } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000e2e';
const REPORTER = 'e2e-report@example.com';
const STATEMENT = 'E2E probe, no report is stored';
const MAX_ATTEMPTS = 30;
const RECEIVED = 'Report received';

function reportBody(reporterEmail: string): object {
  return { patternId: UNKNOWN_ID, kind: 'Spam', reporterEmail, statement: STATEMENT };
}

test('AC-21 Reader on a pattern, Follow report link, submit, 202; owner and reporter emailed; rate limited after the limit', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-21').toBe(true);
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

test('AC-21 repeated reports from one client, answer 429 after the limit', async ({ request }) => {
  const data = reportBody(REPORTER);
  const statuses: number[] = [];

  while (statuses.length < MAX_ATTEMPTS && !statuses.includes(429)) {
    statuses.push((await request.post(`${BFF_API}/reports`, { headers: WRITE_HEADERS, data })).status());
  }

  expect(statuses).toContain(429);
  expect(statuses.slice(0, -1).every((status) => status === 404), statuses.join(',')).toBe(true);
});
