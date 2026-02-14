/**
 * Notification Test Utilities
 *
 * Helper functions for testing notification features in E2E tests.
 * Provides utilities for waiting on toasts, checking badge counts,
 * and mocking notification events.
 */

import { expect, Page, Locator } from '@playwright/test';

import { TestIds, testIdSelector } from '../../shared/testIds.js';

/** Default timeout for notification-related waits (5 seconds) */
const NOTIFICATION_TIMEOUT_MS = 5000;

/** Toast auto-dismiss duration from the app (5 seconds) */
const TOAST_DURATION_MS = 5000;

/** Buffer time to wait for toast animation */
const TOAST_ANIMATION_BUFFER_MS = 500;

/**
 * Get the notification toast container locator
 */
export function getToastContainer(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_TOAST_CONTAINER));
}

/**
 * Get all visible notification toasts
 */
export function getToasts(page: Page): Locator {
  return page.locator(
    `[data-testid^="${TestIds.NOTIFICATION_TOAST}-"]` +
    `:not([data-testid="${TestIds.NOTIFICATION_TOAST_CONTAINER}"])` +
    `:not([data-testid^="${TestIds.NOTIFICATION_TOAST_DISMISS}-"])`
  );
}

/**
 * Get the first visible toast
 */
export function getFirstToast(page: Page): Locator {
  return getToasts(page).first();
}

/**
 * Wait for a notification toast to appear
 * @param page - Playwright page instance
 * @param timeout - Optional timeout override
 */
export async function waitForNotificationToast(
  page: Page,
  timeout: number = NOTIFICATION_TIMEOUT_MS
): Promise<Locator> {
  const toast = getFirstToast(page);
  await expect(toast).toBeVisible({ timeout });
  return toast;
}

/**
 * Wait for a toast with specific text content
 * @param page - Playwright page instance
 * @param text - Text or regex to match in the toast
 * @param timeout - Optional timeout override
 */
export async function waitForToastWithText(
  page: Page,
  text: string | RegExp,
  timeout: number = NOTIFICATION_TIMEOUT_MS
): Promise<Locator> {
  const toast = getToasts(page).filter({ hasText: text }).first();
  await expect(toast).toBeVisible({ timeout });
  return toast;
}

/**
 * Dismiss a notification toast by clicking its dismiss button
 * @param page - Playwright page instance
 * @param toast - Optional specific toast locator to dismiss (defaults to first toast)
 */
export async function dismissNotificationToast(
  page: Page,
  toast?: Locator
): Promise<void> {
  const targetToast = toast ?? getFirstToast(page);

  // Get the toast's testID to find its dismiss button
  const testId = await targetToast.getAttribute('data-testid');
  if (!testId) {
    throw new Error('Toast does not have a data-testid attribute');
  }

  // Extract the notification ID from the toast testId
  // Format: notification-toast-{id}
  const notificationId = testId.replace(`${TestIds.NOTIFICATION_TOAST}-`, '');
  const dismissButton = page.locator(
    `[data-testid="${TestIds.NOTIFICATION_TOAST_DISMISS}-${notificationId}"]`
  );

  await dismissButton.click();

  // Wait for toast to be removed
  await expect(targetToast).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
}

/**
 * Wait for toast to auto-dismiss (default 5 seconds + animation buffer)
 * @param page - Playwright page instance
 * @param toast - Optional specific toast locator to wait for
 */
export async function waitForToastAutoDismiss(
  page: Page,
  toast?: Locator
): Promise<void> {
  const targetToast = toast ?? getFirstToast(page);

  // Use Playwright's auto-retry assertion to wait for the toast to disappear
  // The toast should auto-dismiss after TOAST_DURATION_MS
  await expect(targetToast).not.toBeVisible({
    timeout: TOAST_DURATION_MS + TOAST_ANIMATION_BUFFER_MS + NOTIFICATION_TIMEOUT_MS,
  });
}

/**
 * Get the notification badge element
 */
export function getNotificationBadge(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_BELL_BADGE));
}

/**
 * Get the notification bell button
 */
export function getNotificationBell(page: Page): Locator {
  return page.locator(testIdSelector(TestIds.NOTIFICATION_BELL));
}

/**
 * Get the unread count from the notification badge
 * Returns 0 if badge is not visible (no unread notifications)
 * @param page - Playwright page instance
 */
export async function getUnreadCount(page: Page): Promise<number> {
  const badge = getNotificationBadge(page);

  // Use count() for instant check - no timeout wait
  if (await badge.count() === 0) {
    return 0;
  }

  const isVisible = await badge.isVisible();
  if (!isVisible) {
    return 0;
  }

  const text = await badge.textContent();
  if (!text) {
    return 0;
  }

  // Handle "99+" case
  if (text.includes('+')) {
    return 100; // Return a value > 99 to indicate overflow
  }

  const count = parseInt(text, 10);
  return isNaN(count) ? 0 : count;
}

/**
 * Expect the notification badge to show a specific count
 * @param page - Playwright page instance
 * @param expectedCount - Expected unread count (0 means badge should not be visible)
 */
export async function expectUnreadCount(
  page: Page,
  expectedCount: number
): Promise<void> {
  const badge = getNotificationBadge(page);

  if (expectedCount === 0) {
    // Badge should not be visible when count is 0
    await expect(badge).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  } else {
    await expect(badge).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
    const expectedText = expectedCount > 99 ? '99+' : String(expectedCount);
    await expect(badge).toHaveText(expectedText, { timeout: NOTIFICATION_TIMEOUT_MS });
  }
}

/**
 * Navigate to the notifications screen by clicking the bell button
 * @param page - Playwright page instance
 */
export async function navigateToNotifications(page: Page): Promise<void> {
  const bell = getNotificationBell(page);
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
  return page.locator(testIdSelector(TestIds.NOTIFICATION_ITEM));
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

/** Notification data interface for mock functions */
interface MockNotificationData {
  id?: string;
  title: string;
  body?: string;
  type?: string;
  actionUrl?: string;
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
      } else {
        console.warn(
          '[E2E Test] Notification test API not available. ' +
          'Mock notification injection is not supported in this build.'
        );
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
      } else {
        console.warn(
          '[E2E Test] Notification test API not available. ' +
          'Mock toast injection is not supported in this build.'
        );
      }
    },
    { notificationData: notification, id: notificationId }
  );
}

/**
 * Count the number of visible toasts
 * @param page - Playwright page instance
 */
export async function countVisibleToasts(page: Page): Promise<number> {
  const toasts = getToasts(page);
  return await toasts.count();
}

/**
 * Wait for a specific number of toasts to be visible
 * @param page - Playwright page instance
 * @param count - Expected number of toasts
 * @param timeout - Optional timeout override
 */
export async function expectToastCount(
  page: Page,
  count: number,
  timeout: number = NOTIFICATION_TIMEOUT_MS
): Promise<void> {
  const toasts = getToasts(page);
  await expect(toasts).toHaveCount(count, { timeout });
}

/**
 * Dismiss all visible toasts
 * @param page - Playwright page instance
 */
export async function dismissAllToasts(page: Page): Promise<void> {
  const toasts = getToasts(page);
  const count = await toasts.count();

  for (let i = 0; i < count; i++) {
    // Always dismiss the first one since the list shifts after each dismissal
    const toast = toasts.first();
    if (await toast.isVisible()) {
      await dismissNotificationToast(page, toast);
    }
  }
}

/** Default timeout for waiting on the test API store */
const STORE_READY_TIMEOUT_MS = 5000;

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
