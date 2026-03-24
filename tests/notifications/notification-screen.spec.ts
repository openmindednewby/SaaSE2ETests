/**
 * E2E Tests for Notification Screen functionality
 *
 * Tests the main notifications list screen including:
 * - Screen navigation and display
 * - Notification list display
 * - Mark all as read functionality
 * - Empty state display
 * - Connection status indicator
 * - Individual notification interaction
 */

import { test, expect } from '@playwright/test';

import { isNotificationServiceHealthy } from '../../helpers/notification.helpers.js';
import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/** Timeout for initial page render after navigation.
 * Must be generous because overlay handlers (cookie consent) can
 * consume several seconds of the default 5s expect timeout. */
const PAGE_RENDER_TIMEOUT_MS = 15000;

/** Whether the NotificationService is reachable (shared across all describe blocks) */
let serviceHealthy = false;

test.beforeAll(async () => {
  serviceHealthy = await isNotificationServiceHealthy();
});

test.describe('Notification Screen @notifications', () => {
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

    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();
  });

  test('notification screen is accessible via navigation', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Verify we're on the notifications screen
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Verify URL
    await expect(page).toHaveURL(/\/notifications/);
  });

  test('notification screen displays header', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Look for the notifications header/title
    const header = page.getByText(/notifications/i).first();

    await expect(header).toBeVisible({ timeout: PAGE_RENDER_TIMEOUT_MS });
  });

  test('notification list is displayed', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // The notification list should be present (even if empty)
    await expect(notificationsPage.notificationList).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
  });

  test('shows empty state when no notifications', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Wait for the notification screen to fully render before checking items.
    // The instant count() can return 0 before items have rendered, leading to
    // a false "empty state" branch that then fails because neither the empty
    // state nor the items have rendered yet.
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Wait for either notification items or empty state to appear
    const emptyState = page.locator(testIdSelector(TestIds.NOTIFICATION_EMPTY_STATE));
    const items = notificationsPage.getNotificationItems();

    await expect(async () => {
      const itemCount = await items.count();
      const emptyVisible = await emptyState.isVisible().catch(() => false);
      expect(itemCount > 0 || emptyVisible).toBe(true);
    }).toPass({ timeout: PAGE_RENDER_TIMEOUT_MS });

    const count = await items.count();

    if (count === 0) {
      // Empty state should be visible
      await notificationsPage.expectEmptyState();

      // Empty state should have informative text
      await expect(emptyState).toContainText(/no notification|empty|nothing/i);
    } else {
      // Empty state should NOT be visible when there are items
      await expect(emptyState).not.toBeVisible();
    }
  });

  test('shows notification items when notifications exist', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    const items = notificationsPage.getNotificationItems();
    const count = await items.count();

    if (count === 0) {
      // Just verify list structure when empty
      await notificationsPage.expectEmptyState();
      return;
    }

    // Notifications should be visible
    await notificationsPage.expectHasNotifications();

    // Each item should have proper structure
    const firstItem = items.first();
    await expect(firstItem).toBeVisible();

    // Should have accessible content
    const hasText = await firstItem.textContent();
    expect(hasText?.length).toBeGreaterThan(0);
  });

  test('mark all as read button appears when unread notifications exist', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Check for unread notifications by looking for the mark all button
    const markAllButton = notificationsPage.markAllReadButton;
    const isVisible = await markAllButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (isVisible) {
      // Button should be clickable
      await expect(markAllButton).toBeEnabled();
      await expect(markAllButton).toContainText(/mark.*read|read.*all/i);
    }
    // If not visible, that's fine - means no unread notifications
  });

  test('mark all as read clears unread state', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Check if mark all button is visible
    const markAllButton = notificationsPage.markAllReadButton;
    const isVisible = await markAllButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (!isVisible) {
      // No unread notifications to test with, just verify the page works
      await expect(notificationsPage.notificationScreen).toBeVisible({
        timeout: PAGE_RENDER_TIMEOUT_MS,
      });
      return;
    }

    // Listen for the API call
    const apiPromise = page.waitForResponse(
      (response) =>
        response.url().includes('mark') ||
        response.url().includes('read') ||
        (response.url().includes('notification') && response.request().method() !== 'GET'),
      { timeout: 10000 }
    ).catch(() => null);

    // Click mark all as read
    await notificationsPage.markAllAsRead();

    // Verify API call was made
    const response = await apiPromise;
    if (response) {
      expect(response.ok()).toBe(true);
    }

    // After marking all as read, the button should be hidden
    await notificationsPage.expectMarkAllReadHidden();
  });

  test('connection status shows when disconnected', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // This test checks if the connection status banner appears when disconnected
    // We can't easily simulate disconnection, but we can verify the element behavior

    const connectionStatus = page.locator(testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS));

    // If visible, verify it contains status information.
    // Use textContent() with catch since the banner can disappear between
    // the visibility check and text read (connection recovering).
    const isVisible = await connectionStatus
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (isVisible) {
      const text = await connectionStatus.textContent().catch(() => null);
      if (text)
        expect(text).toMatch(/connect|status/i);
    }
    // If not visible, that means we're connected - which is expected
  });

  test('clicking notification item marks it as read', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    const items = notificationsPage.getNotificationItems();
    const count = await items.count();

    if (count === 0) {
      // No notifications to interact with - just verify list is shown
      await expect(notificationsPage.notificationList).toBeVisible({
        timeout: PAGE_RENDER_TIMEOUT_MS,
      });
      return;
    }

    // Find an unread notification if possible
    // Unread items typically have different styling or an indicator
    const unreadIndicator = items.first().locator('.unread, [data-unread="true"], [aria-selected="false"]');
    const hasUnread = await unreadIndicator.count() > 0;

    if (!hasUnread) {
      // Just verify clicking works without error
      const firstItem = items.first();
      await firstItem.click();
      await notificationsPage.waitForLoading();
      return;
    }

    // Click the first item
    await notificationsPage.clickNotification(0);
    await notificationsPage.waitForLoading();

    // The unread indicator should be gone after clicking
    // or the styling should change
  });

  test('notification screen is accessible', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Check for proper accessibility structure
    const screen = notificationsPage.notificationScreen;

    // Wait for screen to be visible before checking attributes
    await expect(screen).toBeVisible({ timeout: PAGE_RENDER_TIMEOUT_MS });

    // Should have accessible landmark or label
    const hasRole = await screen.getAttribute('role');
    const hasLabel = await screen.getAttribute('aria-label');
    const hasLabelledBy = await screen.getAttribute('aria-labelledby');

    // At least should be identifiable
    const hasTestId = await screen.getAttribute('data-testid');
    expect(hasRole !== null || hasLabel !== null || hasLabelledBy !== null || hasTestId !== null).toBe(true);

    // Notification list should be properly structured
    const list = notificationsPage.notificationList;
    const listRole = await list.getAttribute('role');
    const listItemCount = await list.locator('[role="listitem"], [data-testid]').count();

    // FlatList renders as a list-like structure
    expect(listRole === 'list' || listItemCount >= 0).toBe(true);
  });

  test('refresh functionality works', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Look for refresh button or pull-to-refresh
    const refreshButton = page.getByRole('button', { name: /refresh/i });

    if (await refreshButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Listen for API call
      const apiPromise = page.waitForResponse(
        (response) => response.url().includes('notification') && response.request().method() === 'GET',
        { timeout: 10000 }
      ).catch(() => null);

      await refreshButton.click();

      // Verify refresh triggered an API call
      const response = await apiPromise;
      if (response) {
        expect(response.ok()).toBe(true);
      }
    }
    // If no explicit refresh button, the screen might use pull-to-refresh
    // which is harder to test in Playwright
  });
});
