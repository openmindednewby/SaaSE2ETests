import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { APP_URL } from './helpers/tracker';

const { defaultBrowserType: _phoneBrowser, ...pixel } = devices['Pixel 5'];
const { defaultBrowserType: _desktopBrowser, ...desktopChrome } = devices['Desktop Chrome'];
const VIEWPORTS = [
  { label: '360x640', use: { ...pixel, viewport: { width: 360, height: 640 } } },
  { label: '1280x800', use: { ...desktopChrome, viewport: { width: 1280, height: 800 } } },
];

const FIGURE_QUERY = 'fox';
const FIGURE_NAME = /fox/i;
const MIN_FIGURE_WIDTH = 40;

async function openFigures(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/make`);
  await expect(page.getByTestId('jinx-generator-form'), '/make did not render the generator form').toBeVisible();
  await page.getByTestId('jinx-generator-shape-mode').getByText('Figures', { exact: true }).click();
  await expect(page.getByTestId('jinx-generator-figure-search'), 'Figures mode shows no figure search').toBeVisible();
}

function figureTiles(page: Page, name: RegExp) {
  return page.getByTestId('jinx-generator-figure').locator('[data-testid^="jinx-generator-figure-"]').filter({ hasText: name });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-FIG-5 Figures mode at ${viewport.label}, searched for "${FIGURE_QUERY}", shows a fox figure tile`, async ({ page }) => {
      await openFigures(page);

      await page.getByTestId('jinx-generator-figure-search').fill(FIGURE_QUERY);

      await expect(figureTiles(page, FIGURE_NAME).first(), `no figure tile named like ${FIGURE_NAME} after searching "${FIGURE_QUERY}"`).toBeVisible();
    });

    test(`AC-FIG-5 fox figure at ${viewport.label}, picked, sets the chart width to at least ${MIN_FIGURE_WIDTH} beads`, async ({ page }) => {
      await openFigures(page);
      await page.getByTestId('jinx-generator-figure-search').fill(FIGURE_QUERY);
      const fox = figureTiles(page, FIGURE_NAME).first();
      await expect(fox, `no figure tile named like ${FIGURE_NAME}`).toBeVisible();

      await fox.click();

      const width = async (): Promise<number> => Number(await page.getByTestId('jinx-generator-width').inputValue());
      await expect.poll(width, { message: `picked figure did not set Width to ${MIN_FIGURE_WIDTH} or more` }).toBeGreaterThanOrEqual(MIN_FIGURE_WIDTH);
      await expect(page.getByTestId('jinx-generator-preview'), 'no chart preview after picking the figure').toBeVisible();
    });

    test(`AC-FIG-5 Upload your own at ${viewport.label}, tapped in Figures mode, opens the photo form`, async ({ page }) => {
      await openFigures(page);

      await page.getByTestId('jinx-generator-figure-upload').click();

      await expect(page.getByTestId('jinx-photo-form'), 'Upload your own did not open the Your photo form').toBeVisible();
    });
  });
}
