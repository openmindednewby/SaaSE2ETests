/**
 * Kefi passkey page object — the SPA side of the passkey (WebAuthn) flow.
 *
 * Mirrors the testIDs emitted by kefi-web's `PasskeyLoginButton` (login surface)
 * and `PasskeySettingsCard` (organizer dashboard). The Keycloak hosted-page side
 * of the ceremony is driven by the spec's KC-page helper, not this object —
 * this page object only knows the kefi-web SPA.
 */

import { expect, type Page } from '@playwright/test';

import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';

const VISIBILITY_TIMEOUT_MS = 30_000;

export class KefiPasskeyPage {
  constructor(private readonly page: Page) {}

  private readonly loginPasskeyButton = () => this.page.getByTestId('kefi-login-passkey-button');
  private readonly loginPasskeyError = () => this.page.getByTestId('kefi-login-passkey-error');
  private readonly settingsAddButton = () => this.page.getByTestId('kefi-passkey-settings-add');
  private readonly settingsSuccess = () => this.page.getByTestId('kefi-passkey-settings-success');

  /**
   * Navigates to /login and asserts the "Sign in with a passkey" button renders
   * (i.e. /bff/config advertises the passkey method). Generous timeout: a cold
   * context downloads the SPA bundle + calls /bff/config first.
   */
  async gotoLoginAndExpectPasskeyButton(): Promise<void> {
    const { webUrl } = getKefiUrls();
    await this.page.goto(`${webUrl}/login`);
    await expect(this.loginPasskeyButton()).toBeVisible({ timeout: VISIBILITY_TIMEOUT_MS });
  }

  /** Clicks "Sign in with a passkey" — hands off to /bff/passkey/login → Keycloak. */
  async clickSignInWithPasskey(): Promise<void> {
    await this.loginPasskeyButton().click();
  }

  /** Asserts the passkey error banner on /login (after a failed/cancelled ceremony). */
  async expectLoginError(): Promise<void> {
    await expect(this.loginPasskeyError()).toBeVisible({ timeout: VISIBILITY_TIMEOUT_MS });
  }

  /** Asserts the "Add a passkey" settings card button is visible on the organizer dashboard. */
  async expectSettingsAddButton(): Promise<void> {
    await expect(this.settingsAddButton()).toBeVisible({ timeout: VISIBILITY_TIMEOUT_MS });
  }

  /** Clicks "Add a passkey" — hands off to /bff/passkey/register → Keycloak re-auth + ceremony. */
  async clickAddPasskey(): Promise<void> {
    await this.settingsAddButton().click();
  }

  /** Asserts the post-registration success line on the settings card. */
  async expectRegistrationSuccess(): Promise<void> {
    await expect(this.settingsSuccess()).toBeVisible({ timeout: VISIBILITY_TIMEOUT_MS });
  }
}
