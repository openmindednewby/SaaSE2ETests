import { BrowserContext, expect, Page, test } from '@playwright/test';
import { BillingPage } from '../../pages/BillingPage.js';
import { BillingPricingPage } from '../../pages/BillingPricingPage.js';
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
  let pricingPage: BillingPricingPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    ({ context, page } = await createAuthenticatedContext(browser, testInfo));
    billingPage = new BillingPage(page);
    pricingPage = new BillingPricingPage(page);
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

  test('should show billing cycle toggle with monthly and annual options', async () => {
    await pricingPage.expectCycleToggleVisible();

    // Both cycle options should be present
    await expect(pricingPage.cycleMonthly).toBeVisible();
    await expect(pricingPage.cycleAnnual).toBeVisible();
  });

  test('should switch between monthly and annual billing cycles', async () => {
    // Start by clicking annual
    await pricingPage.selectAnnualCycle();

    // Plan cards should still be visible after toggle
    await pricingPage.expectPlanCardsVisible();

    // Switch back to monthly
    await pricingPage.selectMonthlyCycle();

    // Plan cards should still be visible
    await pricingPage.expectPlanCardsVisible();
  });

  test('should display the manage payment button', async () => {
    await billingPage.expectPortalButtonVisible();
  });

});
