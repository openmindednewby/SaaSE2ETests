import { expect, test } from '@playwright/test';

import { BFF_API } from './helpers/live-api';

test('AC-30 Same account, two browser contexts, A advances offline, syncs; B reloads, B sees A’s row; older write gets 409 and keeps the newer', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-30').toBe(true);
});

test('AC-30 anonymous progress read, returns 401', async ({ request }) => {
  const url = `${BFF_API}/me/progress`;

  const response = await request.get(url);

  expect(response.status()).toBe(401);
});
