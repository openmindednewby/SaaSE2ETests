import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/** Extended timeout for billing API responses under 12-worker load */
const BILLING_TIMEOUT_MS = 30000;

/**
 * Page object for billing pricing-specific operations.
 * Handles plan comparison, billing cycle toggle, billing history,
 * upgrade prompts, and watermark assertions.
 *
 * For core billing operations (navigation, current plan, cancel),
 * use BillingPage.
 */
export class BillingPricingPage extends BasePage {
  // Plan Comparison
  readonly planCards: Locator;
  readonly planSelectButtons: Locator;
  readonly cycleToggle: Locator;
  readonly cycleMonthly: Locator;
  readonly cycleAnnual: Locator;

  // Billing History
  readonly historyTable: Locator;
  readonly historyRows: Locator;
  readonly historyEmpty: Locator;
  readonly historyPrevPage: Locator;
  readonly historyNextPage: Locator;

  // Upgrade Prompt
  readonly upgradePrompt: Locator;
  readonly upgradePromptCta: Locator;
  readonly upgradePromptDismiss: Locator;

  // Free Tier Watermark
  readonly freeTierWatermark: Locator;

  constructor(page: Page) {
    super(page);

    this.planCards = page.locator(testIdSelector(TestIds.BILLING_PLAN_CARD));
    this.planSelectButtons = page.locator(testIdSelector(TestIds.BILLING_PLAN_SELECT_BUTTON));
    this.cycleToggle = page.locator(testIdSelector(TestIds.BILLING_CYCLE_TOGGLE));
    this.cycleMonthly = page.locator(testIdSelector(TestIds.BILLING_CYCLE_MONTHLY));
    this.cycleAnnual = page.locator(testIdSelector(TestIds.BILLING_CYCLE_ANNUAL));

    this.historyTable = page.locator(testIdSelector(TestIds.BILLING_HISTORY_TABLE));
    this.historyRows = page.locator(testIdSelector(TestIds.BILLING_HISTORY_ROW));
    this.historyEmpty = page.locator(testIdSelector(TestIds.BILLING_HISTORY_EMPTY));
    this.historyPrevPage = page.locator(testIdSelector(TestIds.BILLING_HISTORY_PREV_PAGE));
    this.historyNextPage = page.locator(testIdSelector(TestIds.BILLING_HISTORY_NEXT_PAGE));

    this.upgradePrompt = page.locator(testIdSelector(TestIds.UPGRADE_PROMPT));
    this.upgradePromptCta = page.locator(testIdSelector(TestIds.UPGRADE_PROMPT_CTA));
    this.upgradePromptDismiss = page.locator(testIdSelector(TestIds.UPGRADE_PROMPT_DISMISS));

    this.freeTierWatermark = page.locator(testIdSelector(TestIds.FREE_TIER_WATERMARK));
  }

  // ==================== Plan Comparison ====================

  async expectPlanCardCount(count: number): Promise<void> {
    await expect(this.planCards).toHaveCount(count, { timeout: BILLING_TIMEOUT_MS });
  }

  async expectPlanCardsVisible(): Promise<void> {
    await expect(this.planCards.first()).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  async expectCycleToggleVisible(): Promise<void> {
    await expect(this.cycleToggle).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  async selectMonthlyCycle(): Promise<void> {
    await this.cycleMonthly.scrollIntoViewIfNeeded();
    await this.cycleMonthly.click({ timeout: BILLING_TIMEOUT_MS });
  }

  async selectAnnualCycle(): Promise<void> {
    await this.cycleAnnual.scrollIntoViewIfNeeded();
    await this.cycleAnnual.click({ timeout: BILLING_TIMEOUT_MS });
  }

  async getPlanCardCount(): Promise<number> { return await this.planCards.count(); }

  async getPlanCardText(index: number): Promise<string> {
    return await this.planCards.nth(index).textContent() ?? '';
  }

  getPlanCardByTier(tierName: string): Locator {
    return this.planCards.filter({ hasText: tierName });
  }

  // ==================== Billing History ====================

  async expectHistoryEmpty(): Promise<void> {
    await expect(this.historyEmpty).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  async expectHistoryTableVisible(): Promise<void> {
    await expect(this.historyTable).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  async expectHistoryRowCount(count: number): Promise<void> {
    await expect(this.historyRows).toHaveCount(count, { timeout: BILLING_TIMEOUT_MS });
  }

  async expectPaginationVisible(): Promise<void> {
    await Promise.all([
      expect(this.historyPrevPage).toBeVisible({ timeout: BILLING_TIMEOUT_MS }),
      expect(this.historyNextPage).toBeVisible({ timeout: BILLING_TIMEOUT_MS }),
    ]);
  }

  async expectPrevPageDisabled(): Promise<void> { await expect(this.historyPrevPage).toBeDisabled(); }
  async expectNextPageDisabled(): Promise<void> { await expect(this.historyNextPage).toBeDisabled(); }

  async goToNextHistoryPage(): Promise<void> {
    await this.historyNextPage.click();
    await this.waitForLoading();
  }

  async goToPrevHistoryPage(): Promise<void> {
    await this.historyPrevPage.click();
    await this.waitForLoading();
  }

  // ==================== Upgrade Prompt ====================

  async expectUpgradePromptVisible(): Promise<void> {
    await expect(this.upgradePrompt).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  async expectUpgradePromptHidden(): Promise<void> { await expect(this.upgradePrompt).not.toBeVisible(); }
  async clickUpgradeCta(): Promise<void> { await this.upgradePromptCta.click(); }
  async dismissUpgradePrompt(): Promise<void> { await this.upgradePromptDismiss.click(); }

  // ==================== Watermark ====================

  async expectWatermarkVisible(): Promise<void> {
    await expect(this.freeTierWatermark).toBeVisible({ timeout: BILLING_TIMEOUT_MS });
  }

  async expectWatermarkHidden(): Promise<void> { await expect(this.freeTierWatermark).not.toBeVisible(); }
}
