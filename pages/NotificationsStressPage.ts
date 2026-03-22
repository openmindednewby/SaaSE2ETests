import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/** Default timeout for notification-related operations */
const NOTIFICATION_TIMEOUT_MS = 10000;

/**
 * Page object for notification stress testing and test API helpers.
 * Handles mock notification injection, toast mocking, and test API readiness.
 *
 * For core notification operations (bell, badge, list, preferences),
 * use NotificationsPage.
 */
export class NotificationsStressPage extends BasePage {
  // Toast Container
  readonly toastContainer: Locator;

  // Preferences Screen
  readonly preferencesScreen: Locator;
  readonly preferencesSaveButton: Locator;
  readonly preferenceDropdown: Locator;
  readonly settingsButton: Locator;

  constructor(page: Page) {
    super(page);

    this.toastContainer = page.locator(testIdSelector(TestIds.NOTIFICATION_TOAST_CONTAINER));

    this.preferencesScreen = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SCREEN));
    this.preferencesSaveButton = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCES_SAVE_BUTTON));
    this.preferenceDropdown = page.locator(testIdSelector(TestIds.NOTIFICATION_PREFERENCE_DROPDOWN));
    this.settingsButton = page.locator(testIdSelector(TestIds.NOTIFICATION_SETTINGS_BUTTON));
  }

  async goto(path: string = '/notifications'): Promise<void> {
    await super.goto(path);
    await this.waitForLoading();
  }

  /**
   * Wait for the notification test API store to be registered.
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
   * Mock a notification via the test API.
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
              id: string; title: string; body?: string; type?: string; actionUrl?: string;
            }) => void;
          };
        }).__NOTIFICATION_TEST_API__;
        if (testApi?.injectNotification) {
          testApi.injectNotification({ id, title: data.title, body: data.body, type: data.type, actionUrl: data.actionUrl });
        }
      },
      { data, id }
    );
  }

  /**
   * Mock a toast notification via the test API.
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
              id: string; title: string; body?: string; type?: string; actionUrl?: string;
            }) => void;
          };
        }).__NOTIFICATION_TEST_API__;
        if (testApi?.addToast) {
          testApi.addToast({ id, title: data.title, body: data.body, type: data.type, actionUrl: data.actionUrl });
        }
      },
      { data, id }
    );
  }

  // ==================== Preferences Methods ====================

  async navigateToPreferences(): Promise<void> {
    await this.goto('/notifications/preferences');
  }

  async isPreferencesAvailable(): Promise<boolean> {
    return await this.preferencesScreen.isVisible({ timeout: 3000 }).catch(() => false);
  }

  async savePreferences(): Promise<void> {
    await expect(this.preferencesSaveButton).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes('/preferences') && (r.request().method() === 'PUT' || r.request().method() === 'POST'),
      { timeout: 10000 }
    ).catch(() => null);
    await this.preferencesSaveButton.click();
    await responsePromise;
    await this.waitForLoading();
  }

  async expectPreferencesScreen(): Promise<void> {
    await expect(this.preferencesScreen).toBeVisible({ timeout: NOTIFICATION_TIMEOUT_MS });
  }

  async hasTestApi(): Promise<boolean> {
    try { await this.waitForTestApiReady(); return true; } catch { return false; }
  }
}
