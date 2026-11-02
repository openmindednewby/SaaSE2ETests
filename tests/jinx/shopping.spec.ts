import { expect, test } from '@playwright/test';

import { livePatternSlug } from './helpers/screens';

const LIST_ROW = /data-code="(DB\w+)" data-count="(\d+)"/g;
const KEY_ROW = /background:(#[0-9A-Fa-f]{6})[^>]*>\w+<\/span><\/td>\s*<td><span class="code">(DB\w+)</g;
const CHART = /data-testid="pattern-chart">[\s\S]*?<\/svg>/;

test('AC-18 Pattern, Read list, Code + quantity for each colour equal chart counts; Etsy search link; disclosure text present; affiliate tag empty until configured', async ({ request }) => {
  const slug = await livePatternSlug(request);

  const html = await (await request.get(`/patterns/${slug}`)).text();

  const listed = Object.fromEntries([...html.matchAll(LIST_ROW)].map((row) => [row[1], Number(row[2])]));
  const chart = CHART.exec(html)?.[0] ?? '';
  const counted = Object.fromEntries([...html.matchAll(KEY_ROW)].map((row) => [row[2], chart.split(`fill="${row[1]}"`).length - 1]));
  expect(Object.keys(listed).length).toBeGreaterThan(0);
  expect(listed).toEqual(counted);
  for (const code of Object.keys(listed)) expect.soft(html).toContain(`https://www.etsy.com/search?q=Miyuki+Delica+${code}`);
  expect.soft(html).not.toMatch(/etsy\.com\/search[^"]*[?&](ref|tag|aff)[^"]*=/);
  expect.soft(html).toContain('data-testid="affiliate-disclosure"');
});
