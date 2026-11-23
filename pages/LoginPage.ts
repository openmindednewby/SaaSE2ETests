import { Locator, Page, expect, test } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { TestIds, testIdSelector, type TestId } from '../shared/testIds.js';

// One login fits the 30 s test cap: navigation + spinner + form + redirect = 28 s.
const LOGIN_NAV_MS = 6000;
const LOGIN_SPINNER_MS = 8000;
const LOGIN_FORM_MS = 2000;
const LOGIN_REDIRECT_MS = 12000;

const ICHNOS_TEST_ID_PREFIX = 'ichnos';

/** The auth-web `testIdPrefix` of the app under test: Ichnos prefixes its login form, katalogos does not. */
export function loginTestIdPrefix(baseURL: string | undefined): string {
  const host = baseURL === undefined || baseURL === '' ? '' : new URL(baseURL).hostname;
  return host.split('.').includes(ICHNOS_TEST_ID_PREFIX) ? ICHNOS_TEST_ID_PREFIX : '';
}

function prefixedTestId(baseId: TestId, prefix: string): string {
  return prefix === '' ? testIdSelector(baseId) : `[data-testid="${prefix}-${baseId}"]`;
}

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loginError: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    // Use testId-only locators for speed (no .or() fallback chains)
    const prefix = loginTestIdPrefix(test.info().project.use.baseURL);
    this.usernameInput = page.locator(prefixedTestId(TestIds.USERNAME_INPUT, prefix));
    this.passwordInput = page.locator(prefixedTestId(TestIds.PASSWORD_INPUT, prefix));
    this.loginButton = page.locator(prefixedTestId(TestIds.LOGIN_BUTTON, prefix));
    this.loginError = page.locator(prefixedTestId(TestIds.LOGIN_ERROR, prefix));
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await this.registerOverlayHandlers();
    await this.page.goto('/login', { waitUntil: 'domcontentloaded', timeout: LOGIN_NAV_MS });
  }

  async waitForForm() {
    await expect(
      this.loadingIndicator.filter({ visible: true }),
      'login page still shows its loading spinner: the SPA has not finished booting',
    ).toHaveCount(0, { timeout: LOGIN_SPINNER_MS });
    await expect(this.usernameInput, 'spinner gone but the username input never rendered').toBeVisible({
      timeout: LOGIN_FORM_MS,
    });
  }

  /**
   * Fill in login form and submit
   */
  async login(username: string, password: string) {
    await this.dismissOverlay();
    await this.waitForForm();
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for login to complete and redirect to protected area
   * Expo Router: (protected) is a route group, URL doesn't include parentheses
   */
  async waitForLoginComplete(timeout = LOGIN_REDIRECT_MS) {
    // After login, we should be redirected away from /login to a protected route
    // Common protected routes: /quiz-templates, /quiz-active, /quiz-answers, /tenants, /users
    await expect(this.page).not.toHaveURL(/\/login/, { timeout });
  }

  /**
   * Perform login and wait for the redirect away from /login.
   */
  async loginAndWait(username: string, password: string) {
    await this.login(username, password);
    await this.waitForLoginComplete();
  }

  /**
   * Check if login button is enabled
   */
  async isLoginButtonEnabled(): Promise<boolean> {
    return await this.loginButton.isEnabled();
  }

  /**
   * Check if currently loading
   */
  async isLoading(): Promise<boolean> {
    return await this.loadingIndicator.isVisible();
  }

  /**
   * Expect to be on a protected route after login
   * Expo Router: (protected) is a route group, URL doesn't include parentheses
   */
  async expectToBeOnProtectedRoute() {
    // Verify we're NOT on login page anymore (means we reached a protected route)
    await expect(this.page).not.toHaveURL(/\/login/, { timeout: 10000 });
  }

  /**
   * Submit the login form with the given (bad) credentials and assert the
   * inline error message matches the pattern.
   *
   * The @identity suite drives the per-app RN-web login (BASE_URL =
   * katalogos-web `/login`), which renders the shared `@dloizides/auth-web`
   * `<LoginForm>`. On a wrong credential the form's `runLogin` catches the BFF
   * non-2xx and renders an inline `<Text testID="auth-login-error">` with the
   * default `invalidCredentials` label ("Incorrect username or password.").
   * RN-web maps `testID` → `data-testid`, so we assert that inline node — NOT a
   * browser dialog (there is no `window.alert` on this screen).
   */
  async submitAndExpectError(
    username: string,
    password: string,
    messagePattern: RegExp,
  ) {
    await this.dismissOverlay();
    await this.usernameInput.waitFor({ state: 'visible', timeout: 30000 });
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();

    // Invalid-credential errors require a BFF round-trip; allow generous time.
    await expect(this.loginError).toBeVisible({ timeout: 15000 });
    await expect(this.loginError).toHaveText(messagePattern);
  }

  /**
   * Click submit with empty fields and assert the inline missing-fields error.
   * `runLogin` short-circuits empty input and renders the `missingFields` label
   * ("Enter both your username and password.") in the same inline error node.
   */
  async submitEmptyAndExpectError(messagePattern: RegExp) {
    await this.dismissOverlay();
    await this.loginButton.waitFor({ state: 'visible', timeout: 30000 });
    await this.loginButton.click();

    await expect(this.loginError).toBeVisible({ timeout: 10000 });
    await expect(this.loginError).toHaveText(messagePattern);
  }

  /**
   * Clear the form
   */
  async clearForm() {
    await this.usernameInput.clear();
    await this.passwordInput.clear();
  }
}
