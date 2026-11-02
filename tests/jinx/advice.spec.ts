import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { pretendSignedIn } from './helpers/live-api';
import { FLAG_APP_URL, pick, recordTraffic, VISIBLE_TEXT } from './helpers/photo';
import { DESKTOP, PHONE, readLayoutProblems } from './helpers/screens';
import { APP_URL } from './helpers/tracker';

const SKIN_INDEX = 2;
const OUTFIT_INDEX = 2;
const LIGHTING_NOTE = 'Never uploaded. Use daylight, with no filter.';
const SKIN_APPLIED = 'The first colour is set to stand out against the tone you picked.';
const CLAIM_ABOUT_LOOKS = /suits? you|flatter|your skin|you should|you must|must wear|looks? best|looks? good on|too (dark|pale|light|fair)|complexion|undertone/i;
const DELICA_CODE = /^DB-?\d+$/i;
const PALETTE_COUNTS = [2, 3, 4];
const PIECES = ['Bracelet', 'Earring', 'Necklace', 'Ring', 'Other'];
const NAV_ITEMS = ['colour', 'patterns', 'make', 'saved', 'favourites'];
const MIN_HIT_PX = 44;
const PHONE_WIDTH_PX = 360;

async function openAdvice(page: Page, base = APP_URL): Promise<void> {
  await page.goto(`${base}/colour`);
  await expect(page.getByTestId('jinx-advice-screen')).toBeVisible();
}

function palette(page: Page, count: number): Locator {
  return page.getByTestId(`jinx-advice-palettes-${count}`);
}

async function paletteCodes(page: Page, count: number): Promise<string[]> {
  const label = (await palette(page, count).getAttribute('aria-label')) ?? '';
  return label.split(':')[1].split(',').map((code) => code.trim());
}

async function paintOf(locator: Locator): Promise<string> {
  return locator.locator('div').first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function paletteColours(page: Page, count: number): Promise<string[]> {
  return palette(page, count).locator('div').evaluateAll((els) => {
    const beads = els.filter((el) => {
      const box = el.getBoundingClientRect();
      return Math.round(box.width) === 18 && Math.round(box.height) === 24;
    });
    return beads.map((el) => getComputedStyle(el).backgroundColor);
  });
}

async function figure(page: Page): Promise<{ shapes: string[]; beads: string[] }> {
  return page.getByTestId('jinx-advice-figure').evaluate((plate) => ({
    shapes: [...plate.querySelectorAll('path')].flatMap((path) => [getComputedStyle(path).fill, getComputedStyle(path).stroke]),
    beads: [...plate.querySelectorAll('rect')].map((rect) => getComputedStyle(rect).fill),
  }));
}

async function wornLayout(page: Page): Promise<string> {
  return page.getByTestId('jinx-advice-figure').evaluate((plate) => {
    const rects = [...plate.querySelectorAll('rect')].slice(0, 8);
    return rects.map((rect) => `${rect.getAttribute('x')},${rect.getAttribute('y')}`).join(';');
  });
}

test('AC-38 Skin tone by swatch, no photo, Submit, Advice works; lighting guidance shown with the photo option', async ({ page }) => {
  await openAdvice(page, FLAG_APP_URL);
  await expect(page.getByTestId('jinx-advice-skin-note')).toHaveText(LIGHTING_NOTE);
  await expect(page.getByTestId('jinx-advice-skin-photo')).toBeVisible();
  const noteBefore = await page.getByTestId('jinx-advice-note').innerText();

  await page.getByTestId(`jinx-advice-skin-${SKIN_INDEX}`).click();

  await expect(page.getByTestId('jinx-advice-note')).toContainText(SKIN_APPLIED);
  expect(noteBefore).not.toContain(SKIN_APPLIED);
  expect(await paletteCodes(page, 4)).toHaveLength(4);
});

test('AC-38 Default build with the photo flag off, Open advice, Swatches work and no photo option shows', async ({ page }) => {
  await openAdvice(page);
  await expect(page.getByTestId('jinx-advice-skin-photo')).toHaveCount(0);

  await page.getByTestId(`jinx-advice-skin-${SKIN_INDEX}`).click();

  await expect(page.getByTestId('jinx-advice-note')).toContainText(SKIN_APPLIED);
});

test('AC-37 Outfit colour, occasion, style, Submit, 3 palettes of Delica codes; wording is suggestion, never a claim about looks', async ({ page, context }) => {
  const traffic = await recordTraffic(page, context);
  await openAdvice(page);
  const before = await paletteCodes(page, 4);

  await page.getByTestId(`jinx-advice-outfit-${OUTFIT_INDEX}`).click();
  await pick(page, 'jinx-advice-occasion', 'evening');
  await pick(page, 'jinx-advice-style', 'bold');

  await expect(page.locator('[data-testid^="jinx-advice-palettes-"]')).toHaveCount(PALETTE_COUNTS.length);
  for (const count of PALETTE_COUNTS) {
    const codes = await paletteCodes(page, count);
    expect(codes).toHaveLength(count);
    for (const code of codes) expect(code).toMatch(DELICA_CODE);
  }
  expect(await paletteCodes(page, 4)).not.toEqual(before);
  const note = await page.getByTestId('jinx-advice-note').innerText();
  expect(note).toContain('A suggestion for a rust outfit for an evening out.');
  expect(note).toContain('Wear what you like.');
  expect((await page.getByTestId('jinx-advice-screen').innerText()).match(CLAIM_ABOUT_LOOKS)).toBeNull();
  expect(traffic.requests.filter((request) => !['GET', 'HEAD'].includes(request.method)).map((request) => request.url)).toEqual([]);
});

test('AC-39 Palette chosen, Render figure, SVG fills equal palette tokens per region; each piece type has one figure', async ({ page }) => {
  await openAdvice(page);
  const outfitPaint = await paintOf(page.getByTestId(`jinx-advice-outfit-${OUTFIT_INDEX}`));
  const skinPaint = await paintOf(page.getByTestId(`jinx-advice-skin-${SKIN_INDEX}`));

  await page.getByTestId(`jinx-advice-outfit-${OUTFIT_INDEX}`).click();
  await page.getByTestId(`jinx-advice-skin-${SKIN_INDEX}`).click();
  await palette(page, 3).click();

  const painted = await figure(page);
  const chosen = await paletteColours(page, 3);
  expect(chosen).toHaveLength(3);
  expect(painted.shapes).toContain(outfitPaint);
  expect(painted.shapes).toContain(skinPaint);
  expect(new Set(painted.beads)).toEqual(new Set(chosen));
  const layouts = new Set<string>();
  for (const piece of PIECES) {
    await pick(page, 'jinx-advice-piece', piece);
    layouts.add(await wornLayout(page));
  }
  expect(layouts.size).toBe(PIECES.length);
});

for (const viewport of [{ label: '360x640', use: PHONE }, { label: '1280x800', use: DESKTOP }]) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-51 advice default at ${viewport.label}, Walk, expectTextFits passes; no horizontal scroll; hit boxes >= 44`, async ({ page }) => {
      await openAdvice(page);

      const problems = await readLayoutProblems(page);

      expect.soft(problems).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });

    test(`AC-51 advice with skin, palette and photo option at ${viewport.label}, Walk, expectTextFits passes; no horizontal scroll; hit boxes >= 44`, async ({ page }) => {
      await openAdvice(page, FLAG_APP_URL);

      await page.getByTestId(`jinx-advice-skin-${SKIN_INDEX}`).click();
      await palette(page, 2).click();

      const problems = await readLayoutProblems(page);
      expect.soft(problems).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });
  });
}

test.describe('five-item nav', () => {
  test.use(PHONE);

  for (const screen of ['make', 'colour']) {
    test(`AC-51 signed-in nav on ${screen} at 360x640, Read the bottom bar, 5 items inside the screen, each 44 or more, text fits`, async ({ page }) => {
      await pretendSignedIn(page);

      await page.goto(`${APP_URL}/${screen}`);

      await expect(page.getByTestId('jinx-nav-favourites')).toBeVisible();
      for (const item of NAV_ITEMS) {
        const box = await page.getByTestId(`jinx-nav-${item}`).boundingBox();
        expect(box, `${item} has no box`).not.toBeNull();
        expect(box?.width ?? 0, item).toBeGreaterThanOrEqual(MIN_HIT_PX);
        expect(box?.height ?? 0, item).toBeGreaterThanOrEqual(MIN_HIT_PX);
        expect((box?.x ?? 0) + (box?.width ?? 0), item).toBeLessThanOrEqual(PHONE_WIDTH_PX);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH_PX);
      await expectTextFits(page, NAV_ITEMS.map((item) => `[data-testid="jinx-nav-${item}"] *`).join(','));
    });
  }
});
