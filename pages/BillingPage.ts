/**
 * Page Object for the Billing Settings screen.
 *
 * Handles:
 * - Current plan section (plan name, status badge, trial countdown)
 * - Plan comparison grid with billing cycle toggle
 * - Action buttons (manage payment, cancel subscription)
 * - Billing history table with pagination
 */

import { Locator, Page, expect } from '@playwright/test';

import { BasePage } from './BasePage.js';
import { TestIds, testIdSelector } from '../shared/testIds.js';

/** Extended timeout for billing API responses under 12-worker load */
const BILLING_TIMEOUT_MS = 30000;
/** Max navigation retries when the error state is shown */
const MAX_GOTO_RETRIES = 3;

export class BillingPage extends BasePage {
  // Billing Settings Screen
  readonly billingScreen: Locator;
  readonly billingLoading: Locator;
  readonly billingError: Locator;

  // Current Plan Section
  readonly currentPlan: Locator;
  readonly statusBadge: Locator;
  readonly trialCountdown: Locator;

  // Plan Comparison
  readonly planCards: Locator;
  readonly planSelectButtons: Locator;
  readonly cycleToggle: Locator;
  readonly cycleMonthly: Locator;
  readonly cycleAnnual: Locator;

  // Action Buttons
  readonly portalButton: Locator;
  readonly cancelButton: Locator;

  // Cancel Confirmation Dialog (uses generic ConfirmDialog)
  readonly cancelConfirmDialog: Locator;
  readonly cancelConfirmButton: Locator;
  readonly cancelDismissButton: Locator;

  // Billing History
  readonly historyTable: Locator;
  readonly historyRows: Locator;
  readonly historyEmpty: Locator;
  readonly historyPrevPage: Locator;
  readonly historyNextPage: Locator;

  // Upgrade Prompt (appears on gated features)
  readonly upgradePrompt: Locator;
  readonly upgradePromptCta: Locator;
  readonly upgradePromptDismiss: Locator;

  // Free Tier Watermark
  readonly freeTierWatermark: Locator;

  constructor(page: Page) {
    super(page);

    // Screen-level locators
    this.billingScreen = page.locator(testIdSelector(TestIds.BILLING_SETTINGS_SCREEN));
    this.billingLoading = page.locator(testIdSelector(TestIds.BILLING_SETTINGS_LOADING));
    this.billingError = page.locator(testIdSelector(TestIds.BILLING_SETTINGS_ERROR));

    // Current Plan Section
    this.currentPlan = page.locator(testIdSelector(TestIds.BILLING_CURRENT_PLAN));
    this.statusBadge = page.locator(testIdSelector(TestIds.BILLING_STATUS_BADGE));
    this.trialCountdown = page.locator(testIdSelector(TestIds.BILLING_TRIAL_COUNTDOWN));

    // Plan Comparison
    this.planCards = page.locator(testIdSelector(TestIds.BILLING_PLAN_CARD));
    this.planSelectButtons = page.locator(testIdSelector(TestIds.BILLING_PLAN_SELECT_BUTTON));
    this.cycleToggle = page.locator(testIdSelector(TestIds.BILLING_CYCLE_TOGGLE));
    this.cycleMonthly = page.locator(testIdSelector(TestIds.BILLING_CYCLE_MONTHLY));
    this.cycleAnnual = page.locator(testIdSelector(TestIds.BILLING_CYCLE_ANNUAL));

    // Action Buttons
    this.portalButton = page.locator(testIdSelector(TestIds.BILLING_PORTAL_BUTTON));
    this.cancelButton = page.locator(testIdSelector(TestIds.BILLING_CANCEL_BUTTON));

    // Cancel Confirmation Dialog (uses generic ConfirmDialog component)
    this.cancelConfirmDialog = page.locator(testIdSelector(TestIds.CONFIRM_DIALOG));
    this.cancelConfirmButton = page.locator(testIdSelector(TestIds.CONFIRM_BUTTON));
    this.cancelDismissButton = page.locator(testIdSelector(TestIds.CANCEL_CONFIRM_BUTTON));

    // Billing History
    this.historyTable = page.locator(testIdSelector(TestIds.BILLING_HISTORY_TABLE));
    this.historyRows = page.locator(testIdSelector(TestIds.BILLING_HISTORY_ROW));
    this.historyEmpty = page.locator(testIdSelector(TestIds.BILLING_HISTORY_EMPTY));
    this.historyPrevPage = page.locator(testIdSelector(TestIds.BILLING_HISTORY_PREV_PAGE));
    this.historyNextPage = page.locator(testIdSelector(TestIds.BILLING_HISTORY_NEXT_PAGE));

    // Upgrade Prompt
    this.upgradePrompt = page.locator(testIdSelector(TestIds.UPGRADE_PROMPT));
    this.upgradePromptCta = page.locator(testIdSelector(TestIds.UPGRADE_PROMPT_CTA));
    this.upgradePromptDismiss = page.locator(testIdSelector(TestIds.UPGRADE_PROMPT_DISMISS));

    // Free Tier Watermark
    this.freeTierWatermark = page.locator(testIdSelector(TestIds.FREE_TIER_WATERMARK));
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

  // ==================== Plan Comparison Assertions ====================

  /**
   * Expect a specific number of plan cards to be rendered.
   */
  async expectPlanCardCount(count: number): Promise<void> {
    await expect(this.planCards).toHaveCount(count, { timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect at least one plan card to be visible.
   */
  async expectPlanCardsVisible(): Promise<void> {
    await expect(this.planCards.first()).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the billing cycle toggle to be visible.
   */
  async expectCycleToggleVisible(): Promise<void> {
    await expect(this.cycleToggle).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Switch to the monthly billing cycle.
   * Scrolls the toggle into view before clicking for small viewports.
   */
  async selectMonthlyCycle(): Promise<void> {
    await this.cycleMonthly.scrollIntoViewIfNeeded();
    await this.cycleMonthly.click({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Switch to the annual billing cycle.
   * Scrolls the toggle into view before clicking for small viewports.
   */
  async selectAnnualCycle(): Promise<void> {
    await this.cycleAnnual.scrollIntoViewIfNeeded();
    await this.cycleAnnual.click({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Get the count of plan cards currently rendered.
   */
  async getPlanCardCount(): Promise<number> {
    return await this.planCards.count();
  }

  /**
   * Get text content from a specific plan card by index.
   */
  async getPlanCardText(index: number): Promise<string> {
    const card = this.planCards.nth(index);
    return await card.textContent() ?? '';
  }

  /**
   * Get a plan card locator filtered by tier name text (e.g., 'Free', 'Pro', 'Enterprise').
   * Prefer this over `.nth(i)` to avoid index-based selectors.
   */
  getPlanCardByTier(tierName: string): Locator {
    return this.planCards.filter({ hasText: tierName });
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

  // ==================== Billing History Assertions ====================

  /**
   * Expect the billing history empty state to be visible.
   */
  async expectHistoryEmpty(): Promise<void> {
    await expect(this.historyEmpty).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the billing history table to be visible (has entries).
   */
  async expectHistoryTableVisible(): Promise<void> {
    await expect(this.historyTable).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect a specific number of history rows.
   */
  async expectHistoryRowCount(count: number): Promise<void> {
    await expect(this.historyRows).toHaveCount(count, { timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect pagination controls to be visible.
   */
  async expectPaginationVisible(): Promise<void> {
    await Promise.all([
      expect(this.historyPrevPage).toBeVisible({ timeout: BILLING_TIMEOUT_MS }),
      expect(this.historyNextPage).toBeVisible({ timeout: BILLING_TIMEOUT_MS }),
    ]);
  }

  /**
   * Expect the previous page button to be disabled.
   */
  async expectPrevPageDisabled(): Promise<void> {
    await expect(this.historyPrevPage).toBeDisabled();
  }

  /**
   * Expect the next page button to be disabled.
   */
  async expectNextPageDisabled(): Promise<void> {
    await expect(this.historyNextPage).toBeDisabled();
  }

  /**
   * Navigate to the next page of billing history.
   */
  async goToNextHistoryPage(): Promise<void> {
    await this.historyNextPage.click();
    await this.waitForLoading();
  }

  /**
   * Navigate to the previous page of billing history.
   */
  async goToPrevHistoryPage(): Promise<void> {
    await this.historyPrevPage.click();
    await this.waitForLoading();
  }

  // ==================== Upgrade Prompt Assertions ====================

  /**
   * Expect the upgrade prompt to be visible.
   */
  async expectUpgradePromptVisible(): Promise<void> {
    await expect(this.upgradePrompt).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the upgrade prompt to not be visible.
   */
  async expectUpgradePromptHidden(): Promise<void> {
    await expect(this.upgradePrompt).not.toBeVisible();
  }

  /**
   * Click the upgrade CTA button on the upgrade prompt.
   */
  async clickUpgradeCta(): Promise<void> {
    await this.upgradePromptCta.click();
  }

  /**
   * Dismiss the upgrade prompt.
   */
  async dismissUpgradePrompt(): Promise<void> {
    await this.upgradePromptDismiss.click();
  }

  // ==================== Watermark Assertions ====================

  /**
   * Expect the free tier watermark to be visible.
   */
  async expectWatermarkVisible(): Promise<void> {
    await expect(this.freeTierWatermark).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  /**
   * Expect the free tier watermark to not be visible.
   */
  async expectWatermarkHidden(): Promise<void> {
    await expect(this.freeTierWatermark).not.toBeVisible();
  }
}
