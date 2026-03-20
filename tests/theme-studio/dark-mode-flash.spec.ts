import { BrowserContext, expect, Page, test } from '@playwright/test';

/**
 * E2E Tests for Dark Mode: No White Flash on Load in the SyncfusionThemeStudio app.
 *
 * Verifies:
 * - The body/html background is dark immediately when dark mode is set
 * - A dark class or data attribute is present on the root element
 *
 * @tag @theme-studio @dark-mode @accessibility
 */

const STUDIO_BASE_URL = 'http://localhost:4444';

// ===========================================================================
// Helper functions
// ===========================================================================

/**
 * Parse a CSS color value (rgb, rgba, hex) and determine if it is "dark"
 * (luminance < 0.5). Returns true for dark colors.
 */
function isDarkColor(colorStr: string): boolean {
  // Handle rgb/rgba
  const rgbMatch = colorStr.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]) / 255;
    const g = Number(rgbMatch[2]) / 255;
    const b = Number(rgbMatch[3]) / 255;
    // Relative luminance formula
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance < 0.5;
  }
  // Handle transparent/empty
  if (
    colorStr === 'transparent' ||
    colorStr === '' ||
    colorStr === 'rgba(0, 0, 0, 0)'
  ) {
    return false;
  }
  return false;
}

// ===========================================================================
// Dark Mode: No White Flash on Load
// ===========================================================================

test.describe('Dark Mode: No White Flash @theme-studio @dark-mode', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;

  test.afterAll(async () => {
    await context?.close();
  });

  test('should load the app with dark background when dark mode is set', async ({ browser }) => {
    // Create a context with dark color scheme preference
    context = await browser.newContext({
      colorScheme: 'dark',
    });
    page = await context.newPage();

    // Navigate to the studio login page
    await page.goto(`${STUDIO_BASE_URL}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for the page to render
    await expect(
      page.locator('[data-testid="login-submit"]'),
    ).toBeVisible({ timeout: 15000 });

    // Check body/html background color is dark
    const bodyBgColor = await page.evaluate(() => {
      const body = document.body;
      const computed = window.getComputedStyle(body);
      return computed.backgroundColor;
    });

    const htmlBgColor = await page.evaluate(() => {
      const html = document.documentElement;
      const computed = window.getComputedStyle(html);
      return computed.backgroundColor;
    });

    // At least one of html or body should have a dark background
    const bodyIsDark = isDarkColor(bodyBgColor);
    const htmlIsDark = isDarkColor(htmlBgColor);

    expect(
      bodyIsDark || htmlIsDark,
      `Body or HTML should have a dark background color in dark mode. ` +
        `Got body: ${bodyBgColor}, html: ${htmlBgColor}`,
    ).toBe(true);
  });

  test('should have dark class or data attribute on root element in dark mode', async () => {
    // Most dark mode implementations use a class or data attribute
    const hasDarkIndicator = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;

      return (
        html.classList.contains('dark') ||
        body.classList.contains('dark') ||
        html.getAttribute('data-theme') === 'dark' ||
        body.getAttribute('data-theme') === 'dark' ||
        html.getAttribute('data-mode') === 'dark' ||
        body.getAttribute('data-mode') === 'dark' ||
        html.style.colorScheme === 'dark'
      );
    });

    expect(
      hasDarkIndicator,
      'Root element should have a dark mode indicator (class or data attribute)',
    ).toBe(true);
  });
});
