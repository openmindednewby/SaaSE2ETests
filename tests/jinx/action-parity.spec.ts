import { expect, test, type Locator, type Page } from '@playwright/test';

import { DESKTOP, livePatternSlug, NO_MATCH_QUERY, PHONE, recordWrites, rejectConsent } from './helpers/screens';

const VIEWPORTS = [
  { label: '360x640', use: PHONE, wide: false },
  { label: '1280x800', use: DESKTOP, wide: true },
];
const REPLAY_MS = 90_000;
const MIN_HIT = 44;
const MIN_DESKTOP_THUMB = 200;
const MIN_DESKTOP_CHART = 560;

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

test.describe('phone picks', () => {
  test.use(PHONE);

  test('AC-UI-home-mobile First visit, Open /, chart tiles sit at the top, search is focused and nothing scrolled', async ({ page }) => {
    await page.goto('/');

    const tile = page.getByTestId('home-wall-tile').first();

    await expect(tile).toBeVisible();
    expect((await tile.boundingBox())?.y ?? Infinity).toBeLessThan(PHONE.viewport.height);
    await expect(page.getByTestId('browse-search-input')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('AC-UI-card-mobile Default browse, Switch to 2 across and reload, starts one across, then two, remembered', async ({ page }) => {
    await open(page, '/browse');
    const cards = page.getByTestId('pattern-card');
    const two = page.getByTestId('browse-density-two');
    const across = async (): Promise<boolean> => ((await cards.nth(0).boundingBox())?.y ?? 0) === ((await cards.nth(1).boundingBox())?.y ?? 1);
    expect(await across()).toBe(false);
    expect((await two.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(MIN_HIT);

    await two.click();
    const afterClick = await across();
    await page.reload();

    expect(afterClick).toBe(true);
    expect(await across()).toBe(true);
    await expect(page.getByTestId('browse-density-two')).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC-UI-card-mobile Storage refused, Switch to 2 across, the switch still works', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('refused'); } });
    });
    await page.goto('/browse');

    await page.getByTestId('browse-density-two').click();

    await expect(page.getByTestId('browse-density-two')).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC-UI-chart-mobile Pattern with consent answered, Measure, the plate runs edge to edge, no sideways scroll, chart controls above the action bar', async ({ page }) => {
    await open(page, `/patterns/${await livePatternSlug(page.request)}`);

    const plate = await page.getByTestId('pattern-chart').boundingBox();

    const controlsBottom = await page.getByTestId('chart-next').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(controlsBottom).toBeLessThanOrEqual((await page.getByTestId('start-tracker').boundingBox())?.y ?? 0);
    expect(plate?.x).toBe(0);
    expect(plate?.width).toBe(PHONE.viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('MEDIUM Choose panel open at scroll 0, Tap Start, opens the tracker and not the bottom nav link', async ({ page }) => {
    await page.goto(`/patterns/${await livePatternSlug(page.request)}`);
    await page.getByTestId('cookie-consent-customize').click();
    const start = page.getByTestId('start-tracker');

    await expect(page.getByTestId('recolour')).toHaveAttribute('href', /recolour[?]id=/);
    const onTop = await start.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    await start.click({ force: true, position: { x: 8, y: 8 } });

    expect(onTop).toBe(true);
    await expect(page).toHaveURL(/\/tracker\?id=/);
  });

});

test.describe('computer picks', () => {
  test.use(DESKTOP);

  test('AC-UI-card-desktop Browse and home, Measure, the first picture is at least 200 px wide and home has no chart wall until D-BEAD-35', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-wall')).toBeHidden();
    await page.goto('/browse');

    const thumb = await page.locator('.thumb').first().boundingBox();

    expect(thumb?.width ?? 0).toBeGreaterThanOrEqual(MIN_DESKTOP_THUMB);
  });

  test('AC-UI-chart-desktop Pattern with consent answered, Measure the chart, is taller and whole', async ({ page }) => {
    await open(page, `/patterns/${await livePatternSlug(page.request)}`);

    const svg = await page.locator('[data-chart-window] svg').boundingBox();

    expect(svg?.height ?? 0).toBeGreaterThanOrEqual(MIN_DESKTOP_CHART);
  });

  test('AC-UI-chart-desktop Mouse, Hover then leave the chart, the zoom pane opens then closes', async ({ page }) => {
    await open(page, `/patterns/${await livePatternSlug(page.request)}`);
    const pane = page.getByTestId('chart-zoom-pane');

    await page.locator('[data-chart-window] svg').hover();
    const shown = await pane.isVisible();
    await page.locator('.detail-head h1').hover();

    expect(shown).toBe(true);
    await expect(pane).toBeHidden();
  });

  test('AC-UI-chart-desktop Keyboard, Enter on Zoom in, arrows move the view, Escape closes and returns focus', async ({ page }) => {
    await open(page, `/patterns/${await livePatternSlug(page.request)}`);
    const button = page.getByTestId('chart-zoom');
    const pane = page.getByTestId('chart-zoom-pane');
    const offset = (): Promise<string> => pane.locator('svg').evaluate((el) => (el as SVGElement).style.transform);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(pane).toBeVisible();
    const before = await offset();

    await page.keyboard.press('ArrowDown');
    const after = await offset();
    await page.keyboard.press('Escape');

    expect(after).not.toBe(before);
    await expect(pane).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('AC-UI-replay-desktop Idle visible page, 90 seconds pass, the logo replays without moving', async ({ page }) => {
    await page.clock.install();
    await page.goto('/browse');
    const logo = page.locator('.top .logo');
    const before = await logo.boundingBox();

    await page.clock.fastForward(REPLAY_MS);

    await expect(logo).toHaveClass(/intro/);
    expect(await logo.boundingBox()).toEqual(before);
  });

  test('AC-UI-replay-desktop Reduced motion, 90 seconds pass, the logo stays still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await page.goto('/browse');

    await page.clock.fastForward(REPLAY_MS);

    await expect(page.locator('.top .logo')).not.toHaveClass(/intro/);
  });
});

test.describe('touch on a wide screen', () => {
  test.use({ viewport: DESKTOP.viewport, hasTouch: true });

  test('AC-UI-chart-desktop Touch, Tap Zoom in then tap the chart, the pane stays open and follows the tap', async ({ page }) => {
    await open(page, `/patterns/${await livePatternSlug(page.request)}`);
    const pane = page.getByTestId('chart-zoom-pane');
    await page.getByTestId('chart-zoom').tap();
    await expect(pane).toBeVisible();
    const before = await pane.locator('svg').evaluate((el) => (el as SVGElement).style.transform);

    await page.locator('[data-chart-window] svg').tap();

    await expect(pane).toBeVisible();
    expect(await pane.locator('svg').evaluate((el) => (el as SVGElement).style.transform)).not.toBe(before);
  });
});
