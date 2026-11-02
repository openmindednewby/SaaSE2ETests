import { expect, test } from '@playwright/test';

import { livePatternSlug } from './helpers/screens';

const SITE = 'https://jinx.dloizides.com';
const TITLE_PATTERN = /<title>[^<]+: free (peyote|brick|loom) bead pattern \| Jinx Bead Patterns<\/title>/;

test('AC-19 Pattern page, Fetch without JS, Self canonical, title pattern from ## Brand, OG tags, JSON-LD, chart SVG in HTML', async ({ request }) => {
  const slug = await livePatternSlug(request);

  const response = await request.get(`/patterns/${slug}`);

  const html = await response.text();
  expect(response.status()).toBe(200);
  expect.soft(html).toContain(`<link rel="canonical" href="${SITE}/patterns/${slug}"`);
  expect.soft(html).toMatch(TITLE_PATTERN);
  expect.soft(html).toContain('property="og:title"');
  expect.soft(html).toContain('property="og:description"');
  expect.soft(html).toContain(`property="og:url" content="${SITE}/patterns/${slug}"`);
  expect.soft(html).toContain('application/ld+json');
  expect.soft(html).toContain('"@type":"HowTo"');
  expect.soft(html).toMatch(/data-testid="pattern-chart">[\s\S]*?<svg/);
});
