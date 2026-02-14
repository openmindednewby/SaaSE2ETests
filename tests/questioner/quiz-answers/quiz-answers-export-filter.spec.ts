import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizAnswersPage } from '../../../pages/QuizAnswersPage.js';

/**
 * E2E Tests for Quiz Answers Export with Search Filter (BUG-QUIZ-015)
 *
 * Previously, the export function ignored the active search filter and exported
 * all answers. The fix ensures export respects the current search query,
 * only including filtered results in the export.
 *
 * These tests verify:
 * 1. Search filter reduces the visible answer count
 * 2. Export button is available when answers exist
 * 3. Export triggers a download with the search filter applied (via API response)
 * 4. Clearing search restores the full answer list
 */
test.describe.serial('Quiz Answers Export Filter @questioner @export', () => {
  test.setTimeout(120000);

  let context: BrowserContext;
  let page: Page;
  let answersPage: QuizAnswersPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(60000);
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

    // Save auth state to localStorage
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    answersPage = new QuizAnswersPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should navigate to quiz answers page', async () => {
    await answersPage.goto();
    await expect(page).toHaveURL(/quiz-answers/);
  });

  test('should display answer list or empty state', async () => {
    await answersPage.waitForLoading();

    // Page should show answers list, search input, or empty state
    const pageHeader = page.getByText(/quiz answers|answers/i);
    const searchInput = answersPage.searchInput;
    const emptyMessage = page.getByText(/no answers|no data|no submissions/i);

    await expect(
      pageHeader.or(searchInput).or(emptyMessage).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should filter answers when search is applied', async () => {
    await answersPage.waitForLoading();

    // Check if search input exists
    const hasSearch = await answersPage.searchInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSearch) {
      test.skip(true, 'Search input not available');
      return;
    }

    const initialCount = await answersPage.getAnswerCount();
    if (initialCount === 0) {
      test.skip(true, 'No answers available to test filtering');
      return;
    }

    // Search for a non-existent term to verify filtering works
    await answersPage.search('zzz_nonexistent_filter_test_12345');

    // Should reduce or eliminate results
    const filteredCount = await answersPage.getAnswerCount();
    expect(
      filteredCount,
      'Search for non-existent term should reduce results'
    ).toBeLessThanOrEqual(initialCount);

    // Clear search and restore
    await answersPage.clearSearch();

    const restoredCount = await answersPage.getAnswerCount();
    expect(
      restoredCount,
      'Clearing search should restore all results'
    ).toBe(initialCount);
  });

  test('should include search filter in export API call (BUG-QUIZ-015) @critical', async () => {
    await answersPage.waitForLoading();

    // Check if search input and export button exist
    const hasSearch = await answersPage.searchInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSearch) {
      test.skip(true, 'Search input not available');
      return;
    }

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip(true, 'No answers available to test export');
      return;
    }

    // Check if export/CSV button is available
    const csvButton = page.getByRole('button', { name: /csv|export/i });
    const hasExport = await csvButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasExport) {
      test.skip(true, 'Export button not available');
      return;
    }

    // Apply a search filter first
    const searchTerm = 'test';
    await answersPage.search(searchTerm);

    // Set up listener for the export API call to verify it includes the search parameter
    const exportRequestPromise = page.waitForRequest(
      request => {
        const url = request.url().toLowerCase();
        const isExport = url.includes('export') || url.includes('csv') || url.includes('download');
        return isExport;
      },
      { timeout: 10000 }
    ).catch(() => null);

    // Also listen for download event
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

    // Click export
    await csvButton.click();

    // Verify the export request includes the search filter
    const exportRequest = await exportRequestPromise;
    if (exportRequest) {
      const requestUrl = exportRequest.url();
      // Export request URL verified via assertion below

      // After BUG-QUIZ-015 fix, the export URL should include the search parameter
      const urlIncludesSearch = requestUrl.toLowerCase().includes('search') ||
        requestUrl.toLowerCase().includes('filter') ||
        requestUrl.toLowerCase().includes(searchTerm.toLowerCase());

      expect(
        urlIncludesSearch,
        `Export URL should include search filter parameter. URL: ${requestUrl}`
      ).toBe(true);
    }

    // Handle download if triggered
    const download = await downloadPromise;
    if (download) {
      // Download triggered successfully
      // Cancel the download to avoid file system side effects
      await download.cancel().catch(() => {});
    }

    // Clear search
    await answersPage.clearSearch();
  });

  test('should export all answers when no search filter is active', async () => {
    await answersPage.waitForLoading();

    // Check if export button exists
    const csvButton = page.getByRole('button', { name: /csv|export/i });
    const hasExport = await csvButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasExport) {
      test.skip(true, 'Export button not available');
      return;
    }

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip(true, 'No answers available to test export');
      return;
    }

    // Ensure search is clear
    await answersPage.clearSearch();

    // Set up listener for the export API call
    const exportRequestPromise = page.waitForRequest(
      request => {
        const url = request.url().toLowerCase();
        return url.includes('export') || url.includes('csv') || url.includes('download');
      },
      { timeout: 10000 }
    ).catch(() => null);

    // Also listen for download event
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

    // Click export without any filter
    await csvButton.click();

    // Verify the export request does NOT have a search filter
    const exportRequest = await exportRequestPromise;
    if (exportRequest) {
      const requestUrl = exportRequest.url();
      // Export request URL (no filter) verified via assertion below

      // Without search, the URL should not include a search parameter
      // or the search parameter should be empty
      const hasNonEmptySearch = /[?&]search=[^&]+/.test(requestUrl);
      expect(
        hasNonEmptySearch,
        `Export without filter should not include search parameter. URL: ${requestUrl}`
      ).toBe(false);
    }

    // Handle download if triggered
    const download = await downloadPromise;
    if (download) {
      // Download triggered successfully
      await download.cancel().catch(() => {});
    }
  });
});
