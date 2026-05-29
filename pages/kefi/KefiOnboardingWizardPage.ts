/**
 * Page Object for the Kefi onboarding wizard (`/organizer/onboarding`, served
 * by kefi-web's OnboardingGate).
 *
 * M1 fast path — 4 steps: event-basics → template-choice → landing-copy →
 * review/finish. Logo/palette, schedule/teachers, payment and plan moved to
 * post-live dashboard cards, so the wizard no longer collects them. The plan
 * (which the publish Pro-gate needs) is injected into the persisted onboarding
 * state via the API between `fillFastPath` and `finishFromReview` — see
 * `KefiAdminClient.setOnboardingPlan`.
 *
 * The wizard auto-saves on a 400ms debounce, so the POM lets the debounce land
 * (plus the PUT round-trip) before clicking Continue — otherwise the Finish
 * click can race the save and the backend complete handler sees partial state.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * ms the wizard's auto-save debounce takes — wait this + a little before
 * advancing. The PUT itself fires AFTER the 400ms debounce and runs
 * `update.isPending=true` → button disabled until the response lands. On
 * staging this round-trip is ~200-400ms; 1200ms covers both with margin.
 */
const AUTOSAVE_SETTLE_MS = 1200;

export class KefiOnboardingWizardPage {
  readonly page: Page;

  // Step 1 — event basics
  readonly eventNameInput: Locator;
  readonly eventLocationInput: Locator;
  readonly eventDateInput: Locator;

  // Step 2 — template
  readonly kucyTemplateOption: Locator;

  // Step 3 — landing copy
  readonly brandNameInput: Locator;
  readonly taglineInput: Locator;
  readonly editionInput: Locator;
  readonly descriptionInput: Locator;

  // Step 4 — review (display-only; finished via the nav button)

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

    this.continueButton = page.getByTestId('onboarding-continue');
    this.backButton = page.getByTestId('onboarding-back');
    this.banner = page.getByTestId('onboarding-banner');
  }

  /** Wait for the wizard shell to render. */
  async expectLoaded(): Promise<void> {
    await expect(this.page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Continue to the next step — debounce-aware AND in-flight-aware.
   * After the autosave PUT settles, the Continue button re-enables; only
   * then is the click safe (otherwise the wizard ignores the press and
   * the spec stalls on the next step's expectation).
   */
  async continueToNextStep(): Promise<void> {
    await delay(AUTOSAVE_SETTLE_MS);
    await expect(this.continueButton).toBeEnabled({ timeout: 10_000 });
    await this.continueButton.click();
  }

  /**
   * Fill the 3 form steps with minimal canary content and advance to the
   * final review step. Does NOT finish — the caller injects the plan via the
   * API (the wizard no longer has a plan step) and then calls
   * {@link finishFromReview}.
   *
   * `canaryPrefix` is the slug-shaped prefix (`e2c-{id}-`) used for content so
   * the canary sweep can identify everything. `eventDateIso` should be a
   * future date in YYYY-MM-DD form.
   */
  async fillFastPath(input: {
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

    // ── Step 2: template — pick KUCY. ───────────────────────────────────
    await this.kucyTemplateOption.click();
    await this.continueToNextStep();

    // ── Step 3: landing-copy ────────────────────────────────────────────
    await this.brandNameInput.fill(`${input.canaryPrefix}Canary Brand`);
    await this.taglineInput.fill('Synthetic E2E canary — auto-sweeps');
    await this.editionInput.fill('Canary Edition');
    await this.descriptionInput.fill(
      `${input.canaryPrefix}Synthetic landing for the nightly tenant-lifecycle E2E. Auto-deleted within ~30s of creation.`,
    );
    await this.continueToNextStep();

    // ── Step 4: review — display-only; settle so the page is interactive. ─
    await expect(this.page.getByTestId('onboarding-step-review')).toBeVisible({ timeout: 10_000 });
    await delay(AUTOSAVE_SETTLE_MS);
  }

  /**
   * Click Finish on the review step and await the server's confirmation.
   *
   * The wizard's onSuccess fires `router.replace('/organizer')` but the page
   * bounces back to `/organizer/onboarding` because OnboardingGate's cached
   * query still has `completed=false` (the invalidate is async, the next fetch
   * races the redirect). Wait for the actual server confirmation —
   * POST /admin/onboarding/complete returning 2xx — instead of the URL.
   */
  async finishFromReview(): Promise<void> {
    await expect(this.continueButton).toBeEnabled({ timeout: 10_000 });
    const completeResponse = this.page.waitForResponse(
      (resp) =>
        resp.url().includes('/admin/onboarding/complete') &&
        resp.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await this.continueButton.click();
    const resp = await completeResponse;
    if (!resp.ok()) {
      throw new Error(
        `[KefiOnboardingWizard] complete-onboarding failed: ${String(resp.status())} ${resp.statusText()}`,
      );
    }
  }
}
