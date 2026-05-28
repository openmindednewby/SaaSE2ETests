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
   * Sign in with the supplied credentials, then wait for the post-login
   * redirect to land on /organizer (or /organizer/onboarding via the gate).
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
      this.page.waitForURL(/\/organizer(\/onboarding)?\/?$/, { timeout: 30_000 }),
      this.submitButton.click(),
    ]);
  }
}
