import { Page } from '@playwright/test';

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
   * Dismiss any blocking overlays (like PWA install prompts).
   * Uses count() which is instant instead of isVisible() with timeout.
   */
  async dismissOverlay() {
    const dismissButton = this.page.getByRole('button', { name: /continue in browser/i });
    // count() is instant - no timeout wait if element doesn't exist
    if (await dismissButton.count() > 0) {
      await dismissButton.click();
    }
  }

  /**
   * Navigate to a specific path.
   * Uses 'commit' for fastest navigation - let assertions wait for elements.
   */
  async goto(path: string) {
    await this.page.goto(path, { waitUntil: 'commit' });
    // Run dismissOverlay and restoreAuth in parallel for speed
    await Promise.all([
      this.dismissOverlay(),
      !path.includes('/login') ? this.restoreAuth() : Promise.resolve(),
    ]);
  }

  /**
   * Wait for a loading indicator to disappear.
   * Uses count() for instant check instead of isVisible() with timeout.
   */
  async waitForLoading() {
    const loadingIndicator = this.page.locator('[role="progressbar"], [data-testid="loading"]');
    // count() is instant - no timeout wait if element doesn't exist
    if (await loadingIndicator.count() > 0) {
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
