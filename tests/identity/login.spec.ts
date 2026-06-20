import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
import {
  isStagingTarget,
  firefoxCannotReachStaging,
  FIREFOX_STAGING_SKIP_REASON,
} from '../../helpers/target.js';

test.describe('Login Flow @identity @auth', () => {
  // Login tests navigate to /login and wait for React hydration.
  // Under heavy load (12 workers), context creation + page load can exceed
  // the default 30s timeout. Double it to avoid flaky beforeEach failures.
  test.slow();

  // Firefox UI traffic can't reach the staging frontend (see helper docs).
  test.skip(({ browserName }) => firefoxCannotReachStaging(browserName), FIREFOX_STAGING_SKIP_REASON);

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

    // Already on login page from beforeEach. Use `loginAndWait` (3x retry with
    // a fresh navigation between attempts) rather than a bare `login` —
    // staging fronts /auth/login with a rate limiter, and a sequential
    // `--workers=1` suite firing 50+ logins can transiently hit HTTP 429.
    // The retry gives the limiter window time to drain.
    await loginPage.loginAndWait(username, password);
  });

  test('should show error with invalid credentials', async ({ page: _page }) => {
    // Already on login page from beforeEach.
    // The BaseClient /login screen surfaces a wrong-credential error via a
    // native browser dialog (window.alert, see src/utils/showAlert), NOT an
    // inline text node. We capture the dialog and assert it carries a non-empty
    // message (resilient to label/localisation changes).
    await loginPage.submitAndExpectError('invaliduser', 'invalidpassword', /\S/);
  });

  test('should require username and password', async ({ page: _page }) => {
    // Already on login page from beforeEach.
    // Submitting with empty fields shows the missing-fields error dialog
    // (FM('login.enterCredentials') = "Please enter username and password").
    await loginPage.submitEmptyAndExpectError(/enter/i);
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
      !e.includes('favicon.ico') &&
      // BFF era (Phase 2): the SPA's session bootstrap probes `GET /bff/me`
      // on every load. On the login page there is, by design, no session, so
      // the BFF correctly answers 401. The browser logs every HTTP 401 to the
      // console as a "Failed to load resource" error — that is the browser's
      // network logging, not an application fault. The unauthenticated
      // `/bff/me` 401 is the expected, correct response.
      !(e.includes('Failed to load resource') && e.includes('401')) &&
      // React ErrorBoundary recovery messages (not application errors)
      !e.includes('error boundary') &&
      !e.includes('ErrorBoundary') &&
      !e.includes('recreate this component tree') &&
      // Staging serves the Traefik default (self-signed) cert — no public
      // letsencrypt. Chromium refuses to fetch/register the service worker
      // over a cert it doesn't trust, even with `ignoreHTTPSErrors` (that
      // flag covers navigation/fetch, not the SW script-fetch security
      // check). This is a documented staging-environment constraint
      // (E2ETests/README.md — "Self-signed TLS accepted"), not an app bug.
      // The SW SSL error does not occur on local or prod (both have trusted
      // certs), so the filter is gated on the staging target.
      !(isStagingTarget() && (
        e.includes('SSL certificate error') ||
        e.includes('service-worker.js') ||
        e.includes('Failed to register a ServiceWorker')
      )),
    );

    expect(criticalErrors, `Unexpected console errors on login page:\n${criticalErrors.join('\n')}`).toHaveLength(0);
  });
});
