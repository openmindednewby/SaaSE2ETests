import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for the SyncfusionThemeStudio demo login page.
 *
 * The studio app uses a simple demo login (pre-filled credentials)
 * that navigates to /dashboard on submit. No real auth is involved.
 */
export class StudioLoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator(testIdSelector(TestIds.STUDIO_LOGIN_USERNAME));
    this.passwordInput = page.locator(testIdSelector(TestIds.STUDIO_LOGIN_PASSWORD));
    this.submitButton = page.locator(testIdSelector(TestIds.STUDIO_LOGIN_SUBMIT));
  }

  /**
   * Navigate to the studio login page (root path on studio base URL).
   */
  async gotoStudioLogin() {
    await super.goto('/');
    await expect(this.submitButton).toBeVisible({ timeout: 10000 });
  }

  /**
   * Submit the demo login form with pre-filled credentials.
   * The form is pre-filled so we just click submit.
   */
  async loginWithDefaults() {
    await this.submitButton.click();
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  }

  /**
   * Full login flow: navigate to login, submit, wait for dashboard.
   */
  async loginAndNavigateToDashboard() {
    await this.gotoStudioLogin();
    await this.loginWithDefaults();
  }
}
