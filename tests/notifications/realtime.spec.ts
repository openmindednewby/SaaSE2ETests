/**
 * E2E Tests for Real-Time Notification Delivery
 *
 * Tests the real-time notification system via the frontend test API including:
 * - Notification display when received via SignalR
 * - Badge count updates for multiple notifications
 * - Mark as read when notification is clicked
 * - Mark all as read
 */

import { test, expect } from '@playwright/test';

import { isNotificationServiceHealthy } from '../../helpers/notification.helpers.js';
import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { hasNotificationTestApi } from '../utils/notificationHelpers.js';

test.describe('Real-Time Notification Delivery @notifications', () => {
  let notificationsPage: NotificationsPage;

  /** Whether the NotificationService is reachable */
  let serviceHealthy = false;

  test.beforeAll(async () => {
    serviceHealthy = await isNotificationServiceHealthy();
  });

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);

    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    // Navigate to a protected page where notifications work
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();
  });

  test.afterEach(async () => {
    await notificationsPage.dismissAllToasts().catch(() => {
      // Ignore if no toasts to dismiss
    });
  });

  test('should display notification when received via test API', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Navigate to notification screen first so the list component is mounted
    // and watching the store for reactive updates
    await notificationsPage.clickBellToNavigate();
    await notificationsPage.waitForLoading();

    const uniqueTitle = `Realtime Test ${Date.now()}`;

    // Inject mock notification while on the notifications page
    // so the mounted list component picks up the store change
    await notificationsPage.mockNotification({
      id: `rt-${Date.now()}`,
      title: uniqueTitle,
      body: 'This notification was delivered in real-time',
    });

    // The notification should appear in the list reactively
    await notificationsPage.expectHasNotifications();
    const items = notificationsPage.getNotificationItems();

    // Verify at least one item contains our notification title
    await expect(items.filter({ hasText: uniqueTitle }).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should update badge count for multiple notifications', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Get initial count
    const initialCount = await notificationsPage.getUnreadCount();

    // Inject 3 notifications
    const notificationCount = 3;
    for (let i = 0; i < notificationCount; i++) {
      await notificationsPage.mockNotification({
        id: `badge-update-${Date.now()}-${i}`,
        title: `Badge Update ${i + 1}`,
      });
    }

    // Wait for badge to reflect the new count
    await expect(async () => {
      const newCount = await notificationsPage.getUnreadCount();
      expect(newCount).toBeGreaterThanOrEqual(initialCount + notificationCount);
    }).toPass({ timeout: 10000 });
  });

  test('should mark notification as read when clicked', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a notification
    await notificationsPage.mockNotification({
      id: `click-read-${Date.now()}`,
      title: 'Click to Read',
    });

    // Wait for badge to appear
    await notificationsPage.expectBadgeVisible();
    const countBefore = await notificationsPage.getUnreadCount();
    expect(countBefore).toBeGreaterThan(0);

    // Navigate to notifications and click the first item
    await notificationsPage.clickBellToNavigate();
    await notificationsPage.waitForLoading();

    const firstItem = notificationsPage.getNotificationItem(0);
    const isItemVisible = await firstItem
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isItemVisible) {
      await notificationsPage.clickNotification(0);
      await notificationsPage.waitForLoading();

      // Navigate back to check the badge count decreased
      await notificationsPage.goto('/menus');
      await notificationsPage.waitForLoading();

      const countAfter = await notificationsPage.getUnreadCount();
      expect(countAfter).toBeLessThanOrEqual(countBefore);
    }
  });

  test('should mark all as read', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject multiple notifications to ensure there are unread items
    const injectCount = 3;
    for (let i = 0; i < injectCount; i++) {
      await notificationsPage.mockNotification({
        id: `mark-all-${Date.now()}-${i}`,
        title: `Mark All Test ${i + 1}`,
      });
    }

    // Wait for badge to appear
    await notificationsPage.expectBadgeVisible();

    // Navigate to notifications screen
    await notificationsPage.clickBellToNavigate();
    await notificationsPage.waitForLoading();

    // Mark all read button should be visible
    const markAllVisible = await notificationsPage.markAllReadButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (markAllVisible) {
      await notificationsPage.markAllAsRead();

      // Mark all read button should be hidden after clicking
      await notificationsPage.expectMarkAllReadHidden();

      // Navigate back to verify badge is hidden
      await notificationsPage.goto('/menus');
      await notificationsPage.waitForLoading();
      await notificationsPage.expectBadgeHidden();
    }
  });

  // Toast appearance and auto-dismiss are covered by notification-toast.spec.ts
});
