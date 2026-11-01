import { expect, test } from '@playwright/test';

test('AC-ENTER-browse-search Query typed, Enter, Search runs once', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-ENTER-browse-search').toBe(true);
});

test('AC-ENTER-publish-name Name typed, Enter, Same as its button, once; refuses when invalid', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-ENTER-publish-name').toBe(true);
});

test('AC-ENTER-report-email Email typed, Enter, Same as submit, once', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-ENTER-report-email').toBe(true);
});
