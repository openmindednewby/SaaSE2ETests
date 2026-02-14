/**
 * E2E Tests for Notification Badge functionality
 *
 * Tests the notification bell badge including:
 * - Badge shows correct unread count
 * - Badge hides when count is 0
 * - Badge updates when notification received
 * - Badge updates when notification marked as read
 *
 * NOTE: These tests require the notification system to be fully implemented.
 * Some tests may fail if the backend/frontend integration is not complete.
 */

import { test, expect } from '@playwright/test';

import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { TestIds } from '../../shared/testIds.js';
import { hasNotificationTestApi } from '../utils/notificationHelpers.js';

test.describe('Notification Badge @notifications', () => {
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

    // Navigate to a page where the notification bell is visible
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();
  });

  test('notification bell is visible in topbar', async () => {
    // The notification bell should be visible on protected pages
    await expect(notificationsPage.notificationBell).toBeVisible();
  });

  test('badge shows correct unread count', async ({ page }) => {
    // This test verifies the badge displays correctly when there are unread notifications
    // The actual count depends on the user's notification state

    const count = await notificationsPage.getUnreadCount();

    if (count === 0) {
      // Badge should be hidden when no unread notifications
      await notificationsPage.expectBadgeHidden();
    } else {
      // Badge should be visible with the correct count
      await notificationsPage.expectBadgeVisible();

      // Get badge text directly to verify format
      const badge = page.locator(`[data-testid="${TestIds.NOTIFICATION_BELL_BADGE}"]`);
      const badgeText = await badge.textContent();

      if (count > 99) {
        expect(badgeText).toBe('99+');
      } else {
        expect(badgeText).toBe(String(count));
      }
    }
  });

  test('badge hides when count is 0', async () => {
    // Navigate to notifications and mark all as read (if any)
    await notificationsPage.clickBellToNavigate();

    // If there are unread notifications, mark them as read
    const markAllButton = notificationsPage.markAllReadButton;
    if (await markAllButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await notificationsPage.markAllAsRead();
    }

    // Navigate back to verify badge is hidden
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();

    // Badge should not be visible when count is 0
    await notificationsPage.expectBadgeHidden();
  });

  test('badge updates when notification received', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Get initial count
    const initialCount = await notificationsPage.getUnreadCount();

    // Inject a new notification
    await notificationsPage.mockNotification({
      id: `badge-test-${Date.now()}`,
      title: 'Badge Update Test',
      body: 'Testing badge increment',
    });

    // Wait for badge to update (may need to wait for SignalR/WebSocket update)
    // Use web-first assertion to wait for the count to change
    await expect(async () => {
      const newCount = await notificationsPage.getUnreadCount();
      expect(newCount).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 10000 });
  });

  test('badge updates when notification marked as read', async ({ page }) => {
    const hasApi = await hasNotificationTestApi(page);

    // Get initial count
    const initialCount = await notificationsPage.getUnreadCount();

    if (initialCount === 0) {
      test.skip(!hasApi, 'No unread notifications and test API not available');

      // Inject a notification to have something to mark as read
      await notificationsPage.mockNotification({
        id: `read-test-${Date.now()}`,
        title: 'Read Test Notification',
      });

      // Wait for badge to update
      await notificationsPage.expectBadgeVisible();
    }

    // Get count before marking as read
    const countBefore = await notificationsPage.getUnreadCount();
    expect(countBefore).toBeGreaterThan(0);

    // Navigate to notifications
    await notificationsPage.clickBellToNavigate();

    // Click on the first notification to mark it as read
    const notificationItem = notificationsPage.getNotificationItem(0);
    if (await notificationItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await notificationItem.click();
      await notificationsPage.waitForLoading();

      // Navigate back to check badge
      await notificationsPage.goto('/menus');
      await notificationsPage.waitForLoading();

      // Count should have decreased
      const countAfter = await notificationsPage.getUnreadCount();

      // Either count decreased or became 0
      const countDecreased = countAfter < countBefore;
      const countIsZero = countAfter === 0;
      expect(countDecreased || countIsZero).toBe(true);
    }
  });

  test('clicking bell navigates to notifications screen', async ({ page }) => {
    // Click the notification bell
    await notificationsPage.clickBellToNavigate();

    // Verify we're on the notifications screen
    const notificationScreen = page.locator(`[data-testid="${TestIds.NOTIFICATION_SCREEN}"]`);
    await expect(notificationScreen).toBeVisible({ timeout: 5000 });
  });

  test('badge overflow shows 99+ for large counts', async ({ page }) => {
    // This test verifies the badge shows "99+" for counts over 99
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Cannot test overflow without notification test API');

    // Check if test API supports setting unread count directly
    const canSetCount = await page.evaluate(() => {
      const api = (window as unknown as {
        __NOTIFICATION_TEST_API__?: { setUnreadCount?: (count: number) => void };
      }).__NOTIFICATION_TEST_API__;
      return typeof api?.setUnreadCount === 'function';
    });

    test.skip(!canSetCount, 'Test API does not support setUnreadCount');

    // Set a large unread count
    await page.evaluate(() => {
      const api = (window as unknown as {
        __NOTIFICATION_TEST_API__?: { setUnreadCount: (count: number) => void };
      }).__NOTIFICATION_TEST_API__;
      api?.setUnreadCount(150);
    });

    // Verify badge shows "99+"
    await notificationsPage.expectBadgeVisible();
    const badge = page.locator(`[data-testid="${TestIds.NOTIFICATION_BELL_BADGE}"]`);
    await expect(badge).toHaveText('99+');
  });

  test('badge is accessible', async ({ page: _page }) => {
    // Verify the badge has proper accessibility attributes
    const badge = notificationsPage.notificationBadge;

    // Badge may or may not be visible depending on unread count
    const count = await badge.count();
    if (count === 0) {
      // Skip if no badge visible
      return;
    }

    // Check accessibility attributes
    const accessibilityLabel = await badge.getAttribute('aria-label');
    const accessibilityHint = await badge.getAttribute('accessibilityHint');

    // Badge should have accessibility information
    // React Native Web converts accessibilityLabel to aria-label
    const hasAccessibility = accessibilityLabel !== null || accessibilityHint !== null;
    expect(hasAccessibility).toBe(true);
  });

  test('notification bell has proper accessibility', async () => {
    // Verify the bell button has proper accessibility attributes
    const bell = notificationsPage.notificationBell;

    // Check accessibility role
    const role = await bell.getAttribute('role');
    expect(role).toBe('button');

    // Check accessibility label
    const label = await bell.getAttribute('aria-label');
    expect(label).toBeTruthy();
  });
});
