import { BrowserContext, expect, Page, test } from '@playwright/test';
import { BillingPage } from '../../pages/BillingPage.js';
import { createAuthenticatedContext } from '../../helpers/serial-auth.js';

/**
 * E2E Tests for Billing Subscription Management
 *
 * Validates the billing settings screen UI for the default free-tier state:
 * - Screen loads and renders the main billing container
 * - Current plan section displays the plan name and status badge
 * - Plan comparison section renders plan cards with pricing
 * - Billing cycle toggle switches between monthly and annual
 * - Manage payment button is accessible
 * - Plan cards show feature lists
 *
 * NOTE: These tests do NOT exercise Stripe checkout. They verify the
 * billing UI renders correctly for the default (free) subscription state.
 */
test.describe.serial('Billing Subscription Management @billing @subscription', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let billingPage: BillingPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    ({ context, page } = await createAuthenticatedContext(browser, testInfo));
    billingPage = new BillingPage(page);
  });

  test.beforeEach(async () => {
    await billingPage.goto();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display the billing settings screen', async () => {
    await billingPage.expectBillingScreenVisible();

    // Verify URL is correct
    await expect(page).toHaveURL(/\/settings\/billing/);
  });

  test('should show current plan section with plan name and status badge', async () => {
    await billingPage.expectCurrentPlanVisible();
    await billingPage.expectStatusBadgeVisible();
  });

  test('should display plan comparison cards', async () => {
    await billingPage.expectPlanCardsVisible();

    // The system has 3 tiers: Free, Pro, Enterprise
    const cardCount = await billingPage.getPlanCardCount();
    expect(cardCount).toBeGreaterThanOrEqual(1);
  });

  test('should show billing cycle toggle with monthly and annual options', async () => {
    await billingPage.expectCycleToggleVisible();

    // Both cycle options should be present
    await expect(billingPage.cycleMonthly).toBeVisible();
    await expect(billingPage.cycleAnnual).toBeVisible();
  });

  test('should switch between monthly and annual billing cycles', async () => {
    // Start by clicking annual
    await billingPage.selectAnnualCycle();

    // Plan cards should still be visible after toggle
    await billingPage.expectPlanCardsVisible();

    // Switch back to monthly
    await billingPage.selectMonthlyCycle();

    // Plan cards should still be visible
    await billingPage.expectPlanCardsVisible();
  });

  test('should display the manage payment button', async () => {
    await billingPage.expectPortalButtonVisible();
  });

  test('should display feature lists within plan cards', async () => {
    // Each plan card should contain feature text (checkmarks and feature names)
    const firstCard = billingPage.planCards.first();
    await expect(firstCard).toBeVisible();

    // Plan cards contain feature rows with checkmark symbols
    const cardText = await billingPage.getPlanCardText(0);
    expect(cardText.length).toBeGreaterThan(0);
  });

  test('should show select button on non-current plan cards', async () => {
    // At least one plan card should have a select button
    // (the current plan shows "Current Plan" text instead of a button)
    const cardCount = await billingPage.getPlanCardCount();

    if (cardCount > 1) {
      // With multiple plans, at least one should have a select button
      const selectButtonCount = await billingPage.planSelectButtons.count();
      expect(selectButtonCount).toBeGreaterThan(0);
    }
  });
});
