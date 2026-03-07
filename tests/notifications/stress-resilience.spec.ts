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
import { hasNotificationTestApi } from '../utils/notificationHelpers.js';
import { injectBulkNotifications } from '../utils/notificationStressHelpers.js';

/** Generous timeout for stress tests */
const STRESS_TIMEOUT_MS = 60000;

/** Extended timeout for the most demanding stress tests */
const EXTREME_STRESS_TIMEOUT_MS = 120000;

test.describe('Notification Resilience Stress Tests @notifications @stress', () => {
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
    test.setTimeout(STRESS_TIMEOUT_MS);

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
      await expect(page).toHaveURL(/\/notifications/, { timeout: 5000 });

      await notificationsPage.mockNotification({
        id: `bell-toggle-${Date.now()}-${i}`,
        title: `During Toggle ${i + 1}`,
      });

      await notificationsPage.goto('/menus');
      await notificationsPage.waitForLoading();
    }

    await expect(notificationsPage.notificationBell).toBeVisible();
    await notificationsPage.expectBadgeVisible();
  });

  // Preference toggle stress test removed — preferences screen not implemented

  test('should handle connection drop during notification burst and recover', async ({
    page,
    context,
  }) => {
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
    const countBeforeDrop = await notificationsPage.getUnreadCount();

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

    // Wait for recovery
    await expect(async () => {
      const bellVisible = await notificationsPage.notificationBell
        .isVisible()
        .catch(() => false);
      expect(bellVisible).toBe(true);
    }).toPass({ timeout: 30000 });

    // Inject more after recovery
    const recoveryBatch = 10;
    const injectedAfter = await injectBulkNotifications(
      page, recoveryBatch, 'After Recovery'
    ).catch(() => 0);

    if (injectedAfter > 0) {
      await expect(async () => {
        const count = await notificationsPage.getUnreadCount();
        expect(count).toBeGreaterThanOrEqual(countBeforeDrop);
      }).toPass({ timeout: 30000 });
    }

    // Verify notifications screen works after recovery
    await notificationsPage.clickBellToNavigate();
    await notificationsPage.waitForLoading();
    await expect(notificationsPage.notificationScreen).toBeVisible();
    await expect(notificationsPage.notificationList).toBeVisible();
  });
});
