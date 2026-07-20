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
  /**
   * The post-registration PAYMENT SHEET (`.pay-modal`), shown on a 201. This is
   * the surface a buyer completes the purchase on, so its controls are the ones
   * that must stay reachable on a phone — a pay button rendered off-screen is a
   * broken checkout even though every unit test passes.
   */
  readonly payModal: Locator;
  readonly payModalSheet: Locator;
  readonly payModalTitle: Locator;
  readonly payModalDone: Locator;
  readonly payModalTicketLink: Locator;
  readonly payModalClose: Locator;
  /**
   * The AMBASSADOR ("who referred you?") picker (#283). Ships `hidden` and is
   * revealed by the inline script only once the promoters fetch returns a
   * usable list — so "not visible" is a legitimate, deliberate state, not a
   * failure. See `kefi-landings/src/lib/promoter-picker.ts`.
   */
  readonly referralField: Locator;
  readonly referralSelect: Locator;

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
    this.payModal = page.locator('.pay-modal');
    this.payModalSheet = page.locator('.pay-modal-sheet');
    this.payModalTitle = page.locator('.pay-modal-title');
    this.payModalDone = page.locator('.pay-modal-done');
    this.payModalTicketLink = page.locator('.pay-modal-ticket-link');
    this.payModalClose = page.locator('.pay-modal-x');
    this.referralField = page.locator('#sr-referral-field');
    this.referralSelect = page.locator('#sr-referral');
  }

  /**
   * The picker's option labels in render order. `[0]` must always be the
   * explicit opt-out — a promoter sitting first would mean the form credits a
   * payout to whoever tops the list for any visitor who never touches it.
   */
  async referralOptionLabels(): Promise<string[]> {
    return this.referralSelect.locator('option').allTextContents();
  }

  /** The option values in render order (`''` is the opt-out). */
  async referralOptionValues(): Promise<string[]> {
    return this.referralSelect.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  }

  /** Navigate to the tenant's durable `/register` route and wait for the form. */
  async goto(siteUrl: string): Promise<void> {
    await this.page.goto(`${siteUrl}/register`);
    await expect(this.form, 'the standalone /register form renders').toBeVisible();
  }

  /**
   * Fill every field.
   *
   * `passCode` is selected by clicking the pass TILE, not the radio input.
   * The radios are styled away (`.reg-pass-option input { position:absolute;
   * opacity:0; pointer-events:none }`) and the visible tile is the click
   * target, so `radio.check()` times out on an un-actionable element. Clicking
   * the label is both what a real visitor does and what actually works — the
   * radio is then asserted checked, so a broken tile→radio binding still fails.
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
    await this.selectPass(input.passCode);
    if (input.consent) await this.consentCheckbox.check();
  }

  /** Click the visible pass tile and confirm its hidden radio became selected. */
  async selectPass(passCode: string): Promise<void> {
    const radio = this.page.locator(`input[name="passCode"][value="${passCode}"]`);
    await this.page.locator(`label.reg-pass-option:has(${`input[value="${passCode}"]`})`).click();
    await expect(radio, `the "${passCode}" pass tile selects its radio`).toBeChecked();
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

  /**
   * Submit and return the register POST's status AND its parsed body.
   *
   * The body is what makes a browser-driven registration PROD-SAFE: it carries
   * `attendeeExternalId`, without which a `@ui` spec has created a real row on a
   * real tenant that teardown cannot reach. Anything driving this form against
   * UBB must track the returned id.
   */
  async submitAndCaptureRegistration(
    slug: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes(`/t/${slug}/register`) && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await this.submitButton.click();
    const response = await responsePromise;

    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // A non-JSON body (an HTML error page from an edge) leaves body empty —
      // the caller's status assertion is what reports the real failure.
    }
    return { status: response.status(), body };
  }

  /** Assert the success panel replaced the form (the 201 branch). */
  async expectSuccess(): Promise<void> {
    await expect(this.successPanel, 'the register success panel is shown').toBeVisible({
      timeout: 15_000,
    });
  }
}
