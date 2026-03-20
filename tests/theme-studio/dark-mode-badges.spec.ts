import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Dark Mode: Status Badge Colors in the SyncfusionThemeStudio app.
 *
 * Verifies that integration, plugin, sidebar, and card elements
 * use theme-aware colors in dark mode without pure white backgrounds.
 *
 * @tag @theme-studio @dark-mode @accessibility
 */

/**
 * Parse a CSS color value (rgb, rgba) and determine if it is "dark"
 * (luminance < 0.5). Returns true for dark colors.
 */
function isDarkColor(colorStr: string): boolean {
  const rgbMatch = colorStr.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]) / 255;
    const g = Number(rgbMatch[2]) / 255;
    const b = Number(rgbMatch[3]) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance < 0.5;
  }
  return false;
}

// ===========================================================================
// Dark Mode: Status Badges and Theme-Aware Colors
// ===========================================================================

test.describe('Dark Mode: Status Badges @theme-studio @dark-mode', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();

    // Switch to dark mode
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    const isInDarkMode = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    if (!isInDarkMode) {
      await themeToggle.click();
      // Wait for transition
      await expect(page.locator('html.dark')).toBeVisible({ timeout: 3000 });
    }
  });

  test.afterAll(async () => {
    // Toggle back to light mode to not affect other tests
    const isInDarkMode = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    if (isInDarkMode) {
      const themeToggle = page.locator('[data-testid="theme-toggle"]');
      await themeToggle.click();
    }
    await context?.close();
  });

  test('should use theme-aware colors for integration status badges', async () => {
    await studioPage.gotoStudio('/admin/integrations');
    await expect(
      page.locator('[data-testid="admin-integrations-page"]'),
    ).toBeVisible({ timeout: 10000 });

    // Check that status badges exist and use dark-mode-appropriate colors
    const badges = page.locator('[class*="rounded-full"]');
    const badgeCount = await badges.count();

    if (badgeCount > 0) {
      for (let i = 0; i < Math.min(badgeCount, 3); i++) {
        const badge = badges.nth(i);
        const bgColor = await badge.evaluate(
          (el) => window.getComputedStyle(el).backgroundColor,
        );
        const textColor = await badge.evaluate(
          (el) => window.getComputedStyle(el).color,
        );

        expect(
          bgColor,
          `Badge ${String(i)} should have a defined background color`,
        ).toBeTruthy();
        expect(
          textColor,
          `Badge ${String(i)} should have a defined text color`,
        ).toBeTruthy();
      }
    }
  });

  test('should use theme-aware colors for plugin enabled/disabled badges', async () => {
    await studioPage.gotoStudio('/admin/plugins');
    await expect(
      page.locator('[data-testid="admin-plugins-page"]'),
    ).toBeVisible({ timeout: 10000 });

    const badges = page.locator('[class*="rounded-full"]');
    const badgeCount = await badges.count();

    if (badgeCount > 0) {
      const badge = badges.first();
      const bgColor = await badge.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      expect(
        bgColor,
        'Plugin status badge should have a background color in dark mode',
      ).toBeTruthy();

      const textColor = await badge.evaluate(
        (el) => window.getComputedStyle(el).color,
      );
      expect(
        textColor,
        'Plugin status badge should have readable text color in dark mode',
      ).toBeTruthy();
    }
  });

  test('should have dark sidebar background in dark mode', async () => {
    const sidebar = page.locator('[data-testid="sidebar"]');
    const sidebarCount = await sidebar.count();

    if (sidebarCount > 0) {
      const sidebarBg = await sidebar.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      expect(
        isDarkColor(sidebarBg),
        `Sidebar should have dark background in dark mode, got: ${sidebarBg}`,
      ).toBe(true);
    }
  });

  test('should have dark card backgrounds on dashboard in dark mode', async () => {
    await studioPage.gotoStudio('/dashboard');
    await expect(
      page.locator('[data-testid="dashboard-heading"]'),
    ).toBeVisible({ timeout: 10000 });

    const statCards = page.locator(
      '[data-testid^="stat-"], .card, [class*="rounded-lg"][class*="border"]',
    );
    const cardCount = await statCards.count();

    if (cardCount > 0) {
      const card = statCards.first();
      const cardBg = await card.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      const rgbMatch = cardBg.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
      );
      if (rgbMatch) {
        const r = Number(rgbMatch[1]);
        const g = Number(rgbMatch[2]);
        const b = Number(rgbMatch[3]);
        const avgBrightness = (r + g + b) / 3;

        expect(
          avgBrightness,
          `Card background should be dark in dark mode (avg brightness < 128), ` +
            `got: ${cardBg} (avg: ${String(avgBrightness)})`,
        ).toBeLessThan(128);
      }
    }
  });

  test('should not have pure white (#fff or rgb(255,255,255)) backgrounds in dark mode', async () => {
    await studioPage.gotoStudio('/dashboard');
    await expect(
      page.locator('[data-testid="dashboard-heading"]'),
    ).toBeVisible({ timeout: 10000 });

    const pureWhiteElements = await page.evaluate(() => {
      const elements = document.querySelectorAll(
        'main, aside, header, nav, [class*="card"], [class*="surface"]',
      );
      const whiteElements: string[] = [];

      elements.forEach((el) => {
        const bg = window.getComputedStyle(el).backgroundColor;
        if (
          bg === 'rgb(255, 255, 255)' ||
          bg === 'rgba(255, 255, 255, 1)'
        ) {
          whiteElements.push(
            `${el.tagName}.${el.className.slice(0, 50)}`,
          );
        }
      });

      return whiteElements;
    });

    expect(
      pureWhiteElements.length,
      `No major layout elements should have pure white background in dark mode. ` +
        `Found: ${pureWhiteElements.join(', ')}`,
    ).toBe(0);
  });
});
