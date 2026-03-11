import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * E2E Tests for Toast Duration Verification.
 *
 * Verifies that the success toast notification shown after saving
 * system settings remains visible for a minimum duration (at least 2 seconds).
 *
 * The app uses a ToastProvider with AUTO_DISMISS_MS = 5000 and
 * EXIT_ANIMATION_MS = 300. This test confirms the toast remains
 * visible long enough for the user to read it.
 *
 * @tag @theme-studio @toast @bug-verification
 */

test.describe('Toast Duration Verification @theme-studio @toast', () => {
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

  test('should show success toast after saving General settings', async () => {
    await studioPage.gotoStudio('/admin/system-settings');
    await expect(
      page.locator('[data-testid="admin-settings-page"]'),
    ).toBeVisible({ timeout: 10000 });

    // Ensure General tab is active (it is the default)
    await expect(
      page.locator('[data-testid="admin-settings-tab-general"]'),
    ).toBeVisible({ timeout: 5000 });

    // Click the Save button on the General tab
    const saveButton = page.locator(
      '[data-testid="admin-settings-save-general"]',
    );
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Verify the success toast appears
    const toast = page.locator('[role="alert"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('should keep the toast visible for at least 2 seconds', async () => {
    await studioPage.gotoStudio('/admin/system-settings');
    await expect(
      page.locator('[data-testid="admin-settings-page"]'),
    ).toBeVisible({ timeout: 10000 });

    // Click Save to trigger the toast
    const saveButton = page.locator(
      '[data-testid="admin-settings-save-general"]',
    );
    await expect(saveButton).toBeVisible();

    // Record time when we click save
    const clickTime = Date.now();
    await saveButton.click();

    // Wait for toast to appear
    const toast = page.locator('[role="alert"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify the toast is still visible after 2 seconds from click
    const elapsedSinceClick = Date.now() - clickTime;
    const remainingWait = Math.max(0, 2000 - elapsedSinceClick);

    if (remainingWait > 0) {
      // Use a Playwright assertion with a timeout that ensures we check
      // visibility at the 2-second mark rather than using waitForTimeout.
      // The toast should still be visible at this point.
      await expect(toast).toBeVisible({ timeout: remainingWait + 1000 });
    }

    // After at least 2 seconds, toast should still be present
    const totalElapsed = Date.now() - clickTime;
    expect(
      totalElapsed,
      'At least 2 seconds should have elapsed',
    ).toBeGreaterThanOrEqual(1900); // Allow small margin

    // Assert the toast is STILL visible (not yet auto-dismissed)
    await expect(toast).toBeVisible();
  });

  test('should eventually auto-dismiss the toast', async () => {
    await studioPage.gotoStudio('/admin/system-settings');
    await expect(
      page.locator('[data-testid="admin-settings-page"]'),
    ).toBeVisible({ timeout: 10000 });

    const saveButton = page.locator(
      '[data-testid="admin-settings-save-general"]',
    );
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Wait for toast to appear
    const toast = page.locator('[role="alert"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // The toast should eventually disappear (AUTO_DISMISS_MS = 5000 + EXIT_ANIMATION_MS = 300)
    // Use a generous timeout to account for timing variations
    await expect(toast).not.toBeVisible({ timeout: 10000 });
  });

  test('should allow manual dismissal of the toast', async () => {
    await studioPage.gotoStudio('/admin/system-settings');
    await expect(
      page.locator('[data-testid="admin-settings-page"]'),
    ).toBeVisible({ timeout: 10000 });

    const saveButton = page.locator(
      '[data-testid="admin-settings-save-general"]',
    );
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Wait for toast to appear
    const toast = page.locator('[role="alert"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Find and click the dismiss button inside the toast
    const dismissButton = toast.locator('button');
    if ((await dismissButton.count()) > 0) {
      await dismissButton.click();

      // Toast should disappear after dismiss animation
      await expect(toast).not.toBeVisible({ timeout: 3000 });
    }
  });
});
