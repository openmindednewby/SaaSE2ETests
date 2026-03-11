import { BrowserContext, expect, Page, test } from '@playwright/test';

/**
 * Pricing Page Mobile Horizontal Overflow Verification.
 *
 * Verifies that the pricing page does not overflow horizontally at
 * 375px mobile viewport width.
 *
 * @tag @theme-studio @bug-verification
 */

const STUDIO_BASE_URL = 'http://localhost:4444';
const MOBILE_VIEWPORT_WIDTH = 375;
const MOBILE_VIEWPORT_HEIGHT = 812;

test.describe('Pricing Page Mobile Horizontal Overflow @theme-studio @bug-verification', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      viewport: {
        width: MOBILE_VIEWPORT_WIDTH,
        height: MOBILE_VIEWPORT_HEIGHT,
      },
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should not have horizontal overflow at 375px viewport width', async () => {
    await page.goto(`${STUDIO_BASE_URL}/pricing`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const pricingContent = page.locator(
      '[data-testid="pricing-cards"], main, [role="main"], .pricing',
    ).first();
    await expect(pricingContent).toBeVisible({ timeout: 15000 });

    const overflowData = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowAmount: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));

    expect(
      overflowData.hasOverflow,
      `No horizontal overflow at ${String(MOBILE_VIEWPORT_WIDTH)}px. ` +
      `scrollWidth=${String(overflowData.scrollWidth)}, clientWidth=${String(overflowData.clientWidth)}, ` +
      `overflow=${String(overflowData.overflowAmount)}px`,
    ).toBe(false);
  });

  test('should keep pricing cards within viewport at mobile width', async () => {
    await page.goto(`${STUDIO_BASE_URL}/pricing`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const pricingCards = page.locator('[data-testid="pricing-cards"]');
    const cardsExist = await pricingCards.count() > 0;

    if (cardsExist) {
      await expect(pricingCards).toBeVisible({ timeout: 10000 });

      const containerBox = await pricingCards.boundingBox();
      if (containerBox) {
        expect(
          containerBox.x + containerBox.width,
          `Pricing cards right edge should not exceed ${String(MOBILE_VIEWPORT_WIDTH)}px`,
        ).toBeLessThanOrEqual(MOBILE_VIEWPORT_WIDTH + 1);
      }
    }
  });
});
