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
    // Based on login.tsx - uses placeholder text for inputs
    this.usernameInput = page.locator(testIdSelector(TestIds.USERNAME_INPUT)).or(page.getByPlaceholder(/enter username/i));
    this.passwordInput = page.locator(testIdSelector(TestIds.PASSWORD_INPUT)).or(page.getByPlaceholder(/enter password/i));
    // Login button uses SaveButton with title t('login.submit', 'Login')
    this.loginButton = page.locator(testIdSelector(TestIds.LOGIN_BUTTON)).or(page.getByRole('button', { name: /login|sign in/i }));
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
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for login to complete and redirect to protected area
   * Expo Router: (protected) is a route group, URL doesn't include parentheses
   */
  async waitForLoginComplete() {
    // After login, we should be redirected away from /login to a protected route
    // Common protected routes: /quiz-templates, /quiz-active, /quiz-answers, /tenants, /users
    await expect(this.page).not.toHaveURL(/\/login/, { timeout: 30000 });
  }

  /**
   * Perform login and wait for success
   */
  async loginAndWait(username: string, password: string) {
    await this.login(username, password);
    await this.waitForLoginComplete();
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
