/**
 * Page Object for the Billing Settings screen.
 * Handles current plan, status, navigation, cancel subscription.
 *
 * For pricing/plan comparison, billing history, upgrade prompts, and watermarks,
 * use BillingPricingPage.
 */

import { Locator, Page, expect } from '@playwright/test';

import { BasePage } from './BasePage.js';
import { TestIds, testIdSelector } from '../shared/testIds.js';

/** Extended timeout for billing API responses under 12-worker load */
const BILLING_TIMEOUT_MS = 30000;
/** Max navigation retries when the error state is shown */
const MAX_GOTO_RETRIES = 3;

export class BillingPage extends BasePage {
  readonly billingScreen: Locator;
  readonly billingLoading: Locator;
  readonly billingError: Locator;

  readonly currentPlan: Locator;
  readonly statusBadge: Locator;
  readonly trialCountdown: Locator;

  readonly portalButton: Locator;
  readonly cancelButton: Locator;

  readonly cancelConfirmDialog: Locator;
  readonly cancelConfirmButton: Locator;
  readonly cancelDismissButton: Locator;

  constructor(page: Page) {
    super(page);

    this.billingScreen = page.locator(testIdSelector(TestIds.BILLING_SETTINGS_SCREEN));
    this.billingLoading = page.locator(testIdSelector(TestIds.BILLING_SETTINGS_LOADING));
    this.billingError = page.locator(testIdSelector(TestIds.BILLING_SETTINGS_ERROR));

    this.currentPlan = page.locator(testIdSelector(TestIds.BILLING_CURRENT_PLAN));
    this.statusBadge = page.locator(testIdSelector(TestIds.BILLING_STATUS_BADGE));
    this.trialCountdown = page.locator(testIdSelector(TestIds.BILLING_TRIAL_COUNTDOWN));

    this.portalButton = page.locator(testIdSelector(TestIds.BILLING_PORTAL_BUTTON));
    this.cancelButton = page.locator(testIdSelector(TestIds.BILLING_CANCEL_BUTTON));

    this.cancelConfirmDialog = page.locator(testIdSelector(TestIds.CONFIRM_DIALOG));
    this.cancelConfirmButton = page.locator(testIdSelector(TestIds.CONFIRM_BUTTON));
    this.cancelDismissButton = page.locator(testIdSelector(TestIds.CANCEL_CONFIRM_BUTTON));
  }

  // ==================== Navigation ====================

  /**
   * Navigate to the billing settings page.
   * Retries once if the initial load results in the error state,
   * since the PaymentService API may be slow on the first request
   * (cold start, connection pool warmup, etc.).
   */
  async goto(): Promise<void> {
    // Retry navigation up to MAX_GOTO_RETRIES times.
    // The PaymentService sometimes needs a warm-up request before
    // responding reliably (JWT validation caches signing keys on first call).
    // Under 12-worker load the first attempts may time out or error.
    // Firefox can also throw NS_BINDING_ABORTED if a navigation is interrupted.
    for (let attempt = 1; attempt <= MAX_GOTO_RETRIES; attempt++) {
      try {
        await super.goto('/settings/billing');
        await this.waitForBillingLoaded();

        if (await this.billingError.count() === 0) return;
        if (attempt === MAX_GOTO_RETRIES) return; // Accept whatever state we got

        // Retry immediately -- the next goto + waitForBillingLoaded provides
        // implicit backoff via navigation and API response timeouts.
      } catch {
        // Navigation error (NS_BINDING_ABORTED, timeout, etc.) -- retry
        if (attempt === MAX_GOTO_RETRIES) return; // Accept whatever state we got
      }
    }
  }

  /**
   * Wait for the billing screen to finish loading.
   * Waits for either the main screen or the error state to appear,
   * which means the API calls have resolved.
   */
  async waitForBillingLoaded(): Promise<void> {
    // Wait for any billing state to appear: the main screen, the error state,
    // or the loading indicator. Then if loading is shown, wait for it to resolve.
    const anyState = this.billingScreen.or(this.billingError).or(this.billingLoading);
    await expect(anyState).toBeVisible({ timeout: BILLING_TIMEOUT_MS });

    // If loading indicator is visible, wait for it to be replaced by a final state.
    if (await this.billingLoading.isVisible().catch(() => false)) {
      await expect(this.billingScreen.or(this.billingError)).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
    }
  }

  /**
   * Check whether the billing screen loaded successfully (not in error state).
   * Returns true if the main screen is visible, false if the error state is shown.
   */
  async isBillingScreenLoaded(): Promise<boolean> {
    return (await this.billingScreen.count()) > 0;
  }

  // ==================== Current Plan Assertions ====================

  /**
   * Expect the billing settings screen to be visible.
   */
  async expectBillingScreenVisible(): Promise<void> {
    await expect(this.billingScreen).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the current plan section to be visible.
   */
  async expectCurrentPlanVisible(): Promise<void> {
    await expect(this.currentPlan).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the status badge to be visible.
   */
  async expectStatusBadgeVisible(): Promise<void> {
    await expect(this.statusBadge).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the current plan section to contain specific text (plan name).
   */
  async expectCurrentPlanContainsText(text: string): Promise<void> {
    await expect(this.currentPlan).toContainText(text, { timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the trial countdown to be visible.
   */
  async expectTrialCountdownVisible(): Promise<void> {
    await expect(this.trialCountdown).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the trial countdown to not be visible (non-trial subscriptions).
   */
  async expectTrialCountdownHidden(): Promise<void> {
    await expect(this.trialCountdown).not.toBeVisible();
  }

  /**
   * Expect an error state to be displayed.
   */
  async expectErrorState(): Promise<void> {
    await expect(this.billingError).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  // ==================== Action Button Assertions ====================

  /**
   * Expect the manage payment (portal) button to be visible.
   */
  async expectPortalButtonVisible(): Promise<void> {
    await expect(this.portalButton).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the cancel subscription button to be visible.
   */
  async expectCancelButtonVisible(): Promise<void> {
    await expect(this.cancelButton).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the cancel subscription button to not be visible.
   * (Not shown for free tier or already-canceled subscriptions.)
   */
  async expectCancelButtonHidden(): Promise<void> {
    await expect(this.cancelButton).not.toBeVisible();
  }

  // ==================== Cancel Confirmation Dialog ====================

  /**
   * Click the cancel subscription button to open the confirmation dialog.
   */
  async clickCancelSubscription(): Promise<void> {
    await this.cancelButton.click();
  }

  /**
   * Expect the cancel confirmation dialog to be visible.
   */
  async expectCancelDialogVisible(): Promise<void> {
    await expect(this.cancelConfirmDialog).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the cancel confirmation dialog to not be visible.
   */
  async expectCancelDialogHidden(): Promise<void> {
    await expect(this.cancelConfirmDialog).not.toBeVisible();
  }

  /**
   * Confirm the cancellation in the dialog.
   */
  async confirmCancellation(): Promise<void> {
    await this.cancelConfirmButton.click();
  }

  /**
   * Dismiss the cancellation dialog without canceling.
   */
  async dismissCancellation(): Promise<void> {
    await this.cancelDismissButton.click();
  }

  // ==================== Status Badge Text ====================

  /**
   * Expect the status badge to contain specific text (e.g., "Active", "Trial").
   */
  async expectStatusBadgeText(text: string): Promise<void> {
    await expect(this.statusBadge).toContainText(text, { timeout: BILLING_TIMEOUT_MS });
  }

}
