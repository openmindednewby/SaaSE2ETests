import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { DESKTOP, recordWrites } from './helpers/screens';

const CARD_IMAGES = 'img[src*="/thumbs/"], [data-testid="pattern-card"] img';
const THUMB_LOAD_TIMEOUT_MS = 20_000;
const PIXEL = devices['Pixel 5'];
const PHONE = {
  userAgent: PIXEL.userAgent,
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: PIXEL.deviceScaleFactor,
  isMobile: PIXEL.isMobile,
  hasTouch: PIXEL.hasTouch,
};
const VIEWPORTS = [
  { label: '360x640', use: PHONE },
  { label: '1280x800', use: DESKTOP },
];
const PAGES = ['/', '/browse'];

interface ThumbReport {
  total: number;
  pending: string[];
  broken: string[];
}

function readThumbs(page: Page): Promise<ThumbReport> {
  return page.evaluate((selector) => {
    const images = [...document.querySelectorAll<HTMLImageElement>(selector)].filter((image) => image.getClientRects().length > 0);
    return {
      total: images.length,
      pending: images.filter((image) => !image.complete).map((image) => image.src),
      broken: images.filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src),
    };
  }, CARD_IMAGES);
}

async function scrollEveryThumbIn(page: Page): Promise<ThumbReport> {
  await page.evaluate(async (selector) => {
    for (const image of document.querySelectorAll<HTMLImageElement>(selector)) {
      image.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, CARD_IMAGES);
  await expect
    .poll(async () => (await readThumbs(page)).pending, { message: 'card images still not complete after scrolling them in', timeout: THUMB_LOAD_TIMEOUT_MS })
    .toEqual([]);
  return readThumbs(page);
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    for (const path of PAGES) {
      test(`${path} at ${viewport.label}, scroll every card image in, each is complete with naturalWidth above 0`, async ({ page }) => {
        const writes = recordWrites(page);
        await page.goto(path);

        const thumbs = await scrollEveryThumbIn(page);

        expect(thumbs.total, `${path} rendered no card image, so nothing was checked`).toBeGreaterThan(0);
        expect(thumbs.broken, `${path}: ${thumbs.broken.length} of ${thumbs.total} card images did not decode`).toEqual([]);
        expect(writes).toEqual([]);
      });
    }
  });
}

test('Control: one thumbnail answers 200 with a valueless XML attribute, scroll it in, the check reports exactly that image', async ({ page }) => {
  const invalidSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-bead><circle r="1"/></g></svg>';
  let poisonedUrl = '';
  await page.route('**/thumbs/**', async (route) => {
    if (poisonedUrl !== '') return route.fallback();
    poisonedUrl = route.request().url();
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: invalidSvg });
  });
  await page.goto('/browse');

  const thumbs = await scrollEveryThumbIn(page);

  expect(poisonedUrl).not.toBe('');
  expect(thumbs.broken).toEqual([poisonedUrl]);
});
