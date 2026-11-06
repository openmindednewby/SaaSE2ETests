import { devices, expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { APP_URL } from './helpers/tracker';

const { defaultBrowserType: _phoneBrowser, ...pixel } = devices['Pixel 5'];
const { defaultBrowserType: _desktopBrowser, ...desktopChrome } = devices['Desktop Chrome'];
const PHONE_360 = { ...pixel, viewport: { width: 360, height: 640 } };
const DESKTOP_1280 = { ...desktopChrome, viewport: { width: 1280, height: 800 } };
const VIEWPORTS = [
  { label: '360x640', use: PHONE_360 },
  { label: '1280x800', use: DESKTOP_1280 },
];

const MIN_PRESETS = 100;
const FAMILIES = ['Bands', 'Tiles', 'Figures', 'Free'];
const USER_WIDTH = '17';
const NEWEST_TRAIL_TILE = 'jinx-generator-trail-0';

interface FormSnapshot {
  stitch: string;
  motif: string;
  width: string;
  rows: string;
  colours: string;
  variation: string;
}

async function openMake(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/make`);
  await expect(page.getByTestId('jinx-generator-form'), '/make did not render the generator form').toBeVisible();
}

async function snapshot(page: Page): Promise<FormSnapshot> {
  const text = async (id: string): Promise<string> => (await page.getByTestId(id).innerText()).trim();
  const value = async (id: string): Promise<string> => page.getByTestId(id).inputValue();
  return {
    stitch: await text('jinx-generator-stitch-trigger'),
    motif: await text('jinx-generator-motif-trigger'),
    width: await value('jinx-generator-width'),
    rows: await value('jinx-generator-rows'),
    colours: await text('jinx-generator-colours-trigger'),
    variation: await value('jinx-generator-variation'),
  };
}

async function box(locator: Locator, name: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  expect(found, `${name} has no layout box`).not.toBeNull();
  return found ?? { x: 0, y: 0, width: 0, height: 0 };
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-SHP-1 /make Presets at ${viewport.label}, opened anonymously, the mode chip counts at least ${MIN_PRESETS} presets and the family chips are ${FAMILIES.join(', ')}`, async ({ page }) => {
      await openMake(page);
      const families = page.getByTestId('jinx-generator-preset-family');

      const modeLabel = await page.getByTestId('jinx-generator-shape-mode').getByText(/^Presets \d+$/).innerText();

      const presetCount = Number(modeLabel.replace(/\D/g, ''));
      expect(presetCount, `mode chip reads "${modeLabel}"`).toBeGreaterThanOrEqual(MIN_PRESETS);
      for (const family of FAMILIES) {
        await expect(families.getByText(family, { exact: true }), `family chip ${family} missing`).toBeVisible();
      }
    });

    for (const family of FAMILIES) {
      test(`AC-SHP-1 /make family chip ${family} at ${viewport.label}, tapped, shows at least one preset tile`, async ({ page }) => {
        await openMake(page);
        const families = page.getByTestId('jinx-generator-preset-family');
        const tiles = page.getByTestId('jinx-generator-preset').locator('[data-testid^="jinx-generator-preset-"]:not([data-testid$="-chart"])');

        await families.getByText(family, { exact: true }).click();

        await expect(tiles.first(), `no preset tile after tapping ${family}`).toBeVisible();
      });
    }

    test(`AC-SHP-3 Shuffle at ${viewport.label}, with width set to ${USER_WIDTH} by the user, keeps width ${USER_WIDTH} and changes the other fields`, async ({ page }) => {
      await openMake(page);
      await page.getByTestId('jinx-generator-width').fill(USER_WIDTH);
      const before = await snapshot(page);

      await page.getByTestId('jinx-generator-shuffle').click();

      await expect(page.getByTestId('jinx-generator-width'), 'Shuffle overwrote the width the user set').toHaveValue(USER_WIDTH);
      await expect.poll(async () => {
        const { width: _width, ...after } = await snapshot(page);
        const { width: _before, ...was } = before;
        return JSON.stringify(after) !== JSON.stringify(was);
      }, { message: `Shuffle changed none of the unlocked fields, was ${JSON.stringify(before)}` }).toBe(true);
    });

    test(`AC-SHP-4 trail at ${viewport.label}, after one Shuffle, tapping the newest tile restores the chart Shuffle left`, async ({ page }) => {
      await openMake(page);
      const original = await snapshot(page);
      const originalResult = await page.getByTestId('jinx-generator-result').innerText();
      await page.getByTestId('jinx-generator-shuffle').click();
      await expect(page.getByTestId(NEWEST_TRAIL_TILE), 'Shuffle left no trail tile').toBeVisible();

      await page.getByTestId(NEWEST_TRAIL_TILE).click();

      await expect.poll(async () => snapshot(page), { message: 'trail tile did not restore the form' }).toEqual(original);
      await expect(page.getByTestId('jinx-generator-result'), 'trail tile did not restore the chart').toHaveText(originalResult);
    });
  });
}

test.describe('360x640 placement', () => {
  test.use(PHONE_360);

  test('AC-SHP-5 Shuffle bar at 360x640, on open, sits above the source tabs', async ({ page }) => {
    await openMake(page);

    const bar = await box(page.getByTestId('jinx-generator-shuffle-bar'), 'Shuffle bar');
    const tabs = await box(page.getByTestId('jinx-generator-source-motif'), 'Motif tab');

    expect(bar.y + bar.height, `bar bottom ${bar.y + bar.height} is below the tabs top ${tabs.y}`).toBeLessThanOrEqual(tabs.y);
  });

  test('AC-SHP-5 Shuffle bar at 360x640, scrolled down to Generate chart, stays pinned on screen', async ({ page }) => {
    test.fail(true, 'D-SHP-3 Q5 C pinned bar: visual-qa 2026-11-06 found the phone bar scrolls away; red until the pinned-bar fix deploys');
    await openMake(page);
    const viewportHeight = PHONE_360.viewport.height;

    await page.getByTestId('jinx-generator-generate').scrollIntoViewIfNeeded();

    const bar = await box(page.getByTestId('jinx-generator-shuffle'), 'Shuffle button');
    expect(bar.y, `Shuffle top ${bar.y} scrolled above the screen`).toBeGreaterThanOrEqual(0);
    expect(bar.y + bar.height, `Shuffle bottom ${bar.y + bar.height} is below the ${viewportHeight}px screen`).toBeLessThanOrEqual(viewportHeight);
  });
});

test.describe('1280x800 placement', () => {
  test.use(DESKTOP_1280);

  test('AC-SHP-5 Shuffle bar at 1280x800, on open, sits under the generator form', async ({ page }) => {
    await openMake(page);

    const bar = await box(page.getByTestId('jinx-generator-shuffle-bar'), 'Shuffle bar');
    const form = await box(page.getByTestId('jinx-generator-form'), 'generator form');

    expect(bar.y, `bar top ${bar.y} is above the form bottom ${form.y + form.height}`).toBeGreaterThanOrEqual(form.y + form.height);
  });
});
