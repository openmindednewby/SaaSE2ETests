/**
 * Notification List Test Utilities
 *
 * Helper functions for testing the notification list, mocking notifications,
 * and checking the notification test API store state.
 *
 * For toast-related helpers, see notificationHelpers.ts.
 */

import { expect, Page, Locator } from '@playwright/test';

import { TestIds, testIdSelector, testIdStartsWithSelector } from '../../shared/testIds.js';

/** Default timeout for notification-related waits (5 seconds) */
const NOTIFICATION_TIMEOUT_MS = 5000;

/** Default timeout for waiting on the test API store */
const STORE_READY_TIMEOUT_MS = 5000;

/** Notification data interface for mock functions */
interface MockNotificationData {
  id?: string;
  title: string;
  body?: string;
  type?: string;
  actionUrl?: string;
}

/**
 * Navigate to the notifications screen by clicking the bell button
 * @param page - Playwright page instance
 */
export async function navigateToNotifications(page: Page): Promise<void> {
  const bell = page.locator(testIdSelector(TestIds.NOTIFICATION_BELL));
  await bell.click();
  await expect(page).toHaveURL(/\/notifications/, { timeout: NOTIFICATION_TIMEOUT_MS });
}

/**
 * Get the notification list container
 */
export function getNotificationList(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_LIST));
}

/**
 * Get all notification items in the list
 */
export function getNotificationItems(page: Page): Locator {
  return page.locator(testIdStartsWithSelector(TestIds.NOTIFICATION_ITEM));
}

/**
 * Get the "Mark all as read" button
 */
export function getMarkAllReadButton(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_MARK_ALL_READ));
}

/**
 * Get the empty state element (shown when no notifications)
 */
export function getEmptyState(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_EMPTY_STATE));
}

/**
 * Get the connection status banner
 */
export function getConnectionStatus(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS));
}

/**
 * Mock a SignalR notification by evaluating JavaScript in the page context.
 * This injects a fake notification into the notifications list.
 * Use mockToastNotification() for testing toast popups.
 *
 * NOTE: This requires the notification-client package to expose a mock/test API.
 * If not available, this will log a warning and do nothing.
 *
 * @param page - Playwright page instance
 * @param notification - The notification data to inject
 */
export async function mockSignalRNotification(
  page: Page,
  notification: MockNotificationData
): Promise<void> {
  const notificationId = notification.id ?? `mock-${Date.now()}`;

  // Attempt to inject a notification via the notification client's test API
  // This assumes the notification-client package exposes a window.__NOTIFICATION_TEST_API__
  await page.evaluate(
    ({ notificationData, id }) => {
      // Check if the test API is available
      const testApi = (window as unknown as { __NOTIFICATION_TEST_API__?: {
        injectNotification: (n: {
          id: string;
          title: string;
          body?: string;
          type?: string;
          actionUrl?: string;
        }) => void;
      } }).__NOTIFICATION_TEST_API__;

      if (testApi?.injectNotification) {
        testApi.injectNotification({
          id,
          title: notificationData.title,
          body: notificationData.body,
          type: notificationData.type,
          actionUrl: notificationData.actionUrl,
        });
      }
    },
    { notificationData: notification, id: notificationId }
  );
}

/**
 * Mock a toast notification by evaluating JavaScript in the page context.
 * This adds a toast popup for testing toast UI functionality.
 * Use mockSignalRNotification() for testing the notifications list.
 *
 * NOTE: This requires the notification-client package to expose a mock/test API.
 * If not available, this will log a warning and do nothing.
 *
 * @param page - Playwright page instance
 * @param notification - The notification data to inject as a toast
 */
export async function mockToastNotification(
  page: Page,
  notification: MockNotificationData
): Promise<void> {
  const notificationId = notification.id ?? `mock-toast-${Date.now()}`;

  await page.evaluate(
    ({ notificationData, id }) => {
      const testApi = (window as unknown as { __NOTIFICATION_TEST_API__?: {
        addToast: (n: {
          id: string;
          title: string;
          body?: string;
          type?: string;
          actionUrl?: string;
        }) => void;
      } }).__NOTIFICATION_TEST_API__;

      if (testApi?.addToast) {
        testApi.addToast({
          id,
          title: notificationData.title,
          body: notificationData.body,
          type: notificationData.type,
          actionUrl: notificationData.actionUrl,
        });
      }
    },
    { notificationData: notification, id: notificationId }
  );
}

/**
 * Check if the notification test API is available and store is registered.
 * Waits up to 5 seconds for the store to become ready.
 */
export async function hasNotificationTestApi(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __NOTIFICATION_TEST_API__?: { isStoreReady?: () => boolean };
        }).__NOTIFICATION_TEST_API__;
        return api?.isStoreReady?.() === true;
      },
      { timeout: STORE_READY_TIMEOUT_MS }
    );
    return true;
  } catch {
    return false;
  }
}
