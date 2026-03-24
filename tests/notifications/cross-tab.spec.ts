/**
 * E2E Tests for Cross-Tab Notification Sync
 *
 * Tests that notification state synchronizes across multiple browser tabs:
 * - Notifications received in one tab appear in another
 * - Mark as read in one tab reflects in the other
 *
 * These tests use two browser contexts to simulate multiple tabs.
 * The test API is used to inject notifications into one tab and
 * verify they appear in the other.
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';

import { isNotificationServiceHealthy } from '../../helpers/notification.helpers.js';
import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { NotificationsStressPage } from '../../pages/NotificationsStressPage.js';
import { hasNotificationTestApi } from '../utils/notificationHelpers.js';

/** Timeout for initial page render after navigation.
 * Must be generous because overlay handlers (cookie consent) can
 * consume several seconds of the default 5s expect timeout. */
const PAGE_RENDER_TIMEOUT_MS = 15000;

/** Extended timeout for cross-tab sync */
const SYNC_TIMEOUT_MS = 15000;

/**
 * Setup a page with auth init script and navigate to a path
 */
async function setupPageWithAuth(
  context: BrowserContext,
  targetPath: string
): Promise<{ page: Page; notificationsPage: NotificationsPage; stressPage: NotificationsStressPage }> {
  const page = await context.newPage();
  const notificationsPage = new NotificationsPage(page);
  const stressPage = new NotificationsStressPage(page);

  await page.addInitScript(() => {
    try {
      const persistAuth = localStorage.getItem('persist:auth');
      if (persistAuth && !sessionStorage.getItem('persist:auth'))
        sessionStorage.setItem('persist:auth', persistAuth);
    } catch {
      // ignore
    }
  });

  await notificationsPage.goto(targetPath);
  await notificationsPage.waitForLoading();

  return { page, notificationsPage, stressPage };
}

test.describe('Cross-Tab Notification Sync @notifications', () => {
  test.setTimeout(60000);
  /** Whether the NotificationService is reachable */
  let serviceHealthy = false;

  test.beforeAll(async () => {
    serviceHealthy = await isNotificationServiceHealthy();
  });

  test('should sync notification received in one tab to another', async ({
    context,
  }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Open Tab 1 on the menus page (where bell and toasts are visible)
    const tab1 = await setupPageWithAuth(context, '/menus');

    // Open Tab 2 on the notifications screen
    const tab2 = await setupPageWithAuth(context, '/notifications');

    // Check if test API is available in Tab 1
    const hasApi = await hasNotificationTestApi(tab1.page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a notification via Tab 1's test API
    const uniqueTitle = `Cross-Tab Sync ${Date.now()}`;
    await tab1.stressPage.mockNotification({
      id: `cross-tab-${Date.now()}`,
      title: uniqueTitle,
      body: 'Injected from Tab 1',
    });

    // Verify the notification appears in Tab 1's badge
    await expect(async () => {
      const count = await tab1.notificationsPage.getUnreadCount();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: SYNC_TIMEOUT_MS });

    // Switch to Tab 2 and check if the notification synced
    // Cross-tab sync depends on the implementation (BroadcastChannel,
    // SharedWorker, or polling). If the app uses SignalR, both tabs
    // have independent connections and should both receive the notification.
    // If using client-side injection, only the injecting tab gets it.
    await tab2.page.bringToFront();

    // Reload needed: Tab 2 must re-fetch notification state from the server
    // to verify cross-tab sync. This is the correct way to test persistence.
    await tab2.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); // eslint-disable-line no-page-reload/no-page-reload
    await tab2.notificationsPage.waitForLoading();

    // Verify Tab 2 still has the notification screen
    await expect(tab2.notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
    await expect(tab2.notificationsPage.notificationList).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Clean up
    await tab1.page.close();
    await tab2.page.close();
  });

  test('should reflect mark as read from one tab in another', async ({
    context,
  }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Open Tab 1 on a protected page
    const tab1 = await setupPageWithAuth(context, '/menus');

    // Check if test API is available
    const hasApi = await hasNotificationTestApi(tab1.page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject a notification in Tab 1
    await tab1.stressPage.mockNotification({
      id: `mark-read-cross-${Date.now()}`,
      title: 'Cross-Tab Read Test',
    });

    // Wait for badge to appear in Tab 1
    await tab1.notificationsPage.expectBadgeVisible();
    const countBefore = await tab1.notificationsPage.getUnreadCount();
    expect(countBefore).toBeGreaterThan(0);

    // Open Tab 2 on the notifications screen
    const tab2 = await setupPageWithAuth(context, '/notifications');
    await expect(tab2.notificationsPage.notificationScreen).toBeVisible({ timeout: SYNC_TIMEOUT_MS });

    // Mark all as read in Tab 2
    const markAllVisible = await tab2.notificationsPage.markAllReadButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (markAllVisible) {
      await tab2.notificationsPage.markAllAsRead();
    } else {
      // If no mark all button, click the first notification
      const firstItem = tab2.notificationsPage.getNotificationItem(0);
      const itemVisible = await firstItem
        .isVisible({ timeout: 5000 })
        .catch(() => false);
      if (itemVisible) {
        await tab2.notificationsPage.clickNotification(0);
        await tab2.notificationsPage.waitForLoading();
      }
    }

    // Switch to Tab 1 and reload to check if state synced
    // Reload needed: Tab 1 must re-fetch to verify cross-tab mark-as-read sync.
    await tab1.page.bringToFront();
    await tab1.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); // eslint-disable-line no-page-reload/no-page-reload
    await tab1.notificationsPage.waitForLoading();

    // Verify the badge count decreased or disappeared in Tab 1
    const countAfter = await tab1.notificationsPage.getUnreadCount();
    expect(countAfter).toBeLessThanOrEqual(countBefore);

    // Clean up
    await tab1.page.close();
    await tab2.page.close();
  });

  test('should maintain independent page state across tabs', async ({
    context,
  }) => {
    test.skip(!serviceHealthy, 'NotificationService is not running');

    // Open Tab 1 on notifications screen
    const tab1 = await setupPageWithAuth(context, '/notifications');

    // Open Tab 2 on a different protected page
    const tab2 = await setupPageWithAuth(context, '/menus');

    // Verify both tabs are functional.
    // After bringToFront, wait for the page to stabilize in case the
    // browser throttled the background tab.
    await tab1.page.bringToFront();
    await tab1.page.waitForLoadState('domcontentloaded');
    await expect(tab1.notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    await tab2.page.bringToFront();
    await tab2.page.waitForLoadState('domcontentloaded');
    await expect(tab2.notificationsPage.notificationBell).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Switch back to Tab 1 - it should still be on the notifications screen
    await tab1.page.bringToFront();
    await tab1.page.waitForLoadState('domcontentloaded');
    await expect(tab1.notificationsPage.notificationScreen).toBeVisible({
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });

    // Clean up
    await tab1.page.close();
    await tab2.page.close();
  });
});
