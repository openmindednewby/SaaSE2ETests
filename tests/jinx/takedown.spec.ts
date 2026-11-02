import { expect, test } from '@playwright/test';

import { BFF_API, WRITE_HEADERS } from './helpers/live-api';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000e2e';

test('AC-22 Live indexed pattern, Admin removes, Page 410 within 60 s, sitemap row gone, browse row gone', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-22').toBe(true);
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
