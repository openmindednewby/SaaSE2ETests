/**
 * Kefi device-PIN page object — the remembered-device PIN-unlock surface.
 *
 * Mirrors the testIDs emitted by kefi-web's `DevicePinUnlockScreen` (the unlock
 * gate shown on `/login` when `GET /bff/config` reports `hasPin` +
 * `rememberedUsername` for the device cookie). DISTINCT from the event-staff PIN
 * (`KefiLoginPage` / `/bff/pin/login`) — this is the per-user device unlock.
 */

import { expect, type Page } from '@playwright/test';

import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';

export class KefiDevicePinPage {
  constructor(private readonly page: Page) {}

  private readonly unlockRoot = () => this.page.getByTestId('kefi-device-pin-unlock');
  private readonly pinInput = () => this.page.getByTestId('kefi-device-pin-unlock-input');
  private readonly submitButton = () => this.page.getByTestId('kefi-device-pin-unlock-submit');
  private readonly errorText = () => this.page.getByTestId('kefi-device-pin-unlock-error');
  private readonly usePasswordLink = () => this.page.getByTestId('kefi-device-pin-unlock-use-password');

  /** Navigates to /login and asserts the device-PIN unlock gate is showing. */
  async gotoAndExpectUnlockGate(): Promise<void> {
    const { webUrl } = getKefiUrls();
    await this.page.goto(`${webUrl}/login`);
    await expect(this.unlockRoot()).toBeVisible();
  }

  /** Enters a PIN and submits the unlock attempt. */
  async submitPin(pin: string): Promise<void> {
    await this.pinInput().fill(pin);
    await this.submitButton().click();
  }

  /** Asserts the unlock error message is visible (wrong PIN / locked out). */
  async expectError(): Promise<void> {
    await expect(this.errorText()).toBeVisible();
  }

  /** Taps "Sign in with password instead" to drop the unlock gate this visit. */
  async usePasswordInstead(): Promise<void> {
    await this.usePasswordLink().click();
  }
}
