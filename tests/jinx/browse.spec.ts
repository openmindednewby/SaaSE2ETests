import { expect, test } from '@playwright/test';

test('AC-01 Live patterns in 3 stitches, GET /browse?stitch=peyote, Only peyote cards in HTML, without JS', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-01').toBe(true);
});

test('AC-02 Query matches 1 title, Search, That one result; no match shows the empty state', async ({ request }) => {
  expect(false, 'ACCEPTANCE-PENDING: AC-02').toBe(true);
});
