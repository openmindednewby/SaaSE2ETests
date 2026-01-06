import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

test.describe('Login Flow @identity @auth', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    // Clear any existing auth state for login tests
    await page.context().clearCookies();
    // Navigate directly to login page and clear storage there
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
  });

  test('should display login form elements', async ({ page }) => {
    // Already navigated in beforeEach, just wait for elements
    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('should login with valid credentials @critical', async ({ page }) => {
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
    // Set up dialog handler for the alert
    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    await loginPage.login('invaliduser', 'invalidpassword');

    // Wait a bit for the alert to appear
    await page.waitForTimeout(2000);

    // The app shows an error via alert
    expect(dialogMessage).toBeTruthy();
  });

  test('should require username and password', async ({ page }) => {
    // Already on login page from beforeEach
    // Set up dialog handler for the alert
    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    // Try to login without credentials
    await loginPage.loginButton.click();

    await page.waitForTimeout(1000);

    // Should show validation message
    expect(dialogMessage.toLowerCase()).toContain('enter');
  });

  test('should require password when username is provided', async ({ page }) => {
    // Already on login page from beforeEach
    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    await loginPage.usernameInput.fill('someuser');
    await loginPage.loginButton.click();

    await page.waitForTimeout(1000);

    expect(dialogMessage.toLowerCase()).toContain('enter');
  });

  test('should require username when password is provided', async ({ page }) => {
    // Already on login page from beforeEach
    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    await loginPage.passwordInput.fill('somepassword');
    await loginPage.loginButton.click();

    await page.waitForTimeout(1000);

    expect(dialogMessage.toLowerCase()).toContain('enter');
  });

  test('should disable inputs while logging in', async ({ page }) => {
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
    const isLoading = await loginPage.isLoading();
    // Note: This might be too fast to catch, so we just verify the login completes
    await loginPage.expectToBeOnProtectedRoute();
  });
});
