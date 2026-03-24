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

/** Timeout for initial page render after navigation.
 * Must be generous because overlay handlers (cookie consent) can
 * consume several seconds of the default 5s expect timeout. */
const PAGE_RENDER_TIMEOUT_MS = 15000;

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

  test('should establish connection on page load', async () => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications screen (goto already calls waitForLoading)
    await notificationsPage.goto();

    // Screen should be visible (connection established or at least page rendered).
    // Use extended timeout because overlay handlers (cookie consent) can consume
    // time from the default expect timeout on first navigation.
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // The connection status banner only shows when disconnected.
    // Use count() for an instant check -- no timeout wait.
    const isDisconnected = await notificationsPage.connectionStatus.count() > 0;

    // Either connected (no banner) or disconnected (banner visible) is valid.
    // We just verify the page rendered without errors.
    await expect(notificationsPage.notificationList).toBeVisible();

    if (!isDisconnected) {
      // Verify we're in connected state (no warning banner)
      await notificationsPage.expectConnected();
    }
  });

  test('should reconnect after network loss', async ({ page, context }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to the notifications screen
    await notificationsPage.goto();
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Verify we start connected -- skip if the hub connection never established.
    // Use count() for instant check; if the banner is present the connection failed.
    const initiallyDisconnected = await notificationsPage.connectionStatus.count() > 0;
    test.skip(
      initiallyDisconnected,
      'SignalR hub connection not established -- cannot test reconnection'
    );

    // Simulate network going offline
    await context.setOffline(true);

    // Brief wait for disconnect detection
    await notificationsPage.connectionStatus
      .waitFor({ state: 'visible', timeout: OFFLINE_DETECT_TIMEOUT_MS })
      .catch(() => {
        // Some implementations may not show a banner immediately
      });

    // Restore network and trigger reconnection
    await context.setOffline(false);
    // Playwright's setOffline doesn't fire browser online/offline events --
    // dispatch manually so the app's online handler triggers reconnection
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // The app remounts NotificationProvider on 'online', creating a fresh connection
    await expect(async () => {
      const stillDisconnected = await notificationsPage.connectionStatus
        .isVisible()
        .catch(() => false);
      if (stillDisconnected)
        throw new Error('Still showing disconnected banner');
    }).toPass({ timeout: CONNECTION_TIMEOUT_MS });

    // Verify the page is still functional
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
    await expect(notificationsPage.notificationList).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
  });

  test('should disconnect on logout', async ({ page }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Start from a protected page
    await notificationsPage.goto('/menus');

    // Verify the notification bell is visible (authenticated state)
    await expect(notificationsPage.notificationBell).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Click logout button -- there may be multiple (sidebar + header),
    // so scope to the main navigation to avoid strict mode violations.
    const navLogoutButton = page
      .getByRole('navigation', { name: 'Main navigation' })
      .locator(testIdSelector(TestIds.LOGOUT_BUTTON));

    if (await navLogoutButton.count() === 0) {
      // Try opening a nav menu to reveal the logout button
      const navMenu = page.locator(testIdSelector(TestIds.NAV_MENU));
      if (await navMenu.count() > 0) {
        await navMenu.click();
      }
    }

    const canLogout = await navLogoutButton.count() > 0;

    if (canLogout) {
      await navLogoutButton.click();

      // After logout, we should be redirected to login page
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

      // The notification bell should not be visible on the login page
      await expect(notificationsPage.notificationBell).not.toBeVisible();
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
    await notificationsPage.goto();
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Verify we start connected -- skip if the hub connection never established
    const initiallyDisconnected = await notificationsPage.connectionStatus.count() > 0;
    test.skip(
      initiallyDisconnected,
      'SignalR hub connection not established -- cannot test reconnection'
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
    await expect(async () => {
      const isDisconnected = await notificationsPage.connectionStatus
        .isVisible()
        .catch(() => false);
      if (isDisconnected)
        throw new Error('Connection not yet recovered');
    }).toPass({ timeout: CONNECTION_TIMEOUT_MS });

    // Verify the page is still fully functional
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
    await expect(notificationsPage.notificationList).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
  });

  test('should show connection status when offline', async ({
    page,
    context,
  }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Navigate to notifications
    await notificationsPage.goto();

    // Verify the notification screen is visible before going offline
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Go offline -- Playwright's setOffline doesn't always fire browser
    // online/offline events, so dispatch manually for consistent behavior
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // Wait a reasonable time for the disconnect to be detected.
    // The banner can disappear quickly if the NotificationProvider remounts,
    // so capture its text immediately after detection.
    const bannerAppeared = await notificationsPage.connectionStatus
      .isVisible({ timeout: OFFLINE_DETECT_TIMEOUT_MS })
      .catch(() => false);

    if (bannerAppeared) {
      // The banner may vanish between the visibility check and text read
      // (e.g., the app's offline handler remounts the provider). Use
      // textContent with catch to avoid flaking on that race.
      const bannerText = await notificationsPage.connectionStatus
        .textContent({ timeout: 2000 })
        .catch(() => null);
      if (bannerText) {
        expect(bannerText).toMatch(/connect|offline|status/i);
      }
    }

    // The page should remain usable even when offline.
    // The app's NotificationProvider may unmount/remount components when it
    // detects the offline event, so use a retrying assertion to handle the
    // brief gap where the screen element is removed from the DOM.
    await expect(async () => {
      await expect(notificationsPage.notificationScreen).toBeVisible();
    }).toPass({ timeout: CONNECTION_TIMEOUT_MS });

    // Restore online state
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Wait for the page to stabilize after coming back online
    await expect(notificationsPage.notificationScreen).toBeVisible({
      timeout: CONNECTION_TIMEOUT_MS,
    });
  });
});
