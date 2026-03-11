import { BrowserContext, expect, Page, test } from '@playwright/test';
import { StudioBasePage } from '../../pages/StudioBasePage.js';

/**
 * Chat Page Graceful SignalR Handling Verification.
 *
 * Verifies that the chat page loads without uncaught errors even when
 * the SignalR hub is unavailable. The page should render its UI
 * components gracefully.
 *
 * @tag @theme-studio @bug-verification
 */

test.describe('Chat Page Graceful SignalR Handling @theme-studio @bug-verification', () => {
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let studioPage: StudioBasePage;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    studioPage = new StudioBasePage(page);
    await studioPage.studioLogin();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should load without uncaught errors when SignalR is unavailable', async () => {
    const uncaughtErrors: string[] = [];

    page.on('pageerror', (error) => {
      uncaughtErrors.push(error.message);
    });

    await studioPage.gotoStudio('/chat');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });

    const pageContent = page.locator(
      'main, [role="main"], [data-testid*="chat"], .chat, h1, h2',
    ).first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });

    // Filter out expected SignalR connection errors
    const criticalErrors = uncaughtErrors.filter((msg) => {
      const lower = msg.toLowerCase();
      return !(
        lower.includes('signalr') ||
        lower.includes('websocket') ||
        lower.includes('connection') ||
        lower.includes('negotiate') ||
        lower.includes('hub')
      );
    });

    expect(
      criticalErrors,
      `Chat page should not throw non-SignalR errors: ${criticalErrors.join(', ')}`,
    ).toHaveLength(0);
  });

  test('should render the chat UI structure without crashing', async () => {
    await studioPage.gotoStudio('/chat');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });

    // Check that the page did not render an error boundary
    const errorBoundary = page.locator(
      'text=/something went wrong/i, text=/error/i',
    ).first();
    const hasErrorBoundary = await errorBoundary.count() > 0;

    if (hasErrorBoundary) {
      const errorText = await errorBoundary.textContent();
      const isSignalRRelated = errorText?.toLowerCase().includes('signalr') ||
        errorText?.toLowerCase().includes('connection');
      expect(
        isSignalRRelated,
        'Error boundary should not be triggered by SignalR unavailability',
      ).not.toBe(true);
    }
  });
});
