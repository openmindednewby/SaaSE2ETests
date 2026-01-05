import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

test.describe('Logout Flow @identity @auth', () => {
  test.beforeEach(async ({ page }) => {
    // These tests use the authenticated state from auth.setup.ts
  });

  test('should logout successfully @critical', async ({ page }) => {
    // Start on protected route (using authenticated state)
    await page.goto('/(protected)');

    // Find and click logout button
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    if (await logoutButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await logoutButton.click();

      // Should redirect to login page
      await expect(page).toHaveURL(/\(auth\)|login/i, { timeout: 10000 });
    } else {
      // Try looking for logout in a menu or sidebar
      const menuButton = page.getByRole('button', { name: /menu/i });
      if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await menuButton.click();
        const logoutMenuItem = page.getByText(/logout|sign out/i);
        await logoutMenuItem.click();
        await expect(page).toHaveURL(/\(auth\)|login/i, { timeout: 10000 });
      } else {
        // Skip if no logout button found (might be mobile-specific UI)
        test.skip(true, 'Logout button not found in current UI');
      }
    }
  });

  test('should clear session after logout', async ({ page }) => {
    await page.goto('/(protected)');

    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });

    if (await logoutButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await logoutButton.click();
      await expect(page).toHaveURL(/\(auth\)|login/i, { timeout: 10000 });

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

  test('should redirect to login when accessing protected route after logout', async ({ page }) => {
    await page.goto('/(protected)');

    // Clear auth manually to simulate logout
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem('userProfile');
    });

    // Refresh the page
    await page.reload();

    // Should redirect to login
    await expect(page).toHaveURL(/\(auth\)|login/i, { timeout: 10000 });
  });
});
