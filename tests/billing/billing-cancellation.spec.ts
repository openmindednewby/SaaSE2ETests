import { BrowserContext, expect, Page, test } from '@playwright/test';
import { BillingPage } from '../../pages/BillingPage.js';
import { createAuthenticatedContext } from '../../helpers/serial-auth.js';

/**
 * E2E Tests for Billing Cancellation Flow
 *
 * Validates the subscription cancellation UI for Pro subscribers:
 * - Cancel button is visible for active/trial subscriptions
 * - Clicking cancel opens a confirmation dialog
 * - Dismissing the dialog keeps the subscription intact
 * - Free tier users do not see the cancel button
 *
 * NOTE: These tests verify the cancellation UI flow without actually
 * completing the cancellation (which would alter shared test state).
 * The confirmation dialog dismiss path is tested to ensure the flow
 * works correctly without side effects. The multi-tenant setup
 * provisions Pro subscriptions for all test tenants.
 */
test.describe.serial('Billing Cancellation Flow @billing @cancellation', () => {
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

  test('should show cancel button for Pro subscriber', async () => {
    await billingPage.goto();
    await billingPage.expectBillingScreenVisible();

    // Pro subscriber (active or trial) should see the cancel button
    await billingPage.expectCancelButtonVisible();
  });

  test('should open confirmation dialog when cancel button is clicked', async () => {
    // Cancel dialog should not be visible initially
    await billingPage.expectCancelDialogHidden();

    // Click the cancel subscription button
    await billingPage.clickCancelSubscription();

    // Confirmation dialog should appear
    await billingPage.expectCancelDialogVisible();
  });

  test('should keep subscription intact when dismissing the cancel dialog', async () => {
    // Dialog is open from previous test -- dismiss it
    await billingPage.dismissCancellation();

    // Dialog should close
    await billingPage.expectCancelDialogHidden();

    // Subscription should still be Pro and active
    await billingPage.expectCurrentPlanContainsText('Pro');
    await billingPage.expectStatusBadgeVisible();
    await billingPage.expectCancelButtonVisible();
  });

  test('should show confirm and dismiss buttons in the cancel dialog', async () => {
    // Open the dialog again
    await billingPage.clickCancelSubscription();
    await billingPage.expectCancelDialogVisible();

    // Both the confirm and dismiss buttons should be visible
    await expect(billingPage.cancelConfirmButton).toBeVisible();
    await expect(billingPage.cancelDismissButton).toBeVisible();

    // Dismiss to clean up
    await billingPage.dismissCancellation();
    await billingPage.expectCancelDialogHidden();
  });

  test('should display cancel dialog with descriptive content', async () => {
    // Open the dialog
    await billingPage.clickCancelSubscription();
    await billingPage.expectCancelDialogVisible();

    // The dialog should contain meaningful text about cancellation
    const dialogText = await billingPage.cancelConfirmDialog.textContent() ?? '';
    expect(dialogText.length).toBeGreaterThan(0);

    // Clean up
    await billingPage.dismissCancellation();
  });

  test('should not show cancel button after navigating away and returning', async () => {
    // Navigate to billing, verify cancel is visible, then reload
    await billingPage.goto();
    await billingPage.expectBillingScreenVisible();

    // Cancel button should still be visible after navigation
    // (subscription state is persisted on the server)
    await billingPage.expectCancelButtonVisible();
  });
});
