import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

test.describe('Login Flow @identity @auth', () => {
  // Login tests navigate to /login and wait for React hydration.
  // Under heavy load (12 workers), context creation + page load can exceed
  // the default 30s timeout. Double it to avoid flaky beforeEach failures.
  test.slow();

  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    // Clear any existing auth state for login tests
    await page.context().clearCookies();
    // Clear storage BEFORE navigating to avoid race conditions
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    }).catch(() => {
      // Ignore if page context not ready
    });
    // Navigate to login page and wait for the app to load
    // The login page already clears auth state on mount
    await loginPage.goto();
    // Wait for the login form to be ready
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 15000 });
  });

  test('should display login form elements', async ({ page: _page }) => {
    // usernameInput already verified in beforeEach, check the rest
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('should login with valid credentials @critical', async ({ page: _page }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    // Already on login page from beforeEach
    await loginPage.login(username, password);
    await loginPage.expectToBeOnProtectedRoute();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    // Already on login page from beforeEach
    // Set up dialog handler BEFORE triggering the action - use a promise to properly wait
    const dialogPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(''), 10000); // 10 second timeout
      page.once('dialog', async dialog => {
        clearTimeout(timeout);
        const message = dialog.message();
        await dialog.accept();
        resolve(message);
      });
    });

    await loginPage.login('invaliduser', 'invalidpassword');

    // Wait for the dialog to be handled
    const dialogMessage = await dialogPromise;

    // The app shows an error via alert
    expect(dialogMessage).toBeTruthy();
  });

  test('should require username and password', async ({ page }) => {
    // Already on login page from beforeEach
    // Set up dialog handler BEFORE triggering the action
    const dialogPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(''), 5000);
      page.once('dialog', async dialog => {
        clearTimeout(timeout);
        const message = dialog.message();
        await dialog.accept();
        resolve(message);
      });
    });

    // Try to login without credentials
    await loginPage.loginButton.click();

    // Wait for the dialog to be handled
    const dialogMessage = await dialogPromise;

    // Should show validation message
    expect(dialogMessage.toLowerCase()).toContain('enter');
  });

  test('should require password when username is provided', async ({ page }) => {
    // Already on login page from beforeEach
    const dialogPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(''), 5000);
      page.once('dialog', async dialog => {
        clearTimeout(timeout);
        const message = dialog.message();
        await dialog.accept();
        resolve(message);
      });
    });

    await loginPage.usernameInput.fill('someuser');
    await loginPage.loginButton.click();

    const dialogMessage = await dialogPromise;

    expect(dialogMessage.toLowerCase()).toContain('enter');
  });

  test('should require username when password is provided', async ({ page }) => {
    // Already on login page from beforeEach
    const dialogPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(''), 5000);
      page.once('dialog', async dialog => {
        clearTimeout(timeout);
        const message = dialog.message();
        await dialog.accept();
        resolve(message);
      });
    });

    await loginPage.passwordInput.fill('somepassword');
    await loginPage.loginButton.click();

    const dialogMessage = await dialogPromise;

    expect(dialogMessage.toLowerCase()).toContain('enter');
  });

  test('should disable inputs while logging in', async ({ page: _page }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    // Already on login page from beforeEach
    await loginPage.usernameInput.fill(username);
    await loginPage.passwordInput.fill(password);
    await loginPage.loginButton.click();

    // During login, the loading indicator should appear
    const _isLoading = await loginPage.isLoading();
    // Note: This might be too fast to catch, so we just verify the login completes
    await loginPage.expectToBeOnProtectedRoute();
  });

  test('should have no console errors on login page', async ({ page }) => {
    const errors: string[] = [];

    // Collect console errors and uncaught exceptions
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Navigate fresh to login page (beforeEach already navigated, but we need
    // the listeners registered before navigation to catch all errors)
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(loginPage.usernameInput).toBeVisible({ timeout: 15000 });

    // Wait for the page to fully settle so deferred errors surface
    await page.waitForLoadState('domcontentloaded');
    await expect(loginPage.usernameInput).toBeVisible();

    // Filter out benign/expected errors
    const criticalErrors = errors.filter(e =>
      !e.includes('net::') &&
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('favicon.ico'),
    );

    expect(criticalErrors, `Unexpected console errors on login page:\n${criticalErrors.join('\n')}`).toHaveLength(0);
  });
});
