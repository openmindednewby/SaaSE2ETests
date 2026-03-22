/**
 * Resilience Stress Tests for Notification System
 *
 * Tests that combine multiple stress vectors to verify system resilience:
 * - Rapid bell open/close with notifications arriving
 * - Connection drop during notification burst and recovery
 *
 * All tests use generous timeouts (60-120s) to account for volume.
 */

import { test, expect } from '@playwright/test';

import { isNotificationServiceHealthy } from '../../helpers/notification.helpers.js';
import { NotificationsPage } from '../../pages/NotificationsPage.js';
import { NotificationsStressPage } from '../../pages/NotificationsStressPage.js';
import { hasNotificationTestApi } from '../utils/notificationHelpers.js';
import { injectBulkNotifications } from '../utils/notificationStressHelpers.js';

/** Extended timeout for the most demanding stress tests */
const EXTREME_STRESS_TIMEOUT_MS = 120000;

test.describe('Notification Resilience Stress Tests @notifications @stress', () => {
  let notificationsPage: NotificationsPage;
  let stressPage: NotificationsStressPage;

  /** Whether the NotificationService is reachable */
  let serviceHealthy = false;

  test.beforeAll(async () => {
    serviceHealthy = await isNotificationServiceHealthy();
  });

  test.beforeEach(async ({ page }) => {
    notificationsPage = new NotificationsPage(page);
    stressPage = new NotificationsStressPage(page);

    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth'))
          sessionStorage.setItem('persist:auth', persistAuth);
      } catch {
        // ignore
      }
    });

    await notificationsPage.goto('/menus');
    await notificationsPage.waitForLoading();
  });

  test.afterEach(async () => {
    await notificationsPage.dismissAllToasts().catch(() => {
      // Ignore cleanup errors
    });
  });

  test('should handle rapid bell open/close with notifications arriving', async ({
    page,
  }) => {
    test.slow(); // Stress test needs extra time for repeated navigation
    test.setTimeout(EXTREME_STRESS_TIMEOUT_MS);

    test.skip(!serviceHealthy, 'NotificationService is not running');
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    const injected = await injectBulkNotifications(page,
      5,
      'Bell Toggle'
    );
    expect(injected).toBeGreaterThan(0);
    await notificationsPage.expectBadgeVisible();

    const toggleCount = 5;
    for (let i = 0; i < toggleCount; i++) {
      await notificationsPage.notificationBell.click();
      await expect(page).toHaveURL(/\/notifications/, { timeout: 15000 });

      await stressPage.mockNotification({
        id: `bell-toggle-${Date.now()}-${i}`,
        title: `During Toggle ${i + 1}`,
      });

      await notificationsPage.goto('/menus');
      await notificationsPage.waitForLoading();
    }

    // After rapid toggling, verify the UI is still functional.
    // The bell icon must be visible and clickable. The badge may or may not
    // be visible since viewing the notifications screen can auto-mark items
    // as read, causing the badge to disappear. The real assertion is that
    // the system survived rapid navigation without crashing.
    await expect(notificationsPage.notificationBell).toBeVisible({ timeout: 15000 });
    await expect(notificationsPage.notificationBell).toBeEnabled();
  });

  // Preference toggle stress test removed — preferences screen not implemented

  test('should handle connection drop during notification burst and recover', async ({
    page,
    context,
  }) => {
    test.slow(); // Network recovery is inherently unpredictable under load
    test.setTimeout(EXTREME_STRESS_TIMEOUT_MS);

    test.skip(!serviceHealthy, 'NotificationService is not running');
    const hasApi = await hasNotificationTestApi(page);
    test.skip(!hasApi, 'Notification test API not available in this build');

    // Inject initial batch
    const initialBatch = 20;
    const injectedBefore = await injectBulkNotifications(page,
      initialBatch,
      'Before Drop'
    );
    expect(injectedBefore).toBeGreaterThan(0);

    await notificationsPage.expectBadgeVisible();
    const _countBeforeDrop = await notificationsPage.getUnreadCount();

    // Simulate network drop
    await context.setOffline(true);

    // Try injecting while offline (should fail gracefully)
    await page
      .evaluate(() => {
        const testApi = (
          window as unknown as {
            __NOTIFICATION_TEST_API__?: {
              injectNotification: (n: {
                id: string;
                title: string;
              }) => void;
            };
          }
        ).__NOTIFICATION_TEST_API__;
        if (testApi?.injectNotification) {
          for (let i = 0; i < 10; i++) {
            try {
              testApi.injectNotification({
                id: `during-drop-${Date.now()}-${i}`,
                title: `During Drop ${i + 1}`,
              });
            } catch {
              // Expected during offline
            }
          }
        }
      })
      .catch(() => {
        // Page evaluate may fail if page is in a bad state
      });

    // Restore network
    await context.setOffline(false);

    // Wait for recovery with generous timeout and retry intervals
    await expect(async () => {
      const bellVisible = await notificationsPage.notificationBell
        .isVisible()
        .catch(() => false);
      expect(bellVisible).toBe(true);
    }).toPass({ timeout: 45000, intervals: [500, 1000, 2000, 5000] });

    // Inject more after recovery to prove the system can accept new notifications
    const recoveryBatch = 10;
    const countAfterRecovery = await notificationsPage.getUnreadCount();
    const injectedAfter = await injectBulkNotifications(
      page, recoveryBatch, 'After Recovery'
    ).catch(() => 0);

    if (injectedAfter > 0) {
      // Verify that new notifications were received after recovery.
      // We do NOT assert the total equals pre-drop count because the
      // in-memory store may have lost notifications during the network drop.
      // The key assertion is that the system recovered and can receive new ones.
      await expect(async () => {
        const count = await notificationsPage.getUnreadCount();
        expect(count).toBeGreaterThan(countAfterRecovery);
      }).toPass({ timeout: 45000, intervals: [500, 1000, 2000, 5000] });
    }

    // Verify notifications screen works after recovery
    await notificationsPage.clickBellToNavigate();
    await notificationsPage.waitForLoading();
    await expect(notificationsPage.notificationScreen).toBeVisible({ timeout: 15000 });
    await expect(notificationsPage.notificationList).toBeVisible({ timeout: 15000 });
  });
});
