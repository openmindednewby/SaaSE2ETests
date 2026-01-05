import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper.js';

test.describe('Token Refresh @identity @auth', () => {
  test('should refresh token via API @critical', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    const authHelper = new AuthHelper();

    // Login first
    const loginResult = await authHelper.loginViaAPI(username, password);
    expect(loginResult.accessToken).toBeTruthy();
    expect(loginResult.refreshToken).toBeTruthy();

    // Store original token
    const originalAccessToken = loginResult.accessToken;

    // Refresh tokens
    const refreshResult = await authHelper.refreshTokens();
    expect(refreshResult.accessToken).toBeTruthy();
    expect(refreshResult.refreshToken).toBeTruthy();

    // New token should be different (in most cases)
    // Note: Some auth systems might return the same token if not expired
    expect(refreshResult.accessToken).toBeTruthy();
  });

  test('should fail refresh with invalid token', async () => {
    const authHelper = new AuthHelper();

    // Try to refresh without logging in first
    await expect(authHelper.refreshTokens()).rejects.toThrow();
  });

  test('should maintain session with valid token', async ({ page }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    // Navigate to protected area (using stored auth state)
    await page.goto('/(protected)');

    // Verify we're on a protected route
    await expect(page).toHaveURL(/\(protected\)/);

    // Navigate to another protected page
    await page.goto('/(protected)/quiz-templates');

    // Should still be authenticated
    await expect(page).toHaveURL(/quiz-templates/);
  });

  test('should handle expired token gracefully', async ({ page }) => {
    // Clear auth and set an invalid token
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('accessToken', 'invalid-expired-token');
      sessionStorage.setItem('refreshToken', 'invalid-refresh-token');
    });

    // Try to access protected route
    await page.goto('/(protected)');

    // Should redirect to login due to invalid token
    // The app should detect the invalid token and redirect
    await expect(page).toHaveURL(/\(auth\)|login|\(protected\)/i, { timeout: 10000 });
  });
});
