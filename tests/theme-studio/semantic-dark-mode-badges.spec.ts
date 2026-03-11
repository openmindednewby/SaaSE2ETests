import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for semantic color tokens in dark mode.
 *
 * Verifies that status badges across admin pages use theme-aware colors
 * that adapt properly when the user switches to dark mode.
 *
 * Pages tested:
 * - /admin/integrations: Connected/Disconnected badge colors
 * - /admin/plugins: Active/Inactive (enabled/disabled toggle) colors
 * - /admin/user-management: Role badges and delete button colors
 * - /admin/role-management: Role badges and delete button colors
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

// ===========================================================================
// User Management Page: Role badges and delete button colors in dark mode
// ===========================================================================

test.describe(
  'User Management: Dark mode role badges @theme-studio @dark-mode @semantic-colors',
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

    test('should display role badges with defined background colors in dark mode', async () => {
      await studioPage.gotoStudio('/admin/user-management');
      await expect(
        page.locator('[data-testid="admin-users-page"]'),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="admin-users-table"]'),
      ).toBeVisible({ timeout: 10000 });

      // Find role badge elements (rounded-full spans in the table)
      const badges = page.locator(
        '[data-testid="admin-users-table"] span[class*="rounded-full"]',
      );
      const badgeCount = await badges.count();
      expect(
        badgeCount,
        'User management table should have at least one role badge',
      ).toBeGreaterThan(0);

      // Check that at least the first badge has a non-transparent background
      const firstBadge = badges.first();
      const bgColor = await firstBadge.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );
      expect(
        bgColor,
        'Role badge should have a background color in dark mode',
      ).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('should display role badges with readable text colors in dark mode', async () => {
      const badges = page.locator(
        '[data-testid="admin-users-table"] span[class*="rounded-full"]',
      );
      const badgeCount = await badges.count();

      for (let i = 0; i < Math.min(badgeCount, 4); i++) {
        const badge = badges.nth(i);
        const textColor = await badge.evaluate(
          (el) => window.getComputedStyle(el).color,
        );
        const bgColor = await badge.evaluate(
          (el) => window.getComputedStyle(el).backgroundColor,
        );

        const textRgb = parseRgb(textColor);
        const bgRgb = parseRgb(bgColor);

        if (textRgb && bgRgb) {
          const distance = Math.sqrt(
            (textRgb.r - bgRgb.r) ** 2 +
              (textRgb.g - bgRgb.g) ** 2 +
              (textRgb.b - bgRgb.b) ** 2,
          );
          expect(
            distance,
            `Badge ${String(i)} text (${textColor}) should contrast against bg (${bgColor})`,
          ).toBeGreaterThan(40);
        }
      }
    });

    test('should use a red-family color for delete buttons in dark mode', async () => {
      // Delete buttons use text-red-500 or similar
      const deleteButtons = page.locator(
        '[data-testid="admin-users-table"] button',
      ).filter({ hasText: /delete/i });
      const count = await deleteButtons.count();

      if (count > 0) {
        const deleteColor = await deleteButtons.first().evaluate(
          (el) => window.getComputedStyle(el).color,
        );
        const rgb = parseRgb(deleteColor);
        if (rgb) {
          // Red channel should dominate for delete/danger styling
          expect(
            rgb.r,
            `Delete button color (${deleteColor}) should have strong red component`,
          ).toBeGreaterThan(rgb.g);
        }
      }
    });
  },
);

// ===========================================================================
// Role Management Page: Role type badges and delete button colors in dark mode
// ===========================================================================

test.describe(
  'Role Management: Dark mode role type badges @theme-studio @dark-mode @semantic-colors',
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

    test('should display built-in and custom role badges with distinct colors', async () => {
      await studioPage.gotoStudio('/admin/role-management');
      await expect(
        page.locator('[data-testid="role-management-page"]'),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="role-management-table"]'),
      ).toBeVisible({ timeout: 10000 });

      // Find role type badges (Built-in vs Custom)
      const badges = page.locator(
        '[data-testid="role-management-table"] span[class*="rounded-full"]',
      );
      const badgeCount = await badges.count();
      expect(
        badgeCount,
        'Role management table should have role type badges',
      ).toBeGreaterThan(0);

      // Collect unique badge background colors
      const bgColors: string[] = [];
      for (let i = 0; i < badgeCount; i++) {
        const badge = badges.nth(i);
        const bgColor = await badge.evaluate(
          (el) => window.getComputedStyle(el).backgroundColor,
        );
        if (!bgColors.includes(bgColor)) bgColors.push(bgColor);
      }

      // Should have at least 2 distinct colors (built-in vs custom)
      expect(
        bgColors.length,
        `Should have at least 2 distinct badge colors, got: ${bgColors.join(', ')}`,
      ).toBeGreaterThanOrEqual(2);
    });

    test('should display role badges with non-transparent backgrounds in dark mode', async () => {
      const badges = page.locator(
        '[data-testid="role-management-table"] span[class*="rounded-full"]',
      );
      const badgeCount = await badges.count();

      for (let i = 0; i < Math.min(badgeCount, 3); i++) {
        const badge = badges.nth(i);
        const bgColor = await badge.evaluate(
          (el) => window.getComputedStyle(el).backgroundColor,
        );
        expect(
          bgColor,
          `Role badge ${String(i)} should have visible background in dark mode`,
        ).not.toBe('rgba(0, 0, 0, 0)');
      }
    });

    test('should use danger-colored text for delete buttons in dark mode', async () => {
      // Delete buttons use text-status-error
      const deleteButtons = page.locator(
        '[data-testid^="role-management-delete-"]',
      );
      const count = await deleteButtons.count();

      if (count > 0) {
        const deleteColor = await deleteButtons.first().evaluate(
          (el) => window.getComputedStyle(el).color,
        );
        const rgb = parseRgb(deleteColor);
        if (rgb) {
          expect(
            rgb.r,
            `Delete button color (${deleteColor}) should have strong red component`,
          ).toBeGreaterThan(rgb.g);
        }
      }
    });
  },
);
