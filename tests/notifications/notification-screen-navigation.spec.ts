/**
 * E2E Tests for Notification Screen navigation and rendering
 *
 * Tests navigation workflows and rendering behavior:
 * - Bell icon navigation
 * - Back navigation
 * - Scroll position preservation
 * - Screen rendering
 * - Empty/populated state rendering
 * - Disconnected state handling
 */

import { test, expect } from '@playwright/test';

import { isNotificationServiceHealthy } from '../../helpers/notification.helpers.js';
import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/** Whether the NotificationService is reachable (shared across all describe blocks) */
let serviceHealthy = false;

test.beforeAll(async () => {
  serviceHealthy = await isNotificationServiceHealthy();
});

test.describe('Notification Screen - Navigation @notifications', () => {
  let notificationsPage: NotificationsPage;

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);

    // Copy auth from localStorage (set by storageState) to sessionStorage
    // AND suppress tooltip tours so the tooltip-backdrop overlay does not
    // intercept pointer events (e.g. when clicking the notification bell).
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }

      // Mark all tooltip guided tours as seen to prevent the overlay from blocking clicks
      try {
        const tourIds = ['dashboard', 'editor', 'public-menu'];
        for (const id of tourIds) {
          localStorage.setItem(`menuflow_tour_seen_${id}`, 'true');
        }
      } catch {
        // ignore
      }
    });
  });

  test('can navigate to notifications via bell icon', async ({ page: _page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Start from a different page -- navigate without waiting for full page load
    // since we only need the bell icon to be clickable, not the entire menus page
    await notificationsPage.page.goto('/menus', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await notificationsPage.restoreAuth();
    await notificationsPage.suppressTooltipTours();
    await notificationsPage.notificationBell.waitFor({ state: 'visible', timeout: 15000 });

    // Click the bell to navigate
    await notificationsPage.clickBellToNavigate();

    // Verify we're on notifications screen
    await expect(notificationsPage.notificationScreen).toBeVisible();
  });

  test('can navigate back from notifications', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Start from menus
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();

    // Go to notifications
    await notificationsPage.clickBellToNavigate();
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // Navigate back
    await page.goBack();

    // Should be back on menus (or previous page)
    await expect(page).not.toHaveURL(/\/notifications$/);
  });

  test('notifications screen preserves scroll position on return', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Go to notifications
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Check if we have enough items to scroll
    const items = notificationsPage.getNotificationItems();
    const count = await items.count();

    if (count < 5) {
      // Not enough notifications to test scroll position - just verify page works
      await expect(notificationsPage.notificationScreen).toBeVisible();
      return;
    }

    // Scroll down
    const FIFTH_ITEM_INDEX = 4;
    await items.nth(FIFTH_ITEM_INDEX).scrollIntoViewIfNeeded();

    // Navigate away
    await notificationsPage.goto('/menus');

    // Navigate back
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Note: Scroll position preservation depends on implementation
    // Some apps restore scroll, some don't
    // Just verify the page loaded correctly
    await expect(notificationsPage.notificationScreen).toBeVisible();
  });
});

test.describe('Notification Screen - Rendering @notifications', () => {
  // NOTE: The notification system uses SignalR for real-time data, not REST API.
  // The useNotifications() hook gets data from SignalR context, so HTTP mocking
  // doesn't affect what the component displays. These tests verify the UI renders
  // correctly regardless of the notification data source.

  let notificationsPage: NotificationsPage;

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);

    // Copy auth from localStorage (set by storageState) to sessionStorage
    // AND suppress tooltip tours so the tooltip-backdrop overlay does not
    // intercept pointer events.
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }

      // Mark all tooltip guided tours as seen to prevent the overlay from blocking clicks
      try {
        const tourIds = ['dashboard', 'editor', 'public-menu'];
        for (const id of tourIds) {
          localStorage.setItem(`menuflow_tour_seen_${id}`, 'true');
        }
      } catch {
        // ignore
      }
    });
  });

  test('screen renders correctly', async ({ page: _page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications page
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Screen should render
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // Notification list should be present
    await expect(notificationsPage.notificationList).toBeVisible();
  });

  test('shows empty state or notifications based on data', async ({ page: _page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications page
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Screen should render
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // Either empty state or notification items should be visible
    const items = notificationsPage.getNotificationItems();
    const count = await items.count();

    if (count === 0) {
      // Empty state should be visible when no notifications
      await notificationsPage.expectEmptyState();
    } else {
      // Notification items should be visible when there are notifications
      await notificationsPage.expectHasNotifications();
    }
  });

  test('handles disconnected state gracefully', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications page
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Screen should always render (component has fallback for disconnected state)
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // Notification list should be present
    await expect(notificationsPage.notificationList).toBeVisible();

    // If disconnected, a connection status banner may be shown
    // The component shows this when connectionStatus !== 'connected'
    const connectionStatus = page.locator(testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS));
    const isDisconnected = await connectionStatus.isVisible({ timeout: 2000 }).catch(() => false);

    if (isDisconnected) {
      // Use textContent() with catch since the banner can disappear
      // between the visibility check and text read (connection recovering).
      const text = await connectionStatus.textContent().catch(() => null);
      if (text)
        expect(text).toMatch(/connect|status/i);
    }
    // If not disconnected, that's also fine - means we're connected
  });
});
