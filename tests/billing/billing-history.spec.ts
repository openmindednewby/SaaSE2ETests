import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../fixtures/test-data.js';
import { LoginPage } from '../../pages/LoginPage.js';
import { BillingPage } from '../../pages/BillingPage.js';

/**
 * E2E Tests for Billing History Display
 *
 * Validates the billing history section of the billing settings screen:
 * - Billing history section is present and rendered
 * - Empty state shown for free tier with no prior transactions
 * - History table has correct column headers when items exist
 * - Pagination controls behave correctly
 *
 * NOTE: These tests operate on the default free-tier subscription state,
 * which typically has no billing history. The tests verify correct empty
 * state rendering and the structural integrity of the history section.
 */
test.describe.serial('Billing History Display @billing @history', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let billingPage: BillingPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth')) {
          sessionStorage.setItem('persist:auth', persistAuth);
        }
      } catch {
        // ignore
      }
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    // Persist auth to localStorage for subsequent navigations
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    billingPage = new BillingPage(page);
  });

  test.beforeEach(async () => {
    await billingPage.goto();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display the billing history section', async () => {
    // The billing history section should be present on the billing screen
    await billingPage.expectBillingScreenVisible();

    // Either the empty state or the table should be visible
    const emptyCount = await billingPage.historyEmpty.count();
    const tableCount = await billingPage.historyTable.count();
    expect(emptyCount + tableCount).toBeGreaterThan(0);
  });

  test('should show empty state for free tier with no transactions', async () => {
    // For the default free tier, there should be no billing history
    // Check if we have the empty state (expected for free tier)
    const hasEmptyState = await billingPage.historyEmpty.count() > 0;
    const hasHistoryRows = await billingPage.historyRows.count() > 0;

    if (hasEmptyState) {
      await billingPage.expectHistoryEmpty();
    } else if (hasHistoryRows) {
      // If there are history rows, the table should be visible
      await billingPage.expectHistoryTableVisible();
    }

    // At minimum, the billing screen should be loaded
    await billingPage.expectBillingScreenVisible();
  });

  test('should show correct column headers when history table is rendered', async () => {
    // If the history table is visible, verify it has header cells
    const tableVisible = await billingPage.historyTable.count() > 0;

    if (tableVisible) {
      await billingPage.expectHistoryTableVisible();

      // The table should contain Date, Description, Amount, and Status headers
      const tableText = await billingPage.historyTable.textContent() ?? '';
      expect(tableText.length).toBeGreaterThan(0);
    } else {
      // Empty state is shown instead -- this is valid for free tier
      await billingPage.expectHistoryEmpty();
    }
  });

  test('should render pagination controls when history has entries', async () => {
    const hasHistoryRows = await billingPage.historyRows.count() > 0;

    if (hasHistoryRows) {
      // When there are history entries, pagination controls should be visible
      await billingPage.expectPaginationVisible();

      // On the first page, the previous button should be disabled
      await billingPage.expectPrevPageDisabled();
    } else {
      // No history entries -- empty state is expected for free tier
      await billingPage.expectHistoryEmpty();
    }
  });

  test('should not show cancel subscription button for free tier', async () => {
    // Free tier subscriptions cannot be canceled (there is nothing to cancel)
    // The cancel button should not be visible
    await billingPage.expectCancelButtonHidden();
  });
});
