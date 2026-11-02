import { expect, test, type Locator, type Page } from '@playwright/test';

import { DESKTOP, livePatternSlug, NO_MATCH_QUERY, PHONE, recordWrites, rejectConsent } from './helpers/screens';

const VIEWPORTS = [
  { label: '360x640', use: PHONE, wide: false },
  { label: '1280x800', use: DESKTOP, wide: true },
];

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await rejectConsent(page);
}

async function expectAction(target: Locator, href?: RegExp): Promise<void> {
  await expect(target).toBeVisible();
  if (href !== undefined) await expect(target).toHaveAttribute('href', href);
  await target.click({ trial: true });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`Home at ${viewport.label}, inventory rows 1-6, every field and link is there and reachable`, async ({ page }) => {
      const writes = recordWrites(page);
      await open(page, '/');

      const prose = page.locator('.prose');

      await expect(prose.locator('h1')).toBeVisible();
      await expect(prose.locator('.lead')).toBeVisible();
      await expectAction(page.getByTestId('browse-search-submit'));
      await expect(page.getByTestId('browse-search-input')).toBeVisible();
      for (const stitch of ['peyote', 'brick', 'loom']) await expectAction(prose.locator(`.hubs a[href="/browse?stitch=${stitch}"]`));
      await expectAction(prose.locator('.wall a').first(), /^\/browse/);
      await expectAction(prose.locator('a[href="/guides"]'));
      await expect(page).toHaveTitle(/Jinx Bead Patterns/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
      expect(writes).toEqual([]);
    });

    test(`Browse at ${viewport.label}, inventory rows 7-17, every filter, card field and link is there and reachable`, async ({ page }) => {
      const writes = recordWrites(page);
      await open(page, '/browse');

      const card = page.getByTestId('pattern-card').first();

      await expect(page.getByTestId('browse-search-input')).toBeVisible();
      await expect(page.locator('.search-form select')).toHaveCount(3);
      await expectAction(page.locator('.wall a').first(), /^\/browse/);
      await expect(card.locator('.thumb img')).toHaveAttribute('src', /^\/thumbs\//);
      await expect(card.locator('.thumb img')).toBeVisible();
      await expectAction(card.locator('.fav'), /\/saved\?add=/);
      await expectAction(card.locator('.card-name a'), /^\/patterns\//);
      await expect(card.locator('.card-meta')).toHaveCount(2);
      await expect(card.locator('.codes span').first()).toBeVisible();
      await expect(card.locator('.codes .dot').first()).toBeVisible();
      await expect(page.getByTestId('ad-slot')).toBeAttached();
      await expectAction(page.getByTestId('browse-guides'), /^\/guides$/);
      await expectAction(page.locator('.pager a[rel="next"]'), /page=2/);
      expect(writes).toEqual([]);
    });

    test(`Browse at ${viewport.label}, stitch filter, narrows the list through the URL`, async ({ page }) => {
      await open(page, '/browse');

      if (viewport.wide) await page.locator('.chips a[href*="stitch=peyote"]').click();
      else await page.locator('select[name="stitch"]').selectOption('peyote');

      await expect(page).toHaveURL(/stitch=peyote/);
    });

    test(`Browse empty at ${viewport.label}, inventory row 18, clear, make and closest are there`, async ({ page }) => {
      await open(page, `/browse?q=${NO_MATCH_QUERY}`);

      await expectAction(page.getByTestId('clear-filters'), /^\/browse$/);
      await expectAction(page.locator('.state-actions a.secondary'), /\/make$/);
      await expect(page.getByTestId('closest-card').first()).toBeVisible();
    });

    test(`Browse unavailable at ${viewport.label}, inventory row 19, Try again is there and the status is 503`, async ({ page }) => {
      test.skip(process.env.JINX_SITE_STUB !== '1', 'Needs the stub API');
      const stub = process.env.JINX_STUB_URL;
      await page.request.get(`${stub}/__down?on=1`);

      const response = await page.goto(`/browse?q=unseen-${viewport.label}`);

      await expect(page.locator('a.primary[autofocus]')).toBeVisible();
      await page.request.get(`${stub}/__down?on=0`);
      expect(response?.status()).toBe(503);
    });

    test(`Site frame at ${viewport.label}, inventory rows 20-22, logo, menu, Sign in and footer are there and reachable`, async ({ page }) => {
      await open(page, '/browse');

      const menu = page.locator(viewport.wide ? '.top nav a' : '.btm a');

      await expectAction(page.locator('.top .logo'), /^\/$/);
      await expectAction(page.locator('.top .who'), /\/login$/);
      await expectAction(menu.nth(0), /^\/browse$/);
      await expectAction(menu.nth(1), /\/make$/);
      await expectAction(menu.nth(2), /\/saved$/);
      await expectAction(page.locator('.foot a[href="/guides"]'));
      await expectAction(page.locator('.foot a[href="/attribution"]').first());
      await expectAction(page.locator('.foot a[href="/privacy"]'));
      await expectAction(page.locator('.foot a[href^="mailto:"]'));
    });

    test(`Pattern at ${viewport.label}, page rows p1-p6, every field and action is there and reachable`, async ({ page }) => {
      const writes = recordWrites(page);
      await open(page, `/patterns/${await livePatternSlug(page.request)}`);

      await expect(page.locator('.detail-head h1')).toBeVisible();
      await expect(page.locator('[data-testid="pattern-chart"] svg').first()).toBeVisible();
      await expectAction(page.getByTestId('start-tracker'), /\/tracker\?id=/);
      await expectAction(page.locator('a[href*="/recolour?id="]'));
      await expectAction(page.locator('.fav-btn'), /\/saved\?add=/);
      await expect(page.locator('.block-words .word-row').first()).toBeAttached();
      await expect(page.locator('.block-colours')).toBeAttached();
      await expect(page.locator('.block-howto .steps li').first()).toBeAttached();
      await expectAction(page.locator('.block-howto a[href^="/guides/"]'));
      await expect(page.getByTestId('ad-slot')).toBeAttached();
      await expect(page.getByTestId('pattern-licence')).toBeVisible();
      await expectAction(page.locator('.block-rest a[href="/attribution"]'));
      expect(writes).toEqual([]);
    });
  });
}
