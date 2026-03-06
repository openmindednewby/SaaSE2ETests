/**
 * Notification Stress Test Helpers
 *
 * Utility functions specifically for stress/volume testing of the
 * notification system. Provides bulk injection and performance
 * measurement methods that operate on a Playwright Page instance.
 */

import { Page } from '@playwright/test';

/**
 * Inject multiple notifications rapidly via the test API.
 * Evaluates JavaScript in the page context to call the test API
 * in a tight loop for maximum injection speed.
 *
 * @param page - Playwright page instance (must have test API available)
 * @param count - Number of notifications to inject
 * @param titlePrefix - Prefix for notification titles
 * @returns Number of notifications successfully injected
 */
export async function injectBulkNotifications(
  page: Page,
  count: number,
  titlePrefix: string = 'Bulk Notification'
): Promise<number> {
  return await page.evaluate(
    ({ count, titlePrefix }) => {
      const testApi = (window as unknown as {
        __NOTIFICATION_TEST_API__?: {
          injectNotification: (n: {
            id: string;
            title: string;
            body?: string;
            type?: string;
          }) => void;
        };
      }).__NOTIFICATION_TEST_API__;

      if (!testApi?.injectNotification) return 0;

      let successCount = 0;
      for (let i = 0; i < count; i++) {
        try {
          testApi.injectNotification({
            id: `bulk-${Date.now()}-${i}`,
            title: `${titlePrefix} ${i + 1}`,
            body: `Notification body ${i + 1}`,
            type: 'info',
          });
          successCount++;
        } catch {
          // Count failures but continue
        }
      }
      return successCount;
    },
    { count, titlePrefix }
  );
}

/**
 * Inject multiple toasts rapidly via the test API.
 *
 * @param page - Playwright page instance (must have test API available)
 * @param count - Number of toasts to inject
 * @param titlePrefix - Prefix for toast titles
 * @returns Number of toasts successfully injected
 */
export async function injectBulkToasts(
  page: Page,
  count: number,
  titlePrefix: string = 'Bulk Toast'
): Promise<number> {
  return await page.evaluate(
    ({ count, titlePrefix }) => {
      const testApi = (window as unknown as {
        __NOTIFICATION_TEST_API__?: {
          addToast: (n: {
            id: string;
            title: string;
            body?: string;
            type?: string;
          }) => void;
        };
      }).__NOTIFICATION_TEST_API__;

      if (!testApi?.addToast) return 0;

      let successCount = 0;
      for (let i = 0; i < count; i++) {
        try {
          testApi.addToast({
            id: `bulk-toast-${Date.now()}-${i}`,
            title: `${titlePrefix} ${i + 1}`,
            body: `Toast body ${i + 1}`,
            type: 'info',
          });
          successCount++;
        } catch {
          // Count failures but continue
        }
      }
      return successCount;
    },
    { count, titlePrefix }
  );
}

/**
 * Measure the time it takes for the notification list to render.
 * Forces a synchronous layout/paint calculation and measures the duration.
 *
 * @param page - Playwright page instance
 * @returns Duration in milliseconds, or -1 if measurement fails
 */
export async function measureNotificationListRenderTime(
  page: Page
): Promise<number> {
  return await page.evaluate(() => {
    try {
      const list = document.querySelector(
        '[data-testid="notification-list"]'
      );
      if (!list) return -1;

      const start = performance.now();
      // Force a synchronous layout/paint calculation
      void list.getBoundingClientRect();
      void (list as HTMLElement).offsetHeight;
      const end = performance.now();
      return end - start;
    } catch {
      return -1;
    }
  });
}
