/**
 * Page Object for the kefi-web SPA login (`/(auth)/login` → URL `/login`).
 *
 * The Phase 3d unified-auth login surface picks between password / email-OTP /
 * event-PIN tabs based on what the BFF advertises. Phase C only drives the
 * password tab — the canary tenant signed up with email + password via the
 * marketing form, so password is the right method.
 *
 * After a successful sign-in, OnboardingGate redirects fresh tenants (with
 * OnboardingCompleted=false) to /organizer/onboarding. Existing test users
 * land on /organizer.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';

export class KefiLoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.getByTestId('kefi-login-username');
    this.passwordInput = page.getByTestId('kefi-login-password');
    this.submitButton = page.getByTestId('kefi-login-password-submit');
    this.errorMessage = page.getByTestId('kefi-login-password-error');
  }

  async goto(): Promise<void> {
    const { webUrl } = getKefiUrls();
    await this.page.goto(`${webUrl}/login`);
    await expect(this.usernameInput).toBeVisible();
  }

  /**
   * Sign in with the supplied credentials. A `tenant-owner` (the canary's
   * role) is routed to `/admin` by `postLoginRouteTable` — NOT to
   * `/organizer/onboarding`. OnboardingGate only fires on `/organizer/*`, so
   * landing on `/admin` doesn't trigger the wizard redirect; the canary
   * (and a real fresh tenant) has to navigate to `/organizer/onboarding`
   * explicitly. This method waits for the post-login navigation to settle
   * away from /login, then drives the page to /organizer/onboarding so the
   * caller can run the wizard.
   *
   * The username field accepts the email — Kefi's KC uses email as username
   * (SECURITY_PLAN.md §2.3).
   */
  async signInAndExpectOnboarding(input: {
    email: string;
    password: string;
  }): Promise<void> {
    await this.usernameInput.fill(input.email);
    await this.passwordInput.fill(input.password);
    await Promise.all([
      // Just wait for the SPA to leave /login — the actual destination is
      // role-table-dependent and may land on `/` (NO_ACCESS_ROUTE) for a
      // fresh tenant-owner whose realm role isn't yet on the BFF user
      // claims. Either way, the BFF session cookie IS set after login, so
      // the next goto() is authenticated.
      this.page.waitForURL(
        (url) => !url.pathname.startsWith('/login'),
        { timeout: 30_000 },
      ),
      this.submitButton.click(),
    ]);

    // OnboardingGate's explicit pass-through for the wizard route lets us
    // jump straight there; no role-based routing needed. The wizard's
    // GET /admin/onboarding requires the tenant-owner role, which the
    // signup-created user holds in KC.
    const { webUrl } = getKefiUrls();
    await this.page.goto(`${webUrl}/organizer/onboarding`);
  }
}
