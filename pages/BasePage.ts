import { Page, Locator, expect } from '@playwright/test';

export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Restore auth state from localStorage to sessionStorage.
   * The app uses Redux persist which stores auth in sessionStorage under 'persist:auth'.
   * Playwright only persists localStorage, so we copy it back to sessionStorage.
   */
  async restoreAuth() {
    try {
      await this.page.evaluate(() => {
        // Check if auth is already in sessionStorage
        if (sessionStorage.getItem('persist:auth')) {
          return;
        }
        // Copy from localStorage (where Playwright persists it)
        const authState = localStorage.getItem('persist:auth');
        if (authState) {
          sessionStorage.setItem('persist:auth', authState);
        }
      });
    } catch {
      // Ignore errors if page context is not ready (e.g., about:blank)
    }
  }

  /**
   * Navigate to a specific path
   */
  async goto(path: string) {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    // Restore auth after navigation (copy from localStorage to sessionStorage)
    if (!path.includes('/login')) {
      await this.restoreAuth();
    }
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
