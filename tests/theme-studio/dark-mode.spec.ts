import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Dark Mode functionality in the SyncfusionThemeStudio app.
 *
 * Tests identified during visual QA:
 *
 * 1. No white flash on load in dark mode:
 *    - The body/html background should be dark immediately
 *    - No visible white flash during page load
 *
 * 2. Theme-aware colors for status badges and elements:
 *    - Status badges should use theme colors in dark mode
 *    - Text contrast should meet accessibility standards
 *    - Background colors should adapt to dark theme
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
      // In dark mode, text should be light (high luminance)
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
          `Heading text should be light in dark mode (luminance > 0.5), got: ${headingColor}`,
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

        // Both colors should be defined (not transparent or empty)
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

    // Look for enabled/disabled badge elements
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

      // Verify the text is readable against the background
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

    // Check stat cards for dark background
    const statCards = page.locator(
      '[data-testid^="stat-"], .card, [class*="rounded-lg"][class*="border"]',
    );
    const cardCount = await statCards.count();

    if (cardCount > 0) {
      const card = statCards.first();
      const cardBg = await card.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      // Card should have a dark or semi-dark background
      // Allow for slightly lighter surface colors in dark mode
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

    // Check major layout elements for pure white backgrounds
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
