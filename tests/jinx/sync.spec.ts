import { expect, test } from '@playwright/test';

test('AC-30 Same account, two browser contexts, A advances offline, syncs; B reloads, B sees A’s row; older write gets 409 and keeps the newer', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-30').toBe(true);
});
