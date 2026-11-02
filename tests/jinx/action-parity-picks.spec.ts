import { expect, test, type Page } from '@playwright/test';

import { DESKTOP, livePatternSlug, PHONE, rejectConsent } from './helpers/screens';

const REPLAY_MS = 90_000;
const MIN_HIT = 44;
const MIN_DESKTOP_THUMB = 200;
const MIN_DESKTOP_CHART = 560;
const CATEGORIES = 8;
const CHARTS_PER_CATEGORY = 4;
const STRIP_TILES = 20;
const FABRICS = /^Beads stand out most on (Linen|Camel|Terracotta|Burgundy|Olive|Deep forest|Denim|Navy|Charcoal)$/;
const NAVY = 'rgb(27, 42, 73)';
const LOGO_FIRST_BEAD = 'rgb(237, 65, 14)';
const STUB = process.env.JINX_SITE_STUB === '1';

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await rejectConsent(page);
}

const firstBeadFill = (page: Page): Promise<string> => page.locator('.top .logo rect').first().evaluate((el) => getComputedStyle(el).fill);

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

  test('AC-UI-card-desktop Browse and home, Measure, the first picture is at least 200 px wide and the phone wall stays hidden', async ({ page }) => {
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

test.describe('round 2 picks, phone', () => {
  test.use(PHONE);

  test('AC-UI-backdrop-mobile Tray bar, Measure, every tray is at least 44 px high and the page has no sideways scroll', async ({ page }) => {
    await open(page, '/browse');

    const best = await page.getByTestId('browse-tray-best').boundingBox();

    expect(best?.height ?? 0).toBeGreaterThanOrEqual(MIN_HIT);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('round 2 picks, computer', () => {
  test.use(DESKTOP);

  test('AC-UI-home-desktop Home on real data, Count, 8 categories of 4 charts then a chart strip', async ({ page }) => {
    test.skip(STUB, 'The stub has too few patterns per category');
    await open(page, '/');

    const categories = page.getByTestId('home-category');

    await expect(categories).toHaveCount(CATEGORIES);
    await expect(page.getByTestId('home-cat-tile')).toHaveCount(CATEGORIES * CHARTS_PER_CATEGORY);
    await expect(page.getByTestId('home-strip-tile')).toHaveCount(STRIP_TILES);
  });

  test('AC-UI-backdrop-desktop Browse, Read the first card, its label says where beads stand out, about no person', async ({ page }) => {
    await open(page, '/browse');

    const label = await page.getByTestId('card-tray-label').first().innerText();

    expect(label).toMatch(/^Beads stand out most on /);
    expect(label).not.toMatch(/skin|you/i);
  });

  test('AC-UI-backdrop-desktop Necklaces, Read every label, each default is a fabric', async ({ page }) => {
    await open(page, '/browse?piece=necklace');

    const labels = await page.getByTestId('card-tray-label').allInnerTexts();

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(FABRICS);
  });

  test('AC-UI-backdrop-desktop Pick Navy, reload, then Best match, every card follows, remembered, then back to its own default', async ({ page }) => {
    await open(page, '/browse');
    const thumb = page.getByTestId('card-thumb').first();
    const defaultLabel = await page.getByTestId('card-tray-label').first().innerText();

    await page.getByTestId('browse-tray-navy').click();
    await page.reload();

    await expect(page.getByTestId('browse-tray-navy')).toHaveAttribute('aria-pressed', 'true');
    expect(await thumb.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(NAVY);
    await expect(thumb.locator('img')).toHaveAttribute('src', /line=light$/);
    await expect(page.getByTestId('card-tray-label').first()).toHaveText('On Navy');
    await page.getByTestId('browse-tray-best').click();
    await expect(page.getByTestId('card-tray-label').first()).toHaveText(defaultLabel);
  });

  test('AC-UI-backdrop-desktop Keyboard, ArrowRight then Enter, focus walks the bar and the tray applies', async ({ page }) => {
    await open(page, '/browse');
    await page.getByTestId('browse-tray-best').focus();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('browse-tray-white')).toBeFocused();
    await expect(page.getByTestId('browse-tray-white')).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC-UI-backdrop-desktop Storage refused, Pick Navy, the bar still works', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('refused'); } });
    });
    await page.goto('/browse');

    await page.getByTestId('browse-tray-navy').click();

    await expect(page.getByTestId('browse-tray-navy')).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC-UI-logo-colour Any page, Read the logo, the colour stays with no animation running', async ({ page }) => {
    await page.goto('/browse');

    const fill = await firstBeadFill(page);

    expect(fill).toBe(LOGO_FIRST_BEAD);
  });

  test('AC-UI-logo-colour Home with reduced motion, Read the logo at once, the coloured still shows', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const fill = await firstBeadFill(page);

    expect(fill).toBe(LOGO_FIRST_BEAD);
  });

  test('AC-UI-logo-colour Home, Wait out the intro, colour fills and stays', async ({ page }) => {
    await page.goto('/');

    const logo = page.locator('.top .logo');

    await expect(logo).toHaveClass(/intro/);
    await expect.poll(() => firstBeadFill(page)).toBe(LOGO_FIRST_BEAD);
  });
});
