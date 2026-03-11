import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * ExternalLink SVG Icon Sizing Bug Verification.
 *
 * Verifies that SVG icons inside ExternalLink components are reasonably
 * sized and do not render oversized (e.g., filling the entire viewport).
 *
 * @tag @theme-studio @bug-verification
 */

const MAX_ICON_DIMENSION_PX = 50;

test.describe('ExternalLink SVG Icon Sizing @theme-studio @bug-verification', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    await studioPage.gotoStudio('/components/externallink/native');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should render SVG icons at reasonable sizes (not oversized)', async () => {
    const svgElements = page.locator('svg');
    const svgCount = await svgElements.count();

    expect(
      svgCount,
      'Page should contain SVG elements for ExternalLink icons',
    ).toBeGreaterThan(0);

    for (let i = 0; i < svgCount; i++) {
      const svg = svgElements.nth(i);
      const boundingBox = await svg.boundingBox();

      if (boundingBox) {
        expect(
          boundingBox.width,
          `SVG ${String(i)} width (${String(boundingBox.width)}px) exceeds ${String(MAX_ICON_DIMENSION_PX)}px`,
        ).toBeLessThanOrEqual(MAX_ICON_DIMENSION_PX);

        expect(
          boundingBox.height,
          `SVG ${String(i)} height (${String(boundingBox.height)}px) exceeds ${String(MAX_ICON_DIMENSION_PX)}px`,
        ).toBeLessThanOrEqual(MAX_ICON_DIMENSION_PX);
      }
    }
  });

  test('should have explicit sizing on SVG icons', async () => {
    const svgElements = page.locator('svg');
    const svgCount = await svgElements.count();

    for (let i = 0; i < svgCount; i++) {
      const svg = svgElements.nth(i);
      const hasSizing = await svg.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const hasWidth = el.hasAttribute('width') || style.width !== 'auto';
        const hasHeight = el.hasAttribute('height') || style.height !== 'auto';
        return hasWidth && hasHeight;
      });

      expect(hasSizing, `SVG ${String(i)} should have explicit width and height`).toBe(true);
    }
  });
});
