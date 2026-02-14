/**
 * Page Object for Notifications screen and notification-related UI elements.
 *
 * Handles:
 * - Notification bell and badge in the topbar
 * - Notification list screen
 * - Real-time toast notifications
 * - Mark as read functionality
 */

import { Locator, Page, expect } from '@playwright/test';

import { BasePage } from './BasePage.js';
import { TestIds, testIdSelector } from '../shared/testIds.js';

/** Default timeout for notification-related operations */
const NOTIFICATION_TIMEOUT_MS = 5000;

/** Toast auto-dismiss duration from the app */
const TOAST_DURATION_MS = 5000;

/** Buffer for animation timing */
const ANIMATION_BUFFER_MS = 500;

export class NotificationsPage extends BasePage {
  // Notification Bell (in topbar)
  readonly notificationBell: Locator;
  readonly notificationBadge: Locator;

  // Notifications Screen
  readonly notificationScreen: Locator;
  readonly notificationList: Locator;
  readonly markAllReadButton: Locator;
  readonly emptyState: Locator;
  readonly connectionStatus: Locator;

  // Toast Container
  readonly toastContainer: Locator;

  constructor(page: Page) {
    super(page);

    // Bell and Badge
    this.notificationBell = page.locator(testIdSelector(TestIds.NOTIFICATION_BELL));
    this.notificationBadge = page.locator(testIdSelector(TestIds.NOTIFICATION_BELL_BADGE));

    // Notifications Screen
    this.notificationScreen = page.locator(testIdSelector(TestIds.NOTIFICATION_SCREEN));
    this.notificationList = page.locator(testIdSelector(TestIds.NOTIFICATION_LIST));
    this.markAllReadButton = page.locator(testIdSelector(TestIds.NOTIFICATION_MARK_ALL_READ));
    this.emptyState = page.locator(testIdSelector(TestIds.NOTIFICATION_EMPTY_STATE));
    this.connectionStatus = page.locator(testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS));

    // Toast
    this.toastContainer = page.locator(testIdSelector(TestIds.NOTIFICATION_TOAST_CONTAINER));
  }

  /**
   * Navigate to a path (or default to notifications screen)
   * @param path - Optional path to navigate to (defaults to '/notifications')
   */
  async goto(path: string = '/notifications'): Promise<void> {
    await super.goto(path);
    await this.waitForLoading();
  }

  /**
   * Navigate to notifications by clicking the bell button
   */
  async clickBellToNavigate(): Promise<void> {
    await this.notificationBell.click();
    await expect(this.page).toHaveURL(/\/notifications/, { timeout: NOTIFICATION_TIMEOUT_MS });
  }

  // ==================== Badge Methods ====================

  /**
   * Get the unread count from the badge
   * Returns 0 if badge is not visible
   */
  async getUnreadCount(): Promise<number> {
    // Use count() for instant check
    if (await this.notificationBadge.count() === 0) {
      return 0;
    }

    const isVisible = await this.notificationBadge.isVisible();
    if (!isVisible) {
      return 0;
    }

    const text = await this.notificationBadge.textContent();
    if (!text) {
      return 0;
    }

    // Handle "99+" overflow case
    if (text.includes('+')) {
      return 100;
    }

    const count = parseInt(text, 10);
    return isNaN(count) ? 0 : count;
  }

  /**
   * Expect the badge to show a specific count
   * @param count - Expected count (0 means badge should be hidden)
   */
  async expectBadgeCount(count: number): Promise<void> {
    if (count === 0) {
      await expect(this.notificationBadge).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
    } else {
      await expect(this.notificationBadge).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
      const expectedText = count > 99 ? '99+' : String(count);
      await expect(this.notificationBadge).toHaveText(expectedText, { timeout: NOTIFICATION_TIMEOUT_MS });
    }
  }

  /**
   * Expect badge to be visible (has unread notifications)
   */
  async expectBadgeVisible(): Promise<void> {
    await expect(this.notificationBadge).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect badge to be hidden (no unread notifications)
   */
  async expectBadgeHidden(): Promise<void> {
    await expect(this.notificationBadge).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  // ==================== Notification List Methods ====================

  /**
   * Get all notification items in the list
   */
  getNotificationItems(): Locator {
    return this.page.locator(testIdSelector(TestIds.NOTIFICATION_ITEM));
  }

  /**
   * Get notification item by index
   */
  getNotificationItem(index: number): Locator {
    return this.getNotificationItems().nth(index);
  }

  /**
   * Get the count of notification items
   */
  async getNotificationCount(): Promise<number> {
    return await this.getNotificationItems().count();
  }

  /**
   * Click on a notification item
   */
  async clickNotification(index: number): Promise<void> {
    const item = this.getNotificationItem(index);
    await item.click();
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    await expect(this.markAllReadButton).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
    await this.markAllReadButton.click();
    await this.waitForLoading();
  }

  /**
   * Expect the mark all read button to be visible
   * (indicates there are unread notifications)
   */
  async expectMarkAllReadVisible(): Promise<void> {
    await expect(this.markAllReadButton).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect the mark all read button to be hidden
   * (indicates all notifications are read)
   */
  async expectMarkAllReadHidden(): Promise<void> {
    await expect(this.markAllReadButton).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect empty state to be visible
   */
  async expectEmptyState(): Promise<void> {
    await expect(this.emptyState).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect notification list to have items
   */
  async expectHasNotifications(): Promise<void> {
    await expect(this.getNotificationItems().first()).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect the connection status banner to be visible
   * (indicates disconnected state)
   */
  async expectDisconnected(): Promise<void> {
    await expect(this.connectionStatus).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect to be connected (no warning banner)
   */
  async expectConnected(): Promise<void> {
    await expect(this.connectionStatus).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  // ==================== Toast Methods ====================

  /**
   * Get all visible toasts
   */
  getToasts(): Locator {
    return this.page.locator(
      `[data-testid^="${TestIds.NOTIFICATION_TOAST}-"]` +
      `:not([data-testid="${TestIds.NOTIFICATION_TOAST_CONTAINER}"])` +
      `:not([data-testid^="${TestIds.NOTIFICATION_TOAST_DISMISS}-"])`
    );
  }

  /**
   * Get the first visible toast
   */
  getFirstToast(): Locator {
    return this.getToasts().first();
  }

  /**
   * Get toast by notification ID
   */
  getToastById(notificationId: string): Locator {
    return this.page.locator(`[data-testid="${TestIds.NOTIFICATION_TOAST}-${notificationId}"]`);
  }

  /**
   * Wait for a toast to appear
   */
  async waitForToast(timeout: number = NOTIFICATION_TIMEOUT_MS): Promise<Locator> {
    const toast = this.getFirstToast();
    await expect(toast).toBeVisible({ timeout });
    return toast;
  }

  /**
   * Wait for a toast with specific text
   */
  async waitForToastWithText(
    text: string | RegExp,
    timeout: number = NOTIFICATION_TIMEOUT_MS
  ): Promise<Locator> {
    const toast = this.getToasts().filter({ hasText: text }).first();
    await expect(toast).toBeVisible({ timeout });
    return toast;
  }

  /**
   * Dismiss a toast by clicking its dismiss button
   */
  async dismissToast(toast?: Locator): Promise<void> {
    const targetToast = toast ?? this.getFirstToast();

    const testId = await targetToast.getAttribute('data-testid');
    if (!testId) {
      throw new Error('Toast does not have a data-testid attribute');
    }

    const notificationId = testId.replace(`${TestIds.NOTIFICATION_TOAST}-`, '');
    const dismissButton = this.page.locator(
      `[data-testid="${TestIds.NOTIFICATION_TOAST_DISMISS}-${notificationId}"]`
    );

    await dismissButton.click();
    await expect(targetToast).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Wait for toast to auto-dismiss
   */
  async waitForToastAutoDismiss(toast?: Locator): Promise<void> {
    const targetToast = toast ?? this.getFirstToast();
    const totalTimeout = TOAST_DURATION_MS + ANIMATION_BUFFER_MS + NOTIFICATION_TIMEOUT_MS;
    await expect(targetToast).not.toBeVisible({ timeout: totalTimeout });
  }

  /**
   * Count visible toasts
   */
  async countToasts(): Promise<number> {
    return await this.getToasts().count();
  }

  /**
   * Expect a specific number of toasts to be visible
   */
  async expectToastCount(count: number): Promise<void> {
    await expect(this.getToasts()).toHaveCount(count, { timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect the toast container to be visible
   */
  async expectToastContainerVisible(): Promise<void> {
    await expect(this.toastContainer).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Expect no toasts to be visible
   */
  async expectNoToasts(): Promise<void> {
    await expect(this.getToasts()).toHaveCount(0, { timeout: NOTIFICATION_TIMEOUT_MS });
  }

  /**
   * Dismiss all visible toasts
   */
  async dismissAllToasts(): Promise<void> {
    const count = await this.countToasts();
    for (let i = 0; i < count; i++) {
      const toast = this.getFirstToast();
      if (await toast.isVisible()) {
        await this.dismissToast(toast);
      }
    }
  }

  // ==================== Test Helpers ====================

  /**
   * Wait for the notification test API store to be registered.
   * The API object is created at module level but the store is
   * registered asynchronously when TestApiRegistration mounts.
   */
  async waitForTestApiReady(timeout: number = NOTIFICATION_TIMEOUT_MS): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __NOTIFICATION_TEST_API__?: { isStoreReady?: () => boolean };
        }).__NOTIFICATION_TEST_API__;
        return api?.isStoreReady?.() === true;
      },
      { timeout }
    );
  }

  /**
   * Mock notification data interface
   */
  private createMockNotificationData(notification: {
    id?: string;
    title: string;
    body?: string;
    type?: string;
    actionUrl?: string;
  }): { data: typeof notification; id: string } {
    const notificationId = notification.id ?? `mock-${Date.now()}`;
    return { data: notification, id: notificationId };
  }

  /**
   * Mock a notification via the test API (if available)
   * This injects a fake notification into the notifications list for testing.
   * Use mockToast() for testing toast popups.
   */
  async mockNotification(notification: {
    id?: string;
    title: string;
    body?: string;
    type?: string;
    actionUrl?: string;
  }): Promise<void> {
    await this.waitForTestApiReady();
    const { data, id } = this.createMockNotificationData(notification);

    await this.page.evaluate(
      ({ data, id }) => {
        const testApi = (window as unknown as {
          __NOTIFICATION_TEST_API__?: {
            injectNotification: (n: {
              id: string;
              title: string;
              body?: string;
              type?: string;
              actionUrl?: string;
            }) => void;
          };
        }).__NOTIFICATION_TEST_API__;

        if (testApi?.injectNotification) {
          testApi.injectNotification({
            id,
            title: data.title,
            body: data.body,
            type: data.type,
            actionUrl: data.actionUrl,
          });
        } else {
          console.warn(
            '[E2E Test] Notification test API not available. ' +
            'Mock notification injection is not supported in this build.'
          );
        }
      },
      { data, id }
    );
  }

  /**
   * Mock a toast notification via the test API (if available)
   * This adds a toast popup for testing toast UI functionality.
   * Use mockNotification() for testing the notifications list.
   */
  async mockToast(notification: {
    id?: string;
    title: string;
    body?: string;
    type?: string;
    actionUrl?: string;
  }): Promise<void> {
    await this.waitForTestApiReady();
    const { data, id } = this.createMockNotificationData(notification);

    await this.page.evaluate(
      ({ data, id }) => {
        const testApi = (window as unknown as {
          __NOTIFICATION_TEST_API__?: {
            addToast: (n: {
              id: string;
              title: string;
              body?: string;
              type?: string;
              actionUrl?: string;
            }) => void;
          };
        }).__NOTIFICATION_TEST_API__;

        if (testApi?.addToast) {
          testApi.addToast({
            id,
            title: data.title,
            body: data.body,
            type: data.type,
            actionUrl: data.actionUrl,
          });
        } else {
          console.warn(
            '[E2E Test] Notification test API not available. ' +
            'Mock toast injection is not supported in this build.'
          );
        }
      },
      { data, id }
    );
  }
}
