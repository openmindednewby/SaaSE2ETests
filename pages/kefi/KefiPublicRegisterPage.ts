/**
 * Page Object for the PUBLIC self-registration form served at
 * `https://{slug}.kefi.dloizides.com/register`.
 *
 * This is a STATIC Astro page (`kefi-landings/src/pages/t/[slug]/register.astro`
 * → `SelfRegister.astro`), not the kefi-web SPA — so there are no RN `testID`s
 * here. The form is hand-authored HTML with stable element ids, which is what
 * this object binds to. The ids ARE the contract for this surface; they are the
 * most stable selector available and are referenced by the page's own inline
 * submit handler.
 *
 * The form POSTs `{ name, surname, phone, email, passCode, consentGiven }`
 * cross-origin to `{publicApiBase}/api/v1/t/{slug}/register` and swaps the card
 * for `#self-register-success` on a 201.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class KefiPublicRegisterPage {
  readonly page: Page;
  readonly form: Locator;
  readonly nameInput: Locator;
  readonly surnameInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly consentCheckbox: Locator;
  readonly submitButton: Locator;
  readonly status: Locator;
  readonly successPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.form = page.locator('#self-register-form');
    this.nameInput = page.locator('#sr-name');
    this.surnameInput = page.locator('#sr-surname');
    this.phoneInput = page.locator('#sr-phone');
    this.emailInput = page.locator('#sr-email');
    this.consentCheckbox = page.locator('#sr-consent');
    this.submitButton = page.locator('#sr-submit');
    this.status = page.locator('#sr-status');
    this.successPanel = page.locator('#self-register-success');
  }

  /** Navigate to the tenant's durable `/register` route and wait for the form. */
  async goto(siteUrl: string): Promise<void> {
    await this.page.goto(`${siteUrl}/register`);
    await expect(this.form, 'the standalone /register form renders').toBeVisible();
  }

  /**
   * Fill every field. `passCode` selects the matching radio in the pass group —
   * the tiles are `<input type="radio" name="passCode" value="{code}">`, so the
   * value selector is exact and independent of the tile's display label.
   */
  async fill(input: {
    name: string;
    surname: string;
    phone: string;
    email: string;
    passCode: string;
    consent: boolean;
  }): Promise<void> {
    await this.nameInput.fill(input.name);
    await this.surnameInput.fill(input.surname);
    await this.phoneInput.fill(input.phone);
    await this.emailInput.fill(input.email);
    await this.page.locator(`input[name="passCode"][value="${input.passCode}"]`).check();
    if (input.consent) await this.consentCheckbox.check();
  }

  /**
   * Submit and wait for the register POST to come back, returning its status.
   * Waiting on the RESPONSE (not a timeout) is what keeps this deterministic:
   * the success panel only appears after the fetch resolves.
   */
  async submitAndAwaitResponse(slug: string): Promise<number> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes(`/t/${slug}/register`) && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await this.submitButton.click();
    const response = await responsePromise;
    return response.status();
  }

  /** Assert the success panel replaced the form (the 201 branch). */
  async expectSuccess(): Promise<void> {
    await expect(this.successPanel, 'the register success panel is shown').toBeVisible({
      timeout: 15_000,
    });
  }
}
