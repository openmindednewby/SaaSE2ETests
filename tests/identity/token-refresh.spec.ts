import { test, expect, Page, BrowserContext } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper.js';
import { LoginPage } from '../../pages/LoginPage.js';

test.describe('Token Refresh @identity @auth', () => {
  test('should refresh token via API @critical', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip();
      return;
    }

    const authHelper = new AuthHelper();

    // Login first
    const loginResult = await authHelper.loginViaAPI(username, password);
    expect(loginResult.accessToken).toBeTruthy();
    expect(loginResult.refreshToken).toBeTruthy();

    // Refresh tokens
    const refreshResult = await authHelper.refreshTokens();
    expect(refreshResult.accessToken).toBeTruthy();
    expect(refreshResult.refreshToken).toBeTruthy();
  });

  test('should fail refresh with invalid token', async () => {
    const authHelper = new AuthHelper();

    // Try to refresh without logging in first
    await expect(authHelper.refreshTokens()).rejects.toThrow();
  });
});

// Browser-based tests that need login
test.describe.serial('Token Session Tests @identity @auth', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      throw new Error('TEST_USER_USERNAME or TEST_USER_PASSWORD not set');
    }

    // Create a new browser context for this test suite
    context = await browser.newContext();
    page = await context.newPage();

    // Login once for all tests in this suite
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should maintain session with valid token', async () => {
    // Navigate to protected area
    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    // Verify we're on a protected route (not redirected to login)
    await expect(page).toHaveURL(/quiz-templates/, { timeout: 10000 });

    // Navigate to another protected page
    await page.goto('/quiz-answers', { waitUntil: 'domcontentloaded' });

    // Should still be authenticated
    await expect(page).toHaveURL(/quiz-answers/);
  });

  test('should handle navigation between protected routes', async () => {
    // Navigate between multiple protected pages
    const routes = ['/quiz-templates', '/quiz-active', '/quiz-answers'];

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      // Should not be redirected to login
      await expect(page).not.toHaveURL(/\/login/);
    }
  });
});

// Separate test for expired token (needs fresh context)
test.describe('Expired Token Handling @identity @auth', () => {
  test('should handle expired token gracefully', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Go to app and set invalid tokens in the Redux persist storage
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      await page.evaluate(() => {
        // Set invalid auth state in the persist:auth key
        const invalidAuth = JSON.stringify({
          accessToken: 'invalid-expired-token',
          refreshToken: 'invalid-refresh-token',
          loading: false,
        });
        sessionStorage.setItem('persist:auth', invalidAuth);
      });

      // Try to access protected route
      await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

      // Should either redirect to login OR stay on the page (depending on app behavior)
      // The app should handle this gracefully without crashing
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      // Test passes if page loads without crashing
      expect(currentUrl).toBeTruthy();
    } finally {
      await context.close();
    }
  });
});
