import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Ceiling for a wizard step's write round-trip: Continue commits the step (PUT /shop, POST
 * /products, PUT /shop/shipping) THEN advances. Well under the suite's 30s per-test cap; a
 * web-first wait returns the instant the next step mounts, so this only engages when staging is
 * slow under full-suite load.
 */
const STEP_COMMIT_MS = 15_000;

/**
 * Page object for the Agora ES-08 onboarding wizard (agora-web route `/onboarding`, rendered by
 * `features/onboarding/components/OnboardingWizard`). Ids mirror agora-web/src/shared/testIds.ts
 * (the `ONBOARDING_*` block) — kept in sync with E2ETests/shared/testIds.ts.
 *
 * The wizard is six steps: Identity → Branding → Product → Shipping → Payments → Publish. Only
 * Identity and Publish are non-skippable; the middle steps carry the shared Skip button.
 */
export class AgoraOnboardingPage {
  readonly page: Page;

  // Shell / nav
  readonly screen: Locator;
  readonly wizard: Locator;
  readonly progress: Locator;
  readonly backButton: Locator;
  readonly continueButton: Locator;
  readonly skipButton: Locator;

  // Step 1 — Identity
  readonly nameInput: Locator;
  readonly slugInput: Locator;
  readonly emailInput: Locator;
  readonly slugStatus: Locator;
  readonly slugSuggestion: Locator;

  // Step 2 — Branding
  readonly presetPicker: Locator;
  readonly taglineInput: Locator;
  readonly logo: Locator;
  readonly logoUpload: Locator;

  // Step 3 — Product
  readonly productNameInput: Locator;
  readonly productPriceInput: Locator;
  readonly productSave: Locator;

  // Step 4 — Shipping
  readonly shippingFeeInput: Locator;
  readonly pickupSwitch: Locator;

  // Step 5 — Payments
  readonly stripeSkipNote: Locator;

  // Step 6 — Publish
  readonly publishButton: Locator;
  readonly publishUrl: Locator;
  readonly publishCopy: Locator;
  readonly publishQr: Locator;
  readonly publishBlocked: Locator;

  constructor(page: Page) {
    this.page = page;

    this.screen = page.getByTestId('agora-onboarding-screen');
    this.wizard = page.getByTestId('onboarding-wizard');
    this.progress = page.getByTestId('onboarding-progress');
    this.backButton = page.getByTestId('onboarding-back');
    this.continueButton = page.getByTestId('onboarding-continue');
    this.skipButton = page.getByTestId('onboarding-skip');

    this.nameInput = page.getByTestId('onboarding-name-input');
    this.slugInput = page.getByTestId('onboarding-slug-input');
    this.emailInput = page.getByTestId('onboarding-email-input');
    this.slugStatus = page.getByTestId('onboarding-slug-status');
    this.slugSuggestion = page.getByTestId('onboarding-slug-suggestion');

    this.presetPicker = page.getByTestId('onboarding-preset-picker');
    this.taglineInput = page.getByTestId('onboarding-tagline-input');
    this.logo = page.getByTestId('onboarding-logo');
    this.logoUpload = page.getByTestId('onboarding-logo-upload');

    this.productNameInput = page.getByTestId('onboarding-product-name-input');
    this.productPriceInput = page.getByTestId('onboarding-product-price-input');
    this.productSave = page.getByTestId('onboarding-product-save');

    this.shippingFeeInput = page.getByTestId('onboarding-shipping-fee-input');
    this.pickupSwitch = page.getByTestId('onboarding-shipping-pickup-switch');

    this.stripeSkipNote = page.getByTestId('onboarding-stripe-skip-note');

    this.publishButton = page.getByTestId('onboarding-publish-button');
    this.publishUrl = page.getByTestId('onboarding-publish-url');
    this.publishCopy = page.getByTestId('onboarding-publish-copy');
    this.publishQr = page.getByTestId('onboarding-publish-qr');
    this.publishBlocked = page.getByTestId('onboarding-publish-blocked');
  }

  /** Navigate to the wizard and wait for it to mount (first-run: GET /shop 404 → wizard). */
  async open(): Promise<void> {
    await this.page.goto('/onboarding');
    await this.wizard.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** The dot for a given step key (`identity`, `branding`, …) — used to prove step progression. */
  dot(stepKey: string): Locator {
    return this.page.getByTestId(`onboarding-dot-${stepKey}`);
  }

  /** Commit the current step and wait for the next step's marker to appear. */
  async continueToNext(nextMarker: Locator): Promise<void> {
    await expect(this.continueButton).toBeEnabled({ timeout: STEP_COMMIT_MS });
    await this.continueButton.click();
    await nextMarker.waitFor({ state: 'visible', timeout: STEP_COMMIT_MS });
  }

  /** Skip a skippable middle step and wait for the next step's marker. */
  async skipToNext(nextMarker: Locator): Promise<void> {
    await expect(this.skipButton).toBeVisible();
    await this.skipButton.click();
    await nextMarker.waitFor({ state: 'visible', timeout: STEP_COMMIT_MS });
  }
}

export default AgoraOnboardingPage;
