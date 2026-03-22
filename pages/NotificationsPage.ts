/** Page Object for Notifications screen and notification-related UI elements. */
import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { TestIds, testIdSelector, testIdStartsWithSelector } from '../shared/testIds.js';

const NOTIFICATION_TIMEOUT_MS = 10000;
const TOAST_DURATION_MS = 5000;
const ANIMATION_BUFFER_MS = 500;

export class NotificationsPage extends BasePage {
  readonly notificationBell: Locator;
  readonly notificationBadge: Locator;
  readonly notificationScreen: Locator;
  readonly notificationList: Locator;
  readonly markAllReadButton: Locator;
  readonly emptyState: Locator;
  readonly connectionStatus: Locator;
  readonly toastContainer: Locator;

  constructor(page: Page) {
    super(page);

    this.notificationBell = page.locator(testIdSelector(TestIds.NOTIFICATION_BELL));
    this.notificationBadge = page.locator(testIdSelector(TestIds.NOTIFICATION_BELL_BADGE));

    this.notificationScreen = page.locator(testIdSelector(TestIds.NOTIFICATION_SCREEN));
    this.notificationList = page.locator(testIdSelector(TestIds.NOTIFICATION_LIST));
    this.markAllReadButton = page.locator(testIdSelector(TestIds.NOTIFICATION_MARK_ALL_READ));
    this.emptyState = page.locator(testIdSelector(TestIds.NOTIFICATION_EMPTY_STATE));
    this.connectionStatus = page.locator(testIdSelector(TestIds.NOTIFICATION_CONNECTION_STATUS));

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

  async expectBadgeVisible(): Promise<void> {
    await expect(this.notificationBadge).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  async expectBadgeHidden(): Promise<void> {
    await expect(this.notificationBadge).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  // ==================== Notification List Methods ====================

  getNotificationItems(): Locator {
    return this.page.locator(testIdStartsWithSelector(TestIds.NOTIFICATION_ITEM));
  }

  getNotificationItem(index: number): Locator {
    return this.getNotificationItems().nth(index);
  }

  async getNotificationCount(): Promise<number> {
    return await this.getNotificationItems().count();
  }

  async clickNotification(index: number): Promise<void> {
    const item = this.getNotificationItem(index);
    await item.click();
  }

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

  async expectEmptyState(): Promise<void> {
    await expect(this.emptyState).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

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

  async expectConnected(): Promise<void> {
    await expect(this.connectionStatus).not.toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  // ==================== Toast Methods ====================

  getToasts(): Locator {
    return this.page.locator(
      `[data-testid^="${TestIds.NOTIFICATION_TOAST}-"]` +
      `:not([data-testid="${TestIds.NOTIFICATION_TOAST_CONTAINER}"])` +
      `:not([data-testid^="${TestIds.NOTIFICATION_TOAST_DISMISS}-"])`
    );
  }

  getFirstToast(): Locator {
    return this.getToasts().first();
  }

  getToastById(notificationId: string): Locator {
    return this.page.locator(`[data-testid="${TestIds.NOTIFICATION_TOAST}-${notificationId}"]`);
  }

  async waitForToast(timeout: number = NOTIFICATION_TIMEOUT_MS): Promise<Locator> {
    const toast = this.getFirstToast();
    await expect(toast).toBeVisible({ timeout });
    return toast;
  }

  async waitForToastWithText(
    text: string | RegExp,
    timeout: number = NOTIFICATION_TIMEOUT_MS
  ): Promise<Locator> {
    const toast = this.getToasts().filter({ hasText: text }).first();
    await expect(toast).toBeVisible({ timeout });
    return toast;
  }

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

  async waitForToastAutoDismiss(toast?: Locator): Promise<void> {
    const targetToast = toast ?? this.getFirstToast();
    const totalTimeout = TOAST_DURATION_MS + ANIMATION_BUFFER_MS + NOTIFICATION_TIMEOUT_MS;
    await expect(targetToast).not.toBeVisible({ timeout: totalTimeout });
  }

  async countToasts(): Promise<number> {
    return await this.getToasts().count();
  }

  async expectToastCount(count: number): Promise<void> {
    await expect(this.getToasts()).toHaveCount(count, { timeout: NOTIFICATION_TIMEOUT_MS });
  }

  async expectToastContainerVisible(): Promise<void> {
    await expect(this.toastContainer).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  async expectNoToasts(): Promise<void> {
    await expect(this.getToasts()).toHaveCount(0, { timeout: NOTIFICATION_TIMEOUT_MS });
  }

  async dismissAllToasts(): Promise<void> {
    const count = await this.countToasts();
    for (let i = 0; i < count; i++) {
      const toast = this.getFirstToast();
      if (await toast.isVisible()) {
        await this.dismissToast(toast);
      }
    }
  }

}
