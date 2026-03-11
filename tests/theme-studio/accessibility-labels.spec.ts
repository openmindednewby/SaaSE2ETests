import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * Accessibility Label Verification for Grid, Calendar, and Role Management.
 *
 * Verifies that:
 * - Grid page form inputs have aria-label attributes
 * - Calendar icon-only buttons have aria-label attributes
 * - Role Management permission toggle inputs have aria-label attributes
 *
 * @tag @theme-studio @bug-verification @accessibility
 */

// ===========================================================================
// Grid Page - Form Input Accessibility Labels
// ===========================================================================

test.describe('Grid Page Accessibility Labels @theme-studio @bug-verification', () => {
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

  test.beforeEach(async () => {
    await studioPage.gotoStudio('/components/grid/native');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should have accessible labels on form inputs in the grid', async () => {
    const gridContent = page.locator(
      '[data-testid*="grid"], table, [role="grid"], .grid',
    ).first();
    await expect(gridContent).toBeVisible({ timeout: 10000 });

    const inputs = page.locator('input, select, textarea');
    const inputCount = await inputs.count();

    if (inputCount > 0) {
      const unlabeledInputs: string[] = [];

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        const isVisible = await input.isVisible();
        if (!isVisible) continue;

        const hasLabel = await input.evaluate((el) => {
          if (el.getAttribute('aria-label')) return true;
          if (el.getAttribute('aria-labelledby')) return true;
          if (el.closest('label')) return true;
          const id = el.getAttribute('id');
          if (id && document.querySelector(`label[for="${id}"]`)) return true;
          if (el.getAttribute('title')) return true;
          if (el.getAttribute('placeholder')) return true;
          return false;
        });

        if (!hasLabel) {
          const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
          const type = await input.getAttribute('type') || 'text';
          unlabeledInputs.push(`${tagName}[type=${type}]`);
        }
      }

      expect(
        unlabeledInputs.length,
        `All visible inputs should have accessible labels. Unlabeled: ${unlabeledInputs.join(', ')}`,
      ).toBe(0);
    }
  });
});

// ===========================================================================
// Calendar Page - Icon-Only Button Accessibility
// ===========================================================================

test.describe('Calendar Page Accessible Buttons @theme-studio @bug-verification', () => {
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

  test.beforeEach(async () => {
    await studioPage.gotoStudio('/calendar');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should have aria-label on icon-only buttons', async () => {
    const calendarContent = page.locator(
      '[data-testid*="calendar"], .calendar, [class*="calendar"], main',
    ).first();
    await expect(calendarContent).toBeVisible({ timeout: 10000 });

    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount, 'Calendar page should have buttons').toBeGreaterThan(0);

    const unlabeledButtons: string[] = [];

    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      const isVisible = await button.isVisible();
      if (!isVisible) continue;

      const isIconOnly = await button.evaluate((el) => {
        const text = el.textContent?.trim() || '';
        const hasSvg = el.querySelector('svg') !== null;
        const hasIcon = el.querySelector('i, [class*="icon"]') !== null;
        return (hasSvg || hasIcon) && text.length < 3;
      });

      if (isIconOnly) {
        const hasName = await button.evaluate((el) => {
          if (el.getAttribute('aria-label')) return true;
          if (el.getAttribute('aria-labelledby')) return true;
          if (el.getAttribute('title')) return true;
          const sr = el.querySelector('.sr-only, .visually-hidden, [class*="sr-only"]');
          if (sr && sr.textContent?.trim()) return true;
          return false;
        });

        if (!hasName) {
          const testId = await button.getAttribute('data-testid') || 'unknown';
          unlabeledButtons.push(`button[testid="${testId}"]`);
        }
      }
    }

    expect(
      unlabeledButtons.length,
      `All icon-only buttons should have aria-label. Unlabeled: ${unlabeledButtons.join(', ')}`,
    ).toBe(0);
  });
});

// ===========================================================================
// Role Management Page - Permission Toggle Accessibility
// ===========================================================================

test.describe('Role Management Accessible Inputs @theme-studio @bug-verification', () => {
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

  test.beforeEach(async () => {
    await studioPage.gotoStudio('/admin/role-management');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should have aria-label on permission toggle inputs', async () => {
    const pageContent = page.locator(
      '[data-testid*="role-management"], [data-testid*="role"], main',
    ).first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });

    const toggleInputs = page.locator(
      'input[type="checkbox"], input[role="switch"], [role="switch"]',
    );
    const toggleCount = await toggleInputs.count();

    if (toggleCount > 0) {
      const unlabeled: string[] = [];

      for (let i = 0; i < toggleCount; i++) {
        const toggle = toggleInputs.nth(i);
        const isVisible = await toggle.isVisible();
        if (!isVisible) continue;

        const hasName = await toggle.evaluate((el) => {
          if (el.getAttribute('aria-label')) return true;
          if (el.getAttribute('aria-labelledby')) return true;
          if (el.closest('label')) return true;
          const id = el.getAttribute('id');
          if (id && document.querySelector(`label[for="${id}"]`)) return true;
          if (el.getAttribute('title')) return true;
          return false;
        });

        if (!hasName) {
          const testId = await toggle.getAttribute('data-testid') || 'unknown';
          unlabeled.push(`toggle[testid="${testId}"]`);
        }
      }

      expect(
        unlabeled.length,
        `All toggles should have accessible labels. Unlabeled: ${unlabeled.join(', ')}`,
      ).toBe(0);
    }
  });

  test('should have descriptive aria-labels on permission toggles', async () => {
    const pageContent = page.locator(
      '[data-testid*="role-management"], [data-testid*="role"], main',
    ).first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });

    const labeled = page.locator(
      'input[type="checkbox"][aria-label], input[role="switch"][aria-label], [role="switch"][aria-label]',
    );
    const count = await labeled.count();

    for (let i = 0; i < count; i++) {
      const toggle = labeled.nth(i);
      const isVisible = await toggle.isVisible();
      if (!isVisible) continue;

      const ariaLabel = await toggle.getAttribute('aria-label');
      if (ariaLabel) {
        expect(
          ariaLabel.length,
          `aria-label "${ariaLabel}" should be descriptive (more than 3 characters)`,
        ).toBeGreaterThan(3);
      }
    }
  });
});
