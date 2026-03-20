import { BrowserContext, expect, Page, test } from '@playwright/test';
import { BillingPage } from '../../pages/BillingPage.js';
import { createAuthenticatedContext } from '../../helpers/serial-auth.js';

/**
 * E2E Tests for Billing Subscription Flow
 *
 * Validates the subscription lifecycle as seen through the billing UI:
 * - Pro subscription state is correctly reflected (provisioned by multi-tenant setup)
 * - Current plan shows "Pro" with an active status badge
 * - Cancel button is visible for active/trial subscriptions
 * - Free tier watermark is hidden for Pro subscribers
 * - Upgrade prompt is not shown for paid subscribers
 *
 * NOTE: The multi-tenant setup (multi-tenant.setup.ts) provisions Pro subscriptions
 * for all test tenants via the PaymentService API. These tests verify the resulting
 * UI state rather than performing Stripe checkout (which requires external integration).
 */
test.describe.serial('Billing Subscription Flow @billing @subscription-flow', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let billingPage: BillingPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    ({ context, page } = await createAuthenticatedContext(browser, testInfo));
    billingPage = new BillingPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display Pro as the current plan after subscription provisioning', async () => {
    await billingPage.goto();
    await billingPage.expectBillingScreenVisible();
    await billingPage.expectCurrentPlanVisible();

    // The multi-tenant setup provisions Pro subscriptions for all test tenants.
    // The current plan section should display "Pro".
    await billingPage.expectCurrentPlanContainsText('Pro');
  });

  test('should show an active or trial status badge for Pro subscription', async () => {
    // Already on billing page from previous test
    await billingPage.expectStatusBadgeVisible();

    // The status should be "Active" or "Trial" depending on PaymentService config.
    // In development mode without Stripe, the subscription is created as Active or Trial.
    await expect(billingPage.statusBadge).toContainText(/Active|Trial/);
  });

  test('should show the cancel subscription button for a Pro subscriber', async () => {
    // Active/Trial subscriptions can be canceled
    await billingPage.expectCancelButtonVisible();
  });

  test('should hide the free tier watermark for a Pro subscriber', async () => {
    // Pro subscribers should not see the "Powered by MenuFlow" watermark
    await billingPage.expectWatermarkHidden();
  });

  test('should mark Pro as the current plan in the comparison grid', async () => {
    await billingPage.expectPlanCardsVisible();

    // The Pro card should show "Current" badge text (not a "Select Plan" button)
    const proCard = billingPage.getPlanCardByTier('Pro');
    await expect(proCard).toBeVisible();
    await expect(proCard).toContainText('Current');
    await expect(proCard).not.toContainText('Select Plan');
  });

  test('should show select buttons for non-Pro plan cards', async () => {
    // Free and Enterprise cards should have select/upgrade buttons
    // while Pro (current) should not
    const selectButtonCount = await billingPage.planSelectButtons.count();
    const totalCards = await billingPage.getPlanCardCount();

    // Current plan card has no select button
    expect(selectButtonCount).toBe(totalCards - 1);
  });

  test('should display the manage payment portal button', async () => {
    await billingPage.expectPortalButtonVisible();
  });

  test('should persist subscription state after page reload', async () => {
    // Navigate away and come back to verify state persistence
    await billingPage.goto();
    await billingPage.expectBillingScreenVisible();
    await billingPage.expectCurrentPlanContainsText('Pro');
    await billingPage.expectStatusBadgeVisible();
  });
});
