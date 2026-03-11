import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

const STUDIO_BASE_URL = 'http://localhost:4444';

/**
 * Base page object for the SyncfusionThemeStudio app.
 *
 * The studio app runs on port 4444 and uses a demo login (pre-filled
 * credentials). This base page handles navigation and authentication
 * within the studio context.
 */
export class StudioBasePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to a studio route using the studio base URL.
   * Overrides BasePage.goto to use the studio origin.
   */
  async gotoStudio(path: string) {
    await this.page.goto(`${STUDIO_BASE_URL}${path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }

  /**
   * Perform the demo login on the studio app.
   * The form is pre-filled, so we just click submit.
   */
  async studioLogin() {
    await this.gotoStudio('/');
    const submitButton = this.page.locator('[data-testid="login-submit"]');
    await expect(submitButton).toBeVisible({ timeout: 15000 });
    await submitButton.click();
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  }

  /**
   * Navigate to a protected studio page after ensuring login.
   */
  async gotoProtectedStudioPage(path: string) {
    await this.gotoStudio(path);

    // If redirected to login, perform login and retry
    const currentUrl = this.page.url();
    if (currentUrl.includes('/login') || currentUrl.endsWith('/')) {
      await this.studioLogin();
      await this.gotoStudio(path);
    }
  }
}
