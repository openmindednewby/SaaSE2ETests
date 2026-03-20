import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for semantic color tokens in dark mode: admin pages.
 *
 * Verifies that status badges on integration and plugin admin pages
 * use theme-aware colors that adapt properly in dark mode.
 *
 * Pages tested:
 * - /admin/integrations: Connected/Disconnected badge colors
 * - /admin/plugins: Active/Inactive (enabled/disabled toggle) colors
 *
 * @tag @theme-studio @dark-mode @semantic-colors @bug-verification
 */

/**
 * Extract RGB components from a CSS color string.
 * Returns null if the color is transparent or unparseable.
 */
function parseRgb(
  colorStr: string,
): { r: number; g: number; b: number } | null {
  const match = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
}

/**
 * Verify that two badge CSS color values are visually distinct.
 * Computes the Euclidean distance between two RGB colors and
 * asserts it exceeds a minimum threshold.
 */
function colorsAreDistinct(colorA: string, colorB: string): boolean {
  const a = parseRgb(colorA);
  const b = parseRgb(colorB);
  if (!a || !b) return false;

  const MIN_DISTANCE = 30;
  const distance = Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2,
  );
  return distance >= MIN_DISTANCE;
}

// ===========================================================================
// Integrations Page: Connected vs Disconnected badges in dark mode
// ===========================================================================

test.describe(
  'Integrations: Dark mode semantic badge colors @theme-studio @dark-mode @semantic-colors',
  () => {
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
        await expect(page.locator('html.dark')).toBeVisible({ timeout: 3000 });
      }
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('should display connected and disconnected badges with distinct colors', async () => {
      await studioPage.gotoStudio('/admin/integrations');
      await expect(
        page.locator('[data-testid="admin-integrations-page"]'),
      ).toBeVisible({ timeout: 10000 });

      // Slack is connected, Teams is disconnected
      const slackCard = page.locator(
        '[data-testid="admin-integrations-card-slack"]',
      );
      const teamsCard = page.locator(
        '[data-testid="admin-integrations-card-teams"]',
      );

      await expect(slackCard).toBeVisible();
      await expect(teamsCard).toBeVisible();

      // Get the badge elements inside each card (rounded-full spans)
      const connectedBadge = slackCard.locator('[class*="rounded-full"]');
      const disconnectedBadge = teamsCard.locator('[class*="rounded-full"]');

      const connectedBg = await connectedBadge.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );
      const disconnectedBg = await disconnectedBadge.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      // Both should have defined background colors
      expect(
        connectedBg,
        'Connected badge should have a background color',
      ).not.toBe('rgba(0, 0, 0, 0)');
      expect(
        disconnectedBg,
        'Disconnected badge should have a background color',
      ).not.toBe('rgba(0, 0, 0, 0)');

      // The two badge colors should be visually distinct
      expect(
        colorsAreDistinct(connectedBg, disconnectedBg),
        `Connected (${connectedBg}) and disconnected (${disconnectedBg}) badges should have distinct colors in dark mode`,
      ).toBe(true);
    });

    test('should have readable text on connected badges in dark mode', async () => {
      const slackCard = page.locator(
        '[data-testid="admin-integrations-card-slack"]',
      );
      const badge = slackCard.locator('[class*="rounded-full"]');

      const textColor = await badge.evaluate(
        (el) => window.getComputedStyle(el).color,
      );
      const bgColor = await badge.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      const textRgb = parseRgb(textColor);
      const bgRgb = parseRgb(bgColor);

      // Text and background must be distinct enough to be readable
      if (textRgb && bgRgb) {
        const distance = Math.sqrt(
          (textRgb.r - bgRgb.r) ** 2 +
            (textRgb.g - bgRgb.g) ** 2 +
            (textRgb.b - bgRgb.b) ** 2,
        );
        expect(
          distance,
          `Badge text (${textColor}) must contrast against background (${bgColor})`,
        ).toBeGreaterThan(50);
      }
    });
  },
);

// ===========================================================================
// Plugins Page: Enabled vs Disabled toggle colors in dark mode
// ===========================================================================

test.describe(
  'Plugins: Dark mode semantic toggle colors @theme-studio @dark-mode @semantic-colors',
  () => {
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
        await expect(page.locator('html.dark')).toBeVisible({ timeout: 3000 });
      }
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('should display enabled and disabled plugin toggles with distinct colors', async () => {
      await studioPage.gotoStudio('/admin/plugins');
      await expect(
        page.locator('[data-testid="admin-plugins-page"]'),
      ).toBeVisible({ timeout: 10000 });

      // advanced-analytics is enabled, pdf-generator is disabled
      const enabledToggle = page.locator(
        '[data-testid="admin-plugins-toggle-advanced-analytics"]',
      );
      const disabledToggle = page.locator(
        '[data-testid="admin-plugins-toggle-pdf-generator"]',
      );

      await expect(enabledToggle).toBeVisible();
      await expect(disabledToggle).toBeVisible();

      const enabledBg = await enabledToggle.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );
      const disabledBg = await disabledToggle.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );

      // Both must have defined backgrounds
      expect(enabledBg, 'Enabled toggle must have a background').not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(disabledBg, 'Disabled toggle must have a background').not.toBe(
        'rgba(0, 0, 0, 0)',
      );

      // The two toggle states should be visually distinct
      expect(
        colorsAreDistinct(enabledBg, disabledBg),
        `Enabled (${enabledBg}) and disabled (${disabledBg}) toggles should have distinct colors in dark mode`,
      ).toBe(true);
    });

    test('should have correct aria-checked attribute on enabled toggle', async () => {
      const enabledToggle = page.locator(
        '[data-testid="admin-plugins-toggle-advanced-analytics"]',
      );
      await expect(enabledToggle).toHaveAttribute('aria-checked', 'true');
    });

    test('should have correct aria-checked attribute on disabled toggle', async () => {
      const disabledToggle = page.locator(
        '[data-testid="admin-plugins-toggle-pdf-generator"]',
      );
      await expect(disabledToggle).toHaveAttribute('aria-checked', 'false');
    });
  },
);
