import { BrowserContext, expect, Page, test } from '@playwright/test';

import { MOBILE_REPRESENTATIVE, expectNoHorizontalOverflow } from '../../fixtures/mobile-gates.js';

/**
 * Pricing Page Mobile Horizontal Overflow Verification.
 *
 * Converged on the shared breakpoint module (MOBILE-STD-1 "mobile gates and
 * the shared breakpoint module", AC-3). This file used to carry its own
 * `375x812` bare viewport - the third independent mobile constant in the repo
 * - and its own overflow check against `clientWidth`, which cannot see a
 * widened layout viewport. Both now come from `fixtures/mobile-gates.ts`.
 *
 * @tag @theme-studio @bug-verification
 */

const STUDIO_BASE_URL = 'http://localhost:4444';
const MOBILE_VIEWPORT_WIDTH = MOBILE_REPRESENTATIVE.viewport.width;

test.describe('Pricing Page Mobile Horizontal Overflow @theme-studio @bug-verification', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ ...MOBILE_REPRESENTATIVE });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should not have horizontal overflow at phone width', async () => {
    await page.goto(`${STUDIO_BASE_URL}/pricing`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const pricingContent = page.locator(
      '[data-testid="pricing-cards"], main, [role="main"], .pricing',
    ).first();
    await expect(pricingContent).toBeVisible({ timeout: 15000 });

    await expectNoHorizontalOverflow(page, 'theme-studio /pricing');
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
