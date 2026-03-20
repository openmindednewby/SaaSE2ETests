import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for semantic color tokens in dark mode: user and role management pages.
 *
 * Verifies that role badges and delete buttons on user and role management pages
 * use theme-aware colors that adapt properly in dark mode.
 *
 * Pages tested:
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
