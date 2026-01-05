import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    // Based on login.tsx - uses placeholder text for inputs
    this.usernameInput = page.getByPlaceholder(/enter username/i);
    this.passwordInput = page.getByPlaceholder(/enter password/i);
    this.loginButton = page.getByRole('button', { name: /login/i });
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await super.goto('/(auth)/login');
  }

  /**
   * Fill in login form and submit
   */
  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for login to complete and redirect to protected area
   */
  async waitForLoginComplete() {
    await expect(this.page).toHaveURL(/\(protected\)/, { timeout: 30000 });
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
   * Expect to be on the protected route after login
   */
  async expectToBeOnProtectedRoute() {
    await expect(this.page).toHaveURL(/\(protected\)/);
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
