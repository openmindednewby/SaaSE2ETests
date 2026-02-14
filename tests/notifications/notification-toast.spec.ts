/**
 * E2E Tests for Notification Toast functionality
 *
 * Tests real-time notification toasts including:
 * - Toast appearance when notification is received
 * - Auto-dismiss after timeout
 * - Manual dismissal
 * - Clicking toast to navigate to actionUrl
 * - Multiple toast stacking
 *
 * NOTE: These tests require the notification system to be fully implemented.
 * Some tests may fail if the backend/frontend integration is not complete.
 */

import { test, expect } from '@playwright/test';

import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { TestIds } from '../../shared/testIds.js';
import { hasNotificationTestApi } from '../utils/notificationHelpers.js';

test.describe('Notification Toast @notifications', () => {
  let notificationsPage: NotificationsPage;

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);

    // Copy auth from localStorage (set by storageState) to sessionStorage
    // The app reads persist:auth from sessionStorage, but Playwright's
    // storageState only restores localStorage and cookies.
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    // Navigate to a protected page where toasts can appear
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();
  });

  test.afterEach(async () => {
    // Clean up any remaining toasts
    await notificationsPage.dismissAllToasts().catch(() => {
      // Ignore errors if no toasts to dismiss
    });
  });

  test('toast appears when notification is received', async ({ page }) => {
    // Skip if notification test API is not available
    // This test requires the frontend to expose a test API for injecting notifications
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a mock toast notification
    await notificationsPage.mockToast({
      id: 'test-notification-1',
      title: 'Test Notification',
      body: 'This is a test notification body',
    });

    // Wait for toast to appear
    const toast = await notificationsPage.waitForToast();

    // Verify toast content
    await expect(toast).toContainText('Test Notification');
    await expect(toast).toContainText('This is a test notification body');
  });

  test('toast auto-dismisses after timeout', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a mock toast notification
    await notificationsPage.mockToast({
      id: 'test-auto-dismiss',
      title: 'Auto Dismiss Test',
    });

    // Wait for toast to appear
    const toast = await notificationsPage.waitForToast();
    await expect(toast).toBeVisible();

    // Wait for auto-dismiss (5 seconds + animation buffer)
    await notificationsPage.waitForToastAutoDismiss(toast);

    // Verify toast is gone
    await notificationsPage.expectNoToasts();
  });

  test('toast can be manually dismissed', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a mock toast notification
    await notificationsPage.mockToast({
      id: 'test-manual-dismiss',
      title: 'Manual Dismiss Test',
    });

    // Wait for toast to appear
    const toast = await notificationsPage.waitForToast();
    await expect(toast).toBeVisible();

    // Dismiss the toast
    await notificationsPage.dismissToast(toast);

    // Verify toast is gone immediately (not waiting for timeout)
    await notificationsPage.expectNoToasts();
  });

  test('clicking toast navigates to actionUrl', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a toast notification with an actionUrl
    await notificationsPage.mockToast({
      id: 'test-action-url',
      title: 'Action Notification',
      body: 'Click to navigate',
      actionUrl: '/notifications',
    });

    // Wait for toast to appear
    const toast = await notificationsPage.waitForToast();

    // Click on the toast content (not the dismiss button)
    const toastContent = toast.locator('div').first();
    await toastContent.click();

    // Verify navigation occurred
    await expect(page).toHaveURL(/\/notifications/, { timeout: 5000 });
  });

  test('multiple toasts stack correctly', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject multiple toast notifications
    await notificationsPage.mockToast({
      id: 'test-stack-1',
      title: 'First Notification',
    });

    await notificationsPage.mockToast({
      id: 'test-stack-2',
      title: 'Second Notification',
    });

    await notificationsPage.mockToast({
      id: 'test-stack-3',
      title: 'Third Notification',
    });

    // Wait for toasts to appear
    await notificationsPage.expectToastCount(3);

    // Verify all toasts are visible
    const toasts = notificationsPage.getToasts();
    await expect(toasts.filter({ hasText: 'First Notification' })).toBeVisible();
    await expect(toasts.filter({ hasText: 'Second Notification' })).toBeVisible();
    await expect(toasts.filter({ hasText: 'Third Notification' })).toBeVisible();
  });

  test('toast container appears when toasts are present', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Initially no toast container
    const container = page.locator(`[data-testid="${TestIds.NOTIFICATION_TOAST_CONTAINER}"]`);

    // Container should not be visible when there are no toasts
    // (component returns null when toasts array is empty)
    await expect(container).not.toBeVisible();

    // Inject a toast notification
    await notificationsPage.mockToast({
      id: 'test-container',
      title: 'Container Test',
    });

    // Now container should be visible
    await notificationsPage.expectToastContainerVisible();
  });

  test('dismissing one toast does not affect others', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject two toast notifications
    await notificationsPage.mockToast({
      id: 'test-multi-1',
      title: 'Keep This Toast',
    });

    await notificationsPage.mockToast({
      id: 'test-multi-2',
      title: 'Dismiss This Toast',
    });

    // Wait for both toasts
    await notificationsPage.expectToastCount(2);

    // Find and dismiss the second toast
    const toastToDismiss = notificationsPage.getToastById('test-multi-2');
    await notificationsPage.dismissToast(toastToDismiss);

    // Verify only one toast remains
    await notificationsPage.expectToastCount(1);

    // The first toast should still be visible
    const remainingToast = notificationsPage.getToasts();
    await expect(remainingToast).toContainText('Keep This Toast');
  });
});
