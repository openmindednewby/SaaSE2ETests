/**
 * Notification Toast Test Utilities
 *
 * Helper functions for testing toast notification features in E2E tests.
 * Provides utilities for waiting on toasts, checking badge counts,
 * and managing toast visibility.
 *
 * For notification list, mock, and store helpers, see notificationListHelpers.ts.
 */

import { expect, Page, Locator } from '@playwright/test';

import { TestIds, testIdSelector } from '../../shared/testIds.js';

export { hasNotificationTestApi } from './notificationListHelpers.js';

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

