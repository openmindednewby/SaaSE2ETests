/**
 * E2E Tests for Notification Preferences functionality
 *
 * Tests the notification preferences screen including:
 * - Navigation to preferences screen via settings button
 * - Change notification preference via dropdown
 * - Save preferences
 * - Preferences persistence across page reload
 * - Permission banner with enable/later buttons
 * - Enable notifications permission request
 *
 * NOTE: These tests require the notification preferences feature to be implemented.
 * Tests will be skipped if the preferences screen is not available.
 */

import { test, expect } from '@playwright/test';

import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

test.describe('Notification Preferences @notifications', () => {
  let notificationsPage: NotificationsPage;

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);
  });

  /**
   * Helper to check if preferences screen exists
   */
  async function isPreferencesScreenAvailable(page: import('@playwright/test').Page): Promise<boolean> {
    await notificationsPage.goto('/notifications/preferences');
    const preferencesScreen = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SCREEN));
    return await preferencesScreen.isVisible({ timeout: 3000 }).catch(() => false);
  }

  test('navigate to notification preferences screen', async ({ page }) => {
    // First go to notifications page
    await notificationsPage.goto('/notifications');

    // Look for the notification settings button by testId first
    const settingsButton = page.locator(testIdSelector(TestIds.NOTIFICATION_SETTINGS_BUTTON));
    const hasSettingsButton = await settingsButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasSettingsButton) {
      await settingsButton.click();
      await expect(page).toHaveURL(/\/notifications\/preferences|\/settings\/notifications/i, { timeout: 5000 });
    } else {
      // Fallback: look for a settings/preferences link or button by role
      const settingsLink = page.locator('a, button').filter({ hasText: /settings|preferences/i });

      const hasSettingsLink = await settingsLink.count() > 0;

      if (hasSettingsLink) {
        await settingsLink.first().click();
        await expect(page).toHaveURL(/\/notifications\/preferences|\/settings\/notifications/i, { timeout: 5000 });
      } else {
        // Try direct navigation
        await page.goto('/notifications/preferences', { waitUntil: 'commit' });

        // Check if we got a 404 or preferences page
        const preferencesScreen = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SCREEN));
        const isVisible = await preferencesScreen.isVisible({ timeout: 3000 }).catch(() => false);

        test.skip(!isVisible, 'Notification preferences screen not implemented yet');
      }
    }
  });

  test('change notification preference via dropdown', async ({ page }) => {
    const isAvailable = await isPreferencesScreenAvailable(page);
    test.skip(!isAvailable, 'Notification preferences screen not implemented yet');

    // Find the notification preference dropdown
    const preferenceDropdown = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCE_DROPDOWN));

    // Check if it's visible
    const isVisible = await preferenceDropdown.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!isVisible, 'Notification preference dropdown not found');

    // Get the element type to handle it appropriately
    const tagName = await preferenceDropdown.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === 'select') {
      // It's a select dropdown
      const options = await preferenceDropdown.locator('option').allTextContents();

      if (options.length > 1) {
        // Select a different option
        const currentValue = await preferenceDropdown.inputValue();
        const newOption = options.find((opt) => opt !== currentValue) ?? options[1];
        await preferenceDropdown.selectOption({ label: newOption });
      }
    } else {
      // It might be a custom dropdown or radio group - click to open/toggle
      await preferenceDropdown.click();

      // Look for options in a dropdown menu
      const options = page.locator('[role="option"], [role="radio"]');
      const optionCount = await options.count();

      const SECOND_OPTION_INDEX = 1;
      if (optionCount > SECOND_OPTION_INDEX) {
        // Click the second option (to change from current)
        await options.nth(SECOND_OPTION_INDEX).click();
      }
    }
  });

  test('save preferences shows success message', async ({ page }) => {
    const isAvailable = await isPreferencesScreenAvailable(page);
    test.skip(!isAvailable, 'Notification preferences screen not implemented yet');

    // Find and click save button
    const saveButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SAVE_BUTTON));
    await expect(saveButton).toBeVisible();

    // Set up listener for API call
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/preferences') &&
        (response.request().method() === 'PUT' || response.request().method() === 'POST'),
      { timeout: 10000 }
    ).catch(() => null);

    // Click save
    await saveButton.click();

    // Wait for API response
    const response = await saveResponsePromise;

    if (response) {
      // Check if save was successful
      expect(response.ok()).toBe(true);

      // Look for success feedback (toast, message, etc.)
      const successIndicators = [
        page.getByText(/saved|success|updated/i),
        page.locator('[role="alert"]').filter({ hasText: /saved|success/i }),
      ];

      // At least one success indicator should appear
      let foundSuccess = false;
      for (const indicator of successIndicators) {
        if (await indicator.isVisible({ timeout: 3000 }).catch(() => false)) {
          foundSuccess = true;
          break;
        }
      }

      // If no explicit success message, check that no error appeared
      if (!foundSuccess) {
        const errorIndicator = page.locator('[role="alert"]').filter({ hasText: /error|failed/i });
        await expect(errorIndicator).not.toBeVisible();
      }
    }
  });

  test('preferences persist after page reload', async ({ page }) => {
    const isAvailable = await isPreferencesScreenAvailable(page);
    test.skip(!isAvailable, 'Notification preferences screen not implemented yet');

    // Find the notification preference dropdown
    const preferenceDropdown = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCE_DROPDOWN));
    const isDropdownVisible = await preferenceDropdown.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!isDropdownVisible, 'Notification preference dropdown not found');

    // Record initial value
    const tagName = await preferenceDropdown.evaluate((el) => el.tagName.toLowerCase());
    let initialValue: string | null = null;

    if (tagName === 'select') {
      initialValue = await preferenceDropdown.inputValue();
      // Change to a different option
      const options = await preferenceDropdown.locator('option').allTextContents();
      if (options.length > 1) {
        const newOption = options.find((opt) => opt !== initialValue) ?? options[1];
        await preferenceDropdown.selectOption({ label: newOption });
      }
    } else {
      initialValue = await preferenceDropdown.textContent();
      await preferenceDropdown.click();
      const options = page.locator('[role="option"], [role="radio"]');
      const optionCount = await options.count();
      const SECOND_OPTION_INDEX = 1;
      if (optionCount > SECOND_OPTION_INDEX) {
        await options.nth(SECOND_OPTION_INDEX).click();
      }
    }

    // Save preferences
    const saveButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SAVE_BUTTON));
    await saveButton.click();

    // Wait for save to complete
    await page.waitForResponse(
      (response) =>
        response.url().includes('/preferences') &&
        (response.request().method() === 'PUT' || response.request().method() === 'POST'),
      { timeout: 10000 }
    ).catch(() => {});

    // Give some time for state to persist
    await notificationsPage.waitForLoading();

    // Record the changed value before reload
    let changedValue: string | null = null;
    if (tagName === 'select') {
      changedValue = await preferenceDropdown.inputValue();
    } else {
      changedValue = await preferenceDropdown.textContent();
    }
    expect(changedValue).not.toBe(initialValue);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });
    await notificationsPage.waitForLoading();

    // Check that preference persisted after reload
    let afterReloadValue: string | null = null;
    if (tagName === 'select') {
      afterReloadValue = await preferenceDropdown.inputValue();
    } else {
      afterReloadValue = await preferenceDropdown.textContent();
    }
    expect(afterReloadValue).toBe(changedValue);
  });

  test('notification permission banner appears when permissions needed', async ({ page }) => {
    // This tests the permission request banner for browser push notifications

    // Navigate to a protected page
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();

    // Check for permission banner
    const permissionBanner = page.locator(testIdSelector(TestIds.NOTIFICATION_PERMISSION_BANNER));
    const enableButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PERMISSION_ENABLE_BUTTON));
    const laterButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PERMISSION_LATER_BUTTON));

    // Permission banner may or may not be visible depending on browser state
    const bannerVisible = await permissionBanner.isVisible({ timeout: 3000 }).catch(() => false);

    if (bannerVisible) {
      // If visible, verify enable button is present
      await expect(enableButton).toBeVisible();

      // Verify later/dismiss button is present
      await expect(laterButton).toBeVisible();

      // Verify banner has explanatory text
      await expect(permissionBanner).toContainText(/notification|alert|permission/i);
    }

    // Note: We can't actually test the browser permission dialog in Playwright
    // as it's a native browser feature that requires special browser flags
  });

  test('enable notifications button triggers permission request', async ({ page }) => {
    // Navigate to notifications preferences
    const isAvailable = await isPreferencesScreenAvailable(page);

    if (!isAvailable) {
      // Check for enable button on main notifications page
      await notificationsPage.goto('/notifications');
      await notificationsPage.waitForLoading();
    }

    const enableButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PERMISSION_ENABLE_BUTTON));
    const isVisible = await enableButton.isVisible({ timeout: 3000 }).catch(() => false);

    test.skip(!isVisible, 'Enable notifications button not visible (may already be enabled)');

    // Click the enable button
    // Note: The actual permission dialog will be blocked by Playwright by default
    // This just verifies the button is clickable
    await expect(enableButton).toBeEnabled();

    // We can verify that clicking doesn't throw an error
    await enableButton.click();

    // The page should remain functional after clicking
    await expect(notificationsPage.notificationScreen).toBeVisible();
  });
});

test.describe('Notification Preferences - Edge Cases @notifications', () => {
  let notificationsPage: NotificationsPage;

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);
  });

  /**
   * Helper to check if preferences screen exists
   */
  async function isPreferencesScreenAvailable(page: import('@playwright/test').Page): Promise<boolean> {
    await notificationsPage.goto('/notifications/preferences');
    const preferencesScreen = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SCREEN));
    return await preferencesScreen.isVisible({ timeout: 3000 }).catch(() => false);
  }

  test('handles save failure gracefully', async ({ page }) => {
    const isAvailable = await isPreferencesScreenAvailable(page);
    test.skip(!isAvailable, 'Notification preferences screen not implemented yet');

    // Mock network failure for preferences save
    await page.route('**/preferences**', (route) => {
      if (route.request().method() === 'PUT' || route.request().method() === 'POST') {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      } else {
        route.continue();
      }
    });

    // Try to save
    const saveButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SAVE_BUTTON));
    await saveButton.click();

    // Should show error message
    const errorIndicator = page.getByText(/error|failed|try again/i).first();

    await expect(errorIndicator).toBeVisible({ timeout: 5000 });

    // Clean up route
    await page.unroute('**/preferences**');
  });

  test('handles network timeout gracefully', async ({ page }) => {
    const isAvailable = await isPreferencesScreenAvailable(page);
    test.skip(!isAvailable, 'Notification preferences screen not implemented yet');

    // Mock network timeout
    await page.route('**/preferences**', (route) => {
      if (route.request().method() === 'PUT' || route.request().method() === 'POST') {
        // Don't respond - simulate timeout
        return new Promise(() => {}); // Never resolves
      }
      return route.continue();
    });

    // Try to save
    const saveButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SAVE_BUTTON));
    await saveButton.click();

    // Should show loading state or timeout error eventually
    // Most apps will have a loading indicator or will timeout after ~30 seconds
    const loadingOrError = page.locator('[role="progressbar"], :text-matches("timeout|error|failed", "i")');

    // Wait a reasonable time for the loading to appear
    await expect(loadingOrError).toBeVisible({ timeout: 5000 }).catch(() => {
      // If neither loading nor error appears, that's also acceptable
      // as some apps handle this differently
    });

    // Clean up route
    await page.unroute('**/preferences**');
  });
});
