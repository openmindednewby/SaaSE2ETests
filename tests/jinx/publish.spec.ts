import { expect, test } from '@playwright/test';

import { BFF_API, WRITE_HEADERS } from './helpers/live-api';

test('AC-25 Signed-in user, verified email, Publish, Fetch without JS at once: 200 with index,follow; in sitemap within 60 s', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-25').toBe(true);
});

test('AC-25 anonymous publish, returns 401', async ({ request }) => {
  const data = { title: 'E2E anonymous' };

  const response = await request.post(`${BFF_API}/patterns`, { headers: WRITE_HEADERS, data });

  expect(response.status()).toBe(401);
});
