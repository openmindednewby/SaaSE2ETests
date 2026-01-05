import { Page, Locator, expect } from '@playwright/test';

export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific path
   */
  async goto(path: string) {
    await this.page.goto(path);
  }

  /**
   * Wait for network to be idle
   */
  async waitForNetworkIdle() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for a loading indicator to disappear
   */
  async waitForLoading() {
    const loadingIndicator = this.page.locator('[role="progressbar"], [data-testid="loading"]');
    if (await loadingIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
      await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 });
    }
  }

  /**
   * Get page title text
   */
  async getPageTitle(): Promise<string> {
    const title = this.page.locator('h1, [role="heading"]').first();
    return await title.textContent() || '';
  }

  /**
   * Click refresh button (common pattern in the app)
   */
  async clickRefresh() {
    const refreshButton = this.page.getByRole('button', { name: /refresh/i });
    await refreshButton.click();
    await this.waitForLoading();
  }
}
