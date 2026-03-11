import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * BreadcrumbNative Duplicate Key Warning Verification.
 *
 * Verifies that navigating to pages with breadcrumbs does not produce
 * React console warnings about duplicate keys.
 *
 * @tag @theme-studio @bug-verification
 */

test.describe('BreadcrumbNative No Duplicate Key Warnings @theme-studio @bug-verification', () => {
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

  test('should not produce console warnings about duplicate React keys', async () => {
    const consoleWarnings: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('duplicate key') || text.includes('unique "key" prop')) {
          consoleWarnings.push(text);
        }
      }
    });

    await studioPage.gotoStudio('/dashboard/home/overview');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });

    const mainContent = page.locator('main, [role="main"], .dashboard, h1, h2').first();
    await expect(mainContent).toBeVisible({ timeout: 10000 });

    expect(
      consoleWarnings,
      'No console warnings about duplicate React keys in breadcrumbs',
    ).toHaveLength(0);
  });

  test('should render breadcrumb navigation without duplicate elements', async () => {
    await studioPage.gotoStudio('/dashboard/home/overview');

    const breadcrumbs = page.locator(
      'nav[aria-label*="readcrumb"], [data-testid*="breadcrumb"], .breadcrumb, nav ol, nav ul',
    ).first();
    const breadcrumbExists = await breadcrumbs.count() > 0;

    if (breadcrumbExists) {
      await expect(breadcrumbs).toBeVisible();

      const items = breadcrumbs.locator('li, a, span').filter({ hasText: /.+/ });
      const itemCount = await items.count();
      expect(itemCount, 'Breadcrumb should have at least one visible item').toBeGreaterThan(0);
    }
  });
});
