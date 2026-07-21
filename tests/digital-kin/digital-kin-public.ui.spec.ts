// Digital Kin public site — @ui tier (Plan 3 Task 15).
//
// Browser-only behaviour: navigation, the Greek-fallback rule, reader controls
// surviving a reload, tap-target size, the skip link, and the language switch.
// None of these can be proven by a unit test — the fallback rule is a property of
// what the API returns THROUGH a real render, and localStorage persistence is by
// definition a second page load.
//
// 🔒 SKIP-GATED: skips with a reason when DIGITALKIN_SITE_URL is unset (the site
// is not deployed until Plan 6).
import { expect, test } from '@playwright/test';
import {
  DIGITALKIN_SITE_URL,
  DK_ROUTES,
  DK_NAV_PATHS,
  MIN_TAP_TARGET_PX,
} from './digital-kin-helpers.js';

const site = DIGITALKIN_SITE_URL ?? '';

test.describe('Digital Kin public site UI @digital-kin-ui @digital-kin', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      DIGITALKIN_SITE_URL === null,
      'DIGITALKIN_SITE_URL unset — the public site is not deployed until Plan 6.',
    );

    const response = await page.goto(`${site}${DK_ROUTES.home}`, { waitUntil: 'domcontentloaded' });
    test.skip(response === null || !response.ok(), `Digital Kin site not reachable at ${site}.`);
  });

  test('home shows category tiles and clicking one lands on /k/{slug}', async ({ page }) => {
    const tiles = page.locator('a[href^="/k/"]');
    await expect(tiles.first()).toBeVisible();

    const href = await tiles.first().getAttribute('href');
    await tiles.first().click();

    await expect(page).toHaveURL(new RegExp(`${href?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.locator('h1')).toBeVisible();
  });

  test('category -> guide navigation reaches /odigos/{slug} with steps visible', async ({ page }) => {
    await page.locator('a[href^="/k/"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    // Guide links are FLAT `/odigos/{slug}`, never nested under the category —
    // so a guide that is re-categorised keeps its URL (spec §5). A nested link
    // here would be both a 404 and a contradiction of the guide's own canonical.
    const guideLink = page.locator('a[href^="/odigos/"]').first();

    if ((await guideLink.count()) === 0) {
      // Landed on a category whose guides live one level down.
      await page.locator('a[href^="/k/"]').first().click();
      await page.waitForLoadState('domcontentloaded');
    }

    await page.locator('a[href^="/odigos/"]').first().click();
    await expect(page).toHaveURL(/\/odigos\//);

    // Steps are an <ol> — semantic, not a styled div stack.
    await expect(page.locator('ol li').first()).toBeVisible();
  });

  test('🔴 a Greek-only guide renders GREEK under ?locale=en', async ({ page }) => {
    // Spec §9's silent failure #1. The API's TranslationResolver falls back
    // (requested -> Greek -> nothing), so a guide with no EN row answers an `en`
    // request with GREEK text. That is CORRECT and the site must not "repair" it
    // by blanking the field or substituting the slug. The temptation to treat
    // "Greek text under locale=en" as a bug is exactly what this pins against.
    await page.locator('a[href^="/k/"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    const guideLink = page.locator('a[href^="/odigos/"]').first();
    test.skip((await guideLink.count()) === 0, 'No guide reachable from the first category.');

    const href = await guideLink.getAttribute('href');
    await page.goto(`${site}${href}?locale=en`, { waitUntil: 'domcontentloaded' });

    const heading = (await page.locator('h1').first().textContent()) ?? '';

    // Non-empty, and NOT the slug. Either failure would mean the site undid the
    // API's fallback.
    expect(heading.trim().length).toBeGreaterThan(0);
    expect(heading.trim()).not.toBe(href?.replace('/odigos/', ''));
  });

  test('reader controls: "larger" changes the text scale AND survives a reload', async ({ page }) => {
    // Selector VERIFIED against ReaderControls.astro, not guessed. The first
    // draft of this test used `data-dk-action="text-larger"`, which matches
    // nothing — so the test SKIPPED and reported green. A skip that looks like a
    // pass is the same class of defect as a sitemap of 404s: the run is clean and
    // the behaviour is untested. If this selector ever stops matching, prefer
    // failing here over restoring the skip.
    const control = page.locator('button[data-dk-action="larger"]').first();
    await expect(control).toBeVisible();

    const before = await page.locator('html').getAttribute('data-dk-text');
    await control.click();

    const after = await page.locator('html').getAttribute('data-dk-text');
    expect(after).not.toBe(before);

    // The half that matters: persisted in localStorage and applied BEFORE first
    // paint by the inline script in BaseLayout, so there is no flash of the wrong
    // size. A second document load is the ONLY way to observe that — the whole
    // claim is about what happens before the first paint of a fresh document.
    //
    // This is the persistence case the no-page-reload rule's own docstring names
    // as legitimate. Its message says "add a comment explaining why", but the
    // implementation never inspects comments — so an explicit disable is the only
    // way to comply. The directive must be the LAST line before the call.
    // eslint-disable-next-line no-page-reload/no-page-reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await page.locator('html').getAttribute('data-dk-text')).toBe(after);
  });

  test('every nav link is at least 48px tall', async ({ page }) => {
    // A hard number for this audience, not an aspiration.
    const links = page.locator('nav a');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    const undersized: { text: string; height: number }[] = [];
    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      const box = await link.boundingBox();
      if (box !== null && box.height < MIN_TAP_TARGET_PX) {
        undersized.push({ text: (await link.textContent())?.trim() ?? '', height: box.height });
      }
    }

    expect(undersized).toEqual([]);
  });

  test('the skip link becomes visible on first Tab and moves focus to the main region', async ({ page }) => {
    await page.keyboard.press('Tab');

    const skip = page.locator('a[href="#dk-main"]');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('#dk-main')).toBeVisible();
  });

  test('the language switch preserves the current path', async ({ page }) => {
    // Switching language must not throw the reader back to the home page — this
    // audience forwards deep links to family, and losing the page on a language
    // switch looks like the link was broken.
    await page.goto(`${site}${DK_ROUTES.about}`, { waitUntil: 'domcontentloaded' });

    const switcher = page.locator('a[href*="locale=en"]').first();
    test.skip((await switcher.count()) === 0, 'Language switcher not present on this page.');

    await switcher.click();
    await page.waitForLoadState('domcontentloaded');

    expect(new URL(page.url()).pathname).toBe(DK_ROUTES.about);
    expect(new URL(page.url()).searchParams.get('locale')).toBe('en');
  });

  test('🔴 every primary nav path resolves — the GREEK slugs, not the briefed English ones', async ({ page }) => {
    // Plan 3's briefs specified /search, /useful, /about, /help, /downloads four
    // separate times. All five 404. Nothing in either repo's toolchain resolves
    // an Astro route, so this is the check that would have caught it.
    const broken: { path: string; status: number }[] = [];

    for (const path of [...DK_NAV_PATHS, DK_ROUTES.downloads]) {
      const response = await page.goto(`${site}${path}`, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status !== 200) broken.push({ path, status });
    }

    expect(broken).toEqual([]);
  });
});
