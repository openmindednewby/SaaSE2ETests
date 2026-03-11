import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { TestIds, testIdSelector } from '../shared/testIds.js';

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    // Use testId-only locators for speed (no .or() fallback chains)
    this.usernameInput = page.locator(testIdSelector(TestIds.USERNAME_INPUT));
    this.passwordInput = page.locator(testIdSelector(TestIds.PASSWORD_INPUT));
    this.loginButton = page.locator(testIdSelector(TestIds.LOGIN_BUTTON));
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to login page
   */
  async goto() {
    // Expo Router: (auth) is a route group, the URL is just /login
    await super.goto('/login');
  }

  /**
   * Fill in login form and submit
   */
  async login(username: string, password: string) {
    await this.dismissOverlay();
    // Wait for React to render the login form (dev builds can take 10+ seconds)
    await this.usernameInput.waitFor({ state: 'visible', timeout: 30000 });
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for login to complete and redirect to protected area
   * Expo Router: (protected) is a route group, URL doesn't include parentheses
   */
  async waitForLoginComplete(timeout = 30000) {
    // After login, we should be redirected away from /login to a protected route
    // Common protected routes: /quiz-templates, /quiz-active, /quiz-answers, /tenants, /users
    await expect(this.page).not.toHaveURL(/\/login/, { timeout });
  }

  /**
   * Perform login and wait for success.
   * Retries once on failure to handle transient backend slowness.
   */
  async loginAndWait(username: string, password: string) {
    const MAX_ATTEMPTS = 2;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.login(username, password);
        const timeout = attempt < MAX_ATTEMPTS ? 15000 : 30000;
        await this.waitForLoginComplete(timeout);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_ATTEMPTS) {
          await this.goto();
        }
      }
    }

    throw lastError!;
  }

  /**
   * Check if login button is enabled
   */
  async isLoginButtonEnabled(): Promise<boolean> {
    return await this.loginButton.isEnabled();
  }

  /**
   * Check if currently loading
   */
  async isLoading(): Promise<boolean> {
    return await this.loadingIndicator.isVisible();
  }

  /**
   * Expect to be on a protected route after login
   * Expo Router: (protected) is a route group, URL doesn't include parentheses
   */
  async expectToBeOnProtectedRoute() {
    // Verify we're NOT on login page anymore (means we reached a protected route)
    await expect(this.page).not.toHaveURL(/\/login/, { timeout: 10000 });
  }

  /**
   * Expect an error alert to appear (uses browser alert on web)
   */
  async expectErrorAlert(messagePattern: RegExp) {
    // The app uses window.alert on web platform
    // We need to handle this with a dialog handler
    this.page.once('dialog', async dialog => {
      expect(dialog.message()).toMatch(messagePattern);
      await dialog.accept();
    });
  }

  /**
   * Clear the form
   */
  async clearForm() {
    await this.usernameInput.clear();
    await this.passwordInput.clear();
  }
}
