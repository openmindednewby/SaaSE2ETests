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
    const MAX_ATTEMPTS = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.login(username, password);
        const timeout = attempt < MAX_ATTEMPTS ? 20000 : 45000;
        await this.waitForLoginComplete(timeout);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_ATTEMPTS) {
          // Navigate back to login for a fresh retry
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
   * Submit the login form and assert the resulting error message matches the
   * pattern.
   *
   * The BaseClient `/login` screen (the SPA the @identity suite drives via
   * BASE_URL) surfaces missing-fields and invalid-credential errors through a
   * native browser dialog (`window.alert`, via `showAlert`), NOT an inline
   * text node. Playwright auto-dismisses dialogs by default, so we register a
   * one-shot `dialog` handler BEFORE clicking submit to capture the message,
   * then dismiss it and assert. The `auth-login-error` inline testID exists in
   * the per-app erevna/katalogos LoginForm, but not in this legacy SPA.
   */
  async submitAndExpectError(
    username: string,
    password: string,
    messagePattern: RegExp,
  ) {
    const dialogMessage = await this.captureLoginDialog(async () => {
      await this.dismissOverlay();
      await this.usernameInput.waitFor({ state: 'visible', timeout: 30000 });
      await this.usernameInput.fill(username);
      await this.passwordInput.fill(password);
      await this.loginButton.click();
    });

    expect(dialogMessage, 'expected a login error dialog to appear').not.toBeNull();
    expect(dialogMessage ?? '').toMatch(messagePattern);
  }

  /**
   * Click submit with empty fields and assert the missing-fields error dialog.
   */
  async submitEmptyAndExpectError(messagePattern: RegExp) {
    const dialogMessage = await this.captureLoginDialog(async () => {
      await this.loginButton.click();
    });

    expect(dialogMessage, 'expected a missing-fields error dialog to appear').not.toBeNull();
    expect(dialogMessage ?? '').toMatch(messagePattern);
  }

  /**
   * Register a one-shot `dialog` handler, run `action` (which is expected to
   * trigger a `window.alert`), capture + dismiss the dialog, and return its
   * message. Returns null if no dialog appeared within the timeout.
   */
  private async captureLoginDialog(action: () => Promise<void>): Promise<string | null> {
    const DIALOG_TIMEOUT = 10000;
    const dialogPromise = this.page
      .waitForEvent('dialog', { timeout: DIALOG_TIMEOUT })
      .then(async (dialog) => {
        const message = dialog.message();
        await dialog.dismiss();
        return message;
      })
      .catch(() => null);

    await action();
    return await dialogPromise;
  }

  /**
   * Clear the form
   */
  async clearForm() {
    await this.usernameInput.clear();
    await this.passwordInput.clear();
  }
}
