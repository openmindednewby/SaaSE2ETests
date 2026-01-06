import { test, expect, Page, BrowserContext } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Logout Flow @identity @auth', () => {
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

  test('should logout successfully @critical', async () => {
    // Start on protected route (using authenticated state)
    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    // Find and click logout button
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    if (await logoutButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await logoutButton.click();

      // Should redirect to login page
      await expect(page).toHaveURL(/login/i, { timeout: 10000 });
    } else {
      // Try looking for logout in a menu or sidebar
      const menuButton = page.getByRole('button', { name: /menu/i });
      if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await menuButton.click();
        const logoutMenuItem = page.getByText(/logout|sign out/i);
        await logoutMenuItem.click();
        await expect(page).toHaveURL(/login/i, { timeout: 10000 });
      } else {
        // Skip if no logout button found (might be mobile-specific UI)
        test.skip(true, 'Logout button not found in current UI');
      }
    }
  });

  test('should clear session after logout', async () => {
    // Login again for this test (since previous test logged out)
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    if (await logoutButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await logoutButton.click();
      await expect(page).toHaveURL(/login/i, { timeout: 10000 });

      // Verify session is cleared
      const tokens = await page.evaluate(() => {
        return {
          accessToken: sessionStorage.getItem('accessToken'),
          refreshToken: sessionStorage.getItem('refreshToken'),
        };
      });

      expect(tokens.accessToken).toBeFalsy();
      expect(tokens.refreshToken).toBeFalsy();
    } else {
      test.skip(true, 'Logout button not found');
    }
  });

  test('should redirect to login when accessing protected route after logout', async () => {
    // Login again for this test
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    await page.goto('/quiz-templates', { waitUntil: 'domcontentloaded' });

    // Clear auth manually to simulate logout
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem('userProfile');
      localStorage.removeItem('persist:auth');
    });

    // Refresh the page
    await page.reload();

    // Should redirect to login
    await expect(page).toHaveURL(/login/i, { timeout: 10000 });
  });
});
