import { Page } from '@playwright/test';

export abstract class BasePage {
  readonly page: Page;
  private overlayHandlersRegistered = false;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Register locator handlers that auto-dismiss blocking overlays
   * (cookie consent banner) whenever they block an action.
   * Only registers once per page.
   */
  async registerOverlayHandlers() {
    if (this.overlayHandlersRegistered) return;
    this.overlayHandlersRegistered = true;

    // Cookie consent banner
    await this.page.addLocatorHandler(
      this.page.locator('[data-testid="cookie-consent-banner"]'),
      async () => {
        // Use noWaitAfter + try/catch: the banner can be detached mid-navigation
        try {
          await this.page.locator('[data-testid="cookie-consent-accept-all"]').click({ noWaitAfter: true, timeout: 5000 });
        } catch {
          // Banner disappeared during navigation — safe to ignore
        }
      },
    );
  }

  /**
   * Mark all tooltip tours as "seen" in localStorage so they never appear during tests.
   * This prevents the tooltip overlay from blocking Playwright interactions.
   */
  async suppressTooltipTours() {
    try {
      await this.page.evaluate(() => {
        const tourIds = ['dashboard', 'editor', 'public-menu'];
        for (const id of tourIds) {
          localStorage.setItem(`menuflow_tour_seen_${id}`, 'true');
        }
      });
    } catch {
      // Ignore errors if page context is not ready
    }
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
   * Dismiss any blocking overlays (PWA install prompts).
   * Cookie consent banner is handled automatically by addLocatorHandler.
   * Uses count() which is instant instead of isVisible() with timeout.
   */
  async dismissOverlay() {
    // PWA install toast — dismiss if present
    const pwaDismiss = this.page.locator('[data-testid="pwa-cancel-button"]');
    if (await pwaDismiss.count() > 0) {
      await pwaDismiss.click();
    }
  }

  /**
   * Navigate to a specific path.
   * Waits for 'domcontentloaded' to ensure the JS bundle is downloaded before proceeding.
   * Retries on NS_BINDING_ABORTED (Firefox navigation cancel) and navigation timeouts
   * (Firefox under WSL2/Docker can exceed 60s on first load under concurrency).
   */
  async goto(path: string) {
    await this.registerOverlayHandlers();

    const MAX_NAV_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_NAV_RETRIES; attempt++) {
      try {
        await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : '';
        const isRetryable = msg.includes('NS_BINDING_ABORTED') || msg.includes('Timeout');
        if (!isRetryable || attempt === MAX_NAV_RETRIES) throw error;
        // Navigation failed transiently; retry (assets may be cached on next attempt)
      }
    }

    // Run dismissOverlay, restoreAuth, and suppressTooltipTours in parallel for speed
    await Promise.all([
      this.dismissOverlay(),
      !path.includes('/login') ? this.restoreAuth() : Promise.resolve(),
      this.suppressTooltipTours(),
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
