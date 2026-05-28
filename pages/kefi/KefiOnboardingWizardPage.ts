/**
 * Page Object for the 7-step Kefi onboarding wizard
 * (`/organizer/onboarding`, served by kefi-web's OnboardingGate).
 *
 * The wizard auto-saves on a 400ms debounce, so the POM lets the debounce
 * land (300ms after the last field) before clicking Continue — otherwise the
 * Finish click can race the save and the backend complete handler sees
 * partial state.
 *
 * Each step fills the minimum required fields with canary-prefixed content;
 * the rich KUCY-shaped landing config is applied via the API after Finish so
 * the wizard doesn't need every field for the assertion to pass.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

/** ms the wizard's auto-save debounce takes — wait this + a little before advancing. */
const AUTOSAVE_SETTLE_MS = 600;

export class KefiOnboardingWizardPage {
  readonly page: Page;

  // Step 1 — event basics
  readonly eventNameInput: Locator;
  readonly eventLocationInput: Locator;
  readonly eventDateInput: Locator;

  // Step 2 — logo-palette (skippable, no fill methods)

  // Step 3 — template
  readonly kucyTemplateOption: Locator;

  // Step 4 — landing copy
  readonly brandNameInput: Locator;
  readonly taglineInput: Locator;
  readonly editionInput: Locator;
  readonly descriptionInput: Locator;

  // Step 5 — schedule + teachers (skippable)
  readonly scheduleNoteInput: Locator;

  // Step 6 — payment
  readonly payAtDoorNoteInput: Locator;

  // Step 7 — plan (handled via `proOption` direct click)

  // Nav
  readonly continueButton: Locator;
  readonly backButton: Locator;
  readonly banner: Locator;

  constructor(page: Page) {
    this.page = page;

    this.eventNameInput = page.getByTestId('onboarding-event-name');
    this.eventLocationInput = page.getByTestId('onboarding-event-location');
    this.eventDateInput = page.getByTestId('onboarding-event-date');

    this.kucyTemplateOption = page.getByTestId('landing-template-option-kucy');

    this.brandNameInput = page.getByTestId('onboarding-landing-brand');
    this.taglineInput = page.getByTestId('onboarding-landing-tagline');
    this.editionInput = page.getByTestId('onboarding-landing-edition');
    this.descriptionInput = page.getByTestId('onboarding-landing-description');

    this.scheduleNoteInput = page.getByTestId('onboarding-schedule-note');

    this.payAtDoorNoteInput = page.getByTestId('onboarding-payment-pay-at-door');

    this.continueButton = page.getByTestId('onboarding-continue');
    this.backButton = page.getByTestId('onboarding-back');
    this.banner = page.getByTestId('onboarding-banner');
  }

  /** Wait for the wizard shell to render. */
  async expectLoaded(): Promise<void> {
    await expect(this.page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 30_000 });
  }

  /** Continue to the next step — debounce-aware. */
  async continueToNextStep(): Promise<void> {
    await delay(AUTOSAVE_SETTLE_MS);
    await this.continueButton.click();
  }

  /**
   * Run all 7 steps with minimal canary content, ending with Finish.
   * After Finish, the wizard navigates to /organizer; this method awaits
   * that URL transition.
   *
   * `canaryPrefix` is the slug-shaped prefix (`e2c-{id}-`) used for content
   * so the canary sweep can identify everything. `eventDateIso` should be a
   * future date in YYYY-MM-DD form.
   */
  async completeAllSteps(input: {
    canaryPrefix: string;
    eventDateIso: string;
  }): Promise<void> {
    // ── Step 1: event basics ─────────────────────────────────────────────
    await this.eventNameInput.fill(`${input.canaryPrefix}Canary Salsa Night`);
    await this.eventLocationInput.fill(`${input.canaryPrefix}Test Venue Nicosia`);
    await this.eventDateInput.fill(input.eventDateIso);
    // Pick "festival" — any non-other type works. Stable testID = `${testID}-${value}`.
    await this.page.getByTestId('onboarding-event-type-festival').click();
    await this.continueToNextStep();

    // ── Step 2: logo-palette — skip entirely (no input). ────────────────
    await this.continueToNextStep();

    // ── Step 3: template — pick KUCY. ───────────────────────────────────
    await this.kucyTemplateOption.click();
    await this.continueToNextStep();

    // ── Step 4: landing-copy ────────────────────────────────────────────
    await this.brandNameInput.fill(`${input.canaryPrefix}Canary Brand`);
    await this.taglineInput.fill('Synthetic E2E canary — auto-sweeps');
    await this.editionInput.fill('Canary Edition');
    await this.descriptionInput.fill(
      `${input.canaryPrefix}Synthetic landing for the nightly tenant-lifecycle E2E. Auto-deleted within ~30s of creation.`,
    );
    await this.continueToNextStep();

    // ── Step 5: schedule + teachers — minimal note. ─────────────────────
    await this.scheduleNoteInput.fill('Synthetic — no real classes.');
    await this.continueToNextStep();

    // ── Step 6: payment — pay-at-door with the required note. ───────────
    await this.page.getByTestId('onboarding-payment-provider-pay-at-door').click();
    await this.payAtDoorNoteInput.fill('Synthetic test — pay-at-door note.');
    await this.continueToNextStep();

    // ── Step 7: plan — pick `pro` so PublishLandingConfigHandler's
    // IsAtLeastPro gate passes (Free is blocked at the handler level).
    // Wizard completion deterministically writes Tenant.SubscriptionPlanCode;
    // no Stripe involvement for the canary.
    await this.page.getByTestId('onboarding-plan-choice-pro').click();
    await delay(AUTOSAVE_SETTLE_MS);

    // Last step's Continue is "Finish" — click + await navigation to /organizer.
    await Promise.all([
      this.page.waitForURL(/\/organizer\/?$/, { timeout: 60_000 }),
      this.continueButton.click(),
    ]);
  }
}
