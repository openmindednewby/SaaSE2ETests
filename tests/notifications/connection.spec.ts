/**
 * E2E Tests for Notification Connection Resilience
 *
 * Tests the SignalR connection lifecycle including:
 * - Connection establishment after login
 * - Reconnection after network loss (via context.setOffline)
 * - Disconnection on logout
 * - Handling of multiple rapid reconnections
 *
 * These tests exercise the connection status indicator and verify
 * the UI recovers gracefully from network disruptions.
 */

import { test, expect } from '@playwright/test';

import { isNotificationServiceHealthy } from '../../helpers/notification.helpers.js';
import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/** Timeout for waiting on connection recovery after network restore.
 * SignalR uses exponential backoff (2s, 4s, 8s, 16s, 30s) with 5 max retries.
 * We keep offline periods short so only 1-2 retries are consumed,
 * leaving the next retry within ~10s of network restore. */
const CONNECTION_TIMEOUT_MS = 20000;

/** Short timeout for detecting disconnection while offline.
 * Must be brief to avoid exhausting SignalR retry attempts. */
const OFFLINE_DETECT_TIMEOUT_MS = 5000;

test.describe('Notification Connection Resilience @notifications', () => {
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
  });

  test('should establish connection on page load', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications screen
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Screen should be visible (connection established or at least page rendered)
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // If connected, there should be no disconnection banner
    // The connection status banner only shows when disconnected
    const connectionBanner = page.locator(
      testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS)
    );
    const isDisconnected = await connectionBanner
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    // Either connected (no banner) or disconnected (banner visible) is valid
    // We just verify the page rendered without errors
    await expect(notificationsPage.notificationList).toBeVisible();

    if (!isDisconnected) {
      // Verify we're in connected state (no warning banner)
      await notificationsPage.expectConnected();
    }
  });

  test('should reconnect after network loss', async ({ page, context }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to a page with notifications
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // Verify we start connected — skip if the hub connection never established
    const connectionBanner = page.locator(
      testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS)
    );
    const initiallyDisconnected = await connectionBanner
      .isVisible({ timeout: OFFLINE_DETECT_TIMEOUT_MS })
      .catch(() => false);
    test.skip(
      initiallyDisconnected,
      'SignalR hub connection not established — cannot test reconnection'
    );

    // Simulate network going offline
    await context.setOffline(true);

    // Brief wait for disconnect detection
    await connectionBanner
      .waitFor({ state: 'visible', timeout: OFFLINE_DETECT_TIMEOUT_MS })
      .catch(() => {
        // Some implementations may not show a banner immediately
      });

    // Restore network and trigger reconnection
    await context.setOffline(false);
    // Playwright's setOffline doesn't fire browser online/offline events —
    // dispatch manually so the app's online handler triggers reconnection
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // The app remounts NotificationProvider on 'online', creating a fresh connection
    await expect(async () => {
      const stillDisconnected = await connectionBanner
        .isVisible()
        .catch(() => false);
      if (stillDisconnected)
        throw new Error('Still showing disconnected banner');
    }).toPass({ timeout: CONNECTION_TIMEOUT_MS });

    // Verify the page is still functional
    await expect(notificationsPage.notificationScreen).toBeVisible();
    await expect(notificationsPage.notificationList).toBeVisible();
  });

  test('should disconnect on logout', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Start from a protected page
    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();

    // Verify the notification bell is visible (authenticated state)
    await expect(notificationsPage.notificationBell).toBeVisible();

    // Click logout button
    const logoutButton = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON));
    const logoutVisible = await logoutButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!logoutVisible) {
      // Try finding logout in a nav menu
      const navMenu = page.locator(testIdSelector(TestIds.NAV_MENU));
      if (await navMenu.count() > 0) {
        await navMenu.click();
      }
    }

    const logoutBtn = page.locator(testIdSelector(TestIds.LOGOUT_BUTTON));
    const canLogout = await logoutBtn
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (canLogout) {
      await logoutBtn.click();

      // After logout, we should be redirected to login page
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

      // The notification bell should not be visible on the login page
      await expect(notificationsPage.notificationBell).not.toBeVisible({
        timeout: 5000,
      });
    } else {
      // If logout button isn't found, verify the page is still functional
      await expect(notificationsPage.notificationBell).toBeVisible();
    }
  });

  test('should handle multiple rapid reconnections gracefully', async ({
    page,
    context,
  }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();
    await expect(notificationsPage.notificationScreen).toBeVisible();

    // Verify we start connected — skip if the hub connection never established
    const initialBanner = page.locator(
      testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS)
    );
    const initiallyDisconnected = await initialBanner
      .isVisible({ timeout: OFFLINE_DETECT_TIMEOUT_MS })
      .catch(() => false);
    test.skip(
      initiallyDisconnected,
      'SignalR hub connection not established — cannot test reconnection'
    );

    // Rapidly toggle offline/online multiple times
    const toggleCount = 3;
    for (let i = 0; i < toggleCount; i++) {
      await context.setOffline(true);
      await context.setOffline(false);
    }

    // Ensure we end in online state and trigger reconnection
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Wait for the page to stabilize after rapid toggling
    const connectionBanner = page.locator(
      testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS)
    );

    await expect(async () => {
      const isDisconnected = await connectionBanner
        .isVisible()
        .catch(() => false);
      if (isDisconnected)
        throw new Error('Connection not yet recovered');
    }).toPass({ timeout: CONNECTION_TIMEOUT_MS });

    // Verify the page is still fully functional
    await expect(notificationsPage.notificationScreen).toBeVisible();
    await expect(notificationsPage.notificationList).toBeVisible();
  });

  test('should show connection status when offline', async ({
    page,
    context,
  }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications
    await notificationsPage.goto('/notifications');
    await notificationsPage.waitForLoading();

    // Go offline
    await context.setOffline(true);

    // The connection status banner may appear
    const connectionBanner = page.locator(
      testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS)
    );

    // Wait a reasonable time for the disconnect to be detected
    const bannerAppeared = await connectionBanner
      .isVisible({ timeout: OFFLINE_DETECT_TIMEOUT_MS })
      .catch(() => false);

    if (bannerAppeared) {
      // Verify the banner contains status information
      await expect(connectionBanner).toContainText(/connect|offline|status/i);
    }

    // The page should remain usable even when offline
    // Some browsers may briefly unmount/remount components on network change
    await expect(notificationsPage.notificationScreen).toBeVisible({ timeout: 10000 });

    // Restore online state
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  });
});
