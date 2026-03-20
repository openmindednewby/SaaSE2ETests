import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Dark Mode: Theme Toggle in the SyncfusionThemeStudio app.
 *
 * Verifies:
 * - Theme toggle button is present and functional
 * - Dark mode applies correct background and text colors
 * - Toggle switches back to light mode correctly
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
// Dark Mode: Theme Toggle
// ===========================================================================

test.describe.serial('Dark Mode: Theme Toggle @theme-studio @dark-mode', () => {
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

  test('should have a theme toggle button in the header', async () => {
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    await expect(themeToggle).toBeVisible();
  });

  test('should toggle to dark mode when theme toggle is clicked', async () => {
    const themeToggle = page.locator('[data-testid="theme-toggle"]');

    // Check current mode
    const wasInDarkMode = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    await themeToggle.click();

    // Verify the mode changed
    const isInDarkModeAfter = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    expect(
      isInDarkModeAfter,
      'Theme should change after toggling',
    ).toBe(!wasInDarkMode);
  });

  test('should apply dark background colors after toggling to dark mode', async () => {
    // Ensure we are in dark mode
    const isInDarkMode = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    if (!isInDarkMode) {
      const themeToggle = page.locator('[data-testid="theme-toggle"]');
      await themeToggle.click();
    }

    // Verify main content area has dark background
    const mainBg = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      return window.getComputedStyle(main).backgroundColor;
    });

    expect(
      isDarkColor(mainBg),
      `Main content should have dark background in dark mode, got: ${mainBg}`,
    ).toBe(true);
  });

  test('should apply theme-aware text colors in dark mode', async () => {
    // Ensure we are in dark mode
    const isInDarkMode = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    if (!isInDarkMode) {
      const themeToggle = page.locator('[data-testid="theme-toggle"]');
      await themeToggle.click();
    }

    // Check that headings have light text color in dark mode
    const headingColor = await page.evaluate(() => {
      const heading = document.querySelector('h1, h2, h3');
      if (!heading) return 'no-heading';
      return window.getComputedStyle(heading).color;
    });

    if (headingColor !== 'no-heading') {
      const rgbMatch = headingColor.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
      );
      if (rgbMatch) {
        const r = Number(rgbMatch[1]) / 255;
        const g = Number(rgbMatch[2]) / 255;
        const b = Number(rgbMatch[3]) / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        expect(
          luminance,
          `Heading text should be light in dark mode (luminance > 0.3), got: ${headingColor}`,
        ).toBeGreaterThan(0.3);
      }
    }
  });

  test('should toggle back to light mode correctly', async () => {
    // Toggle back to light mode if we are in dark mode
    const isInDarkMode = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );

    if (isInDarkMode) {
      const themeToggle = page.locator('[data-testid="theme-toggle"]');
      await themeToggle.click();
    }

    const isInLightMode = await page.evaluate(
      () => !document.documentElement.classList.contains('dark'),
    );
    expect(isInLightMode, 'Should be in light mode after toggle').toBe(true);
  });
});
