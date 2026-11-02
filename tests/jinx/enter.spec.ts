import { expect, test, type Page } from '@playwright/test';

import { holdPosts, openPublishForNewChart, pretendSignedIn } from './helpers/live-api';
import { livePatternSlug } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const REPORTER = 'e2e-enter@example.com';
const STATEMENT = 'E2E probe, no report is stored';
const NAME = 'E2E Enter Band';
const LIVE = 'It is live.';
const PUBLISHED = { externalId: '00000000-0000-4000-8000-00000000e2e1', slug: 'e2e-enter-band', indexable: false };

async function fillReport(page: Page, slug: string, email: string): Promise<void> {
  await page.goto(`${APP_URL}/report?id=${slug}`);
  await page.getByTestId('jinx-report-statement').fill(STATEMENT);
  await page.getByTestId('jinx-report-email').fill(email);
}

test('AC-ENTER-browse-search no-match query, Enter, navigates once and shows the empty result', async ({ page }) => {
  const query = 'zzzznothing';
  const searches: string[] = [];
  page.on('request', (sent) => {
    if (sent.isNavigationRequest() && sent.url().includes(`q=${query}`)) searches.push(sent.url());
  });
  await page.goto('/browse');
  await page.getByTestId('browse-search-input').fill(query);

  await page.getByTestId('browse-search-input').press('Enter');

  await expect(page.getByTestId('clear-filters')).toBeVisible();
  expect(searches).toHaveLength(1);
});

test('AC-ENTER-report-email valid form, Enter, posts the same body as the button, once', async ({ page, request }) => {
  const slug = await livePatternSlug(request);
  const posts = await holdPosts(page, '/reports', 202, {});
  await fillReport(page, slug, REPORTER);
  await page.getByTestId('jinx-report-submit').click();
  await expect(page.getByTestId('jinx-report-status')).toBeVisible();
  const byButton = posts[0];
  await fillReport(page, slug, REPORTER);

  await page.getByTestId('jinx-report-email').press('Enter');

  await expect(page.getByTestId('jinx-report-status')).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(byButton);
});

test('AC-ENTER-report-email malformed email, Enter, posts nothing and shows the email error', async ({ page, request }) => {
  const slug = await livePatternSlug(request);
  const posts = await holdPosts(page, '/reports', 202, {});
  await fillReport(page, slug, 'not-an-email');

  await page.getByTestId('jinx-report-email').press('Enter');

  await expect(page.getByText('Enter an email address we can reply to.')).toBeVisible();
  expect(posts).toHaveLength(0);
});

test('AC-ENTER-publish-name valid form, Enter, posts once and shows live', async ({ page }) => {
  const posts = await holdPosts(page, '/patterns', 201, PUBLISHED);
  await pretendSignedIn(page);
  await openPublishForNewChart(page);
  await page.getByTestId('jinx-publish-rights').click();
  await page.getByTestId('jinx-publish-name').fill(NAME);

  await page.getByTestId('jinx-publish-name').press('Enter');

  await expect(page.getByTestId('jinx-publish-outcome')).toContainText(LIVE);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ title: NAME });
});

test('AC-ENTER-publish-name empty name, Enter, posts nothing and shows the name error', async ({ page }) => {
  const posts = await holdPosts(page, '/patterns', 201, PUBLISHED);
  await pretendSignedIn(page);
  await openPublishForNewChart(page);
  await page.getByTestId('jinx-publish-rights').click();
  await page.getByTestId('jinx-publish-name').fill('');

  await page.getByTestId('jinx-publish-name').press('Enter');

  await expect(page.getByText('Give it a name of up to 120 characters.')).toBeVisible();
  expect(posts).toHaveLength(0);
});
