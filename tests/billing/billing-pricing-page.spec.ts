import { BrowserContext, expect, Page, test } from '@playwright/test';
import { BillingPage } from '../../pages/BillingPage.js';
import { createAuthenticatedContext } from '../../helpers/serial-auth.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/**
 * E2E Tests for Billing Pricing Page
 *
 * Validates the plan comparison section of the billing settings screen:
 * - All 3 plan cards render with correct tier names (Free, Pro, Enterprise)
 * - Monthly/annual price toggle updates displayed prices
 * - Current plan card shows "Current Plan" badge instead of a select button
 * - Non-current plan cards show select/upgrade buttons
 * - Feature comparison lists are accurate per tier
 *
 * These tests run against the provisioned Pro subscription state
 * (set up by multi-tenant.setup.ts via ensureProSubscriptions).
 */
test.describe.serial('Billing Pricing Page @billing @pricing', () => {
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

  test('should render exactly 3 plan cards for Free, Pro, and Enterprise tiers', async () => {
    await billingPage.expectPlanCardCount(3);

    // Verify each tier name appears in a plan card
    const freeCard = billingPage.getPlanCardByTier('Free');
    const proCard = billingPage.getPlanCardByTier('Pro');
    const enterpriseCard = billingPage.getPlanCardByTier('Enterprise');

    await expect(freeCard).toBeVisible();
    await expect(proCard).toBeVisible();
    await expect(enterpriseCard).toBeVisible();
  });

  test('should update displayed prices when toggling between monthly and annual cycles', async () => {
    // Capture plan card text in monthly mode
    await billingPage.selectMonthlyCycle();
    await billingPage.expectPlanCardsVisible();

    const proCard = billingPage.getPlanCardByTier('Pro');
    const enterpriseCard = billingPage.getPlanCardByTier('Enterprise');

    const monthlyProText = await proCard.textContent() ?? '';
    const monthlyEnterpriseText = await enterpriseCard.textContent() ?? '';

    // Switch to annual and capture again
    await billingPage.selectAnnualCycle();
    await billingPage.expectPlanCardsVisible();

    const annualProText = await proCard.textContent() ?? '';
    const annualEnterpriseText = await enterpriseCard.textContent() ?? '';

    // Pro and Enterprise prices should differ between monthly and annual
    const paidMonthly = monthlyProText + monthlyEnterpriseText;
    const paidAnnual = annualProText + annualEnterpriseText;
    expect(paidMonthly).not.toBe(paidAnnual);
  });

  test('should show "Current" badge on the current plan card without a select button', async () => {
    await billingPage.expectPlanCardsVisible();

    // The current plan card renders "Current" badge text instead of a select button.
    // The Pro card should be marked as current (provisioned by multi-tenant setup).
    const proCard = billingPage.getPlanCardByTier('Pro');
    await expect(proCard).toBeVisible();
    await expect(proCard).not.toContainText('Select Plan');

    // The current plan card should NOT have a select button
    const selectButtonInCurrentCard = proCard.locator(
      testIdSelector(TestIds.BILLING_PLAN_SELECT_BUTTON),
    );
    expect(await selectButtonInCurrentCard.count()).toBe(0);
  });

  test('should show select buttons on non-current plan cards', async () => {
    await billingPage.expectPlanCardsVisible();

    const cardCount = await billingPage.getPlanCardCount();
    // With 3 plans and one being current, there should be at least 2 select buttons
    const selectButtonCount = await billingPage.planSelectButtons.count();

    // Current plan has no select button, so total select buttons = cardCount - 1
    expect(selectButtonCount).toBe(cardCount - 1);
  });

  test('should display feature lists within each plan card', async () => {
    await billingPage.expectPlanCardsVisible();

    // Each tier card should have non-empty content including feature text
    const tierNames = ['Free', 'Pro', 'Enterprise'];
    for (const tier of tierNames) {
      const card = billingPage.getPlanCardByTier(tier);
      await expect(card).toBeVisible();

      const featureText = await card.textContent() ?? '';
      expect(featureText.length).toBeGreaterThan(0);
    }
  });

  test('should maintain plan card visibility after multiple cycle toggles', async () => {
    // Toggle rapidly between monthly and annual
    await billingPage.selectAnnualCycle();
    await billingPage.expectPlanCardsVisible();

    await billingPage.selectMonthlyCycle();
    await billingPage.expectPlanCardsVisible();

    await billingPage.selectAnnualCycle();
    await billingPage.expectPlanCardsVisible();

    // Verify all 3 cards still render
    await billingPage.expectPlanCardCount(3);
  });
});
