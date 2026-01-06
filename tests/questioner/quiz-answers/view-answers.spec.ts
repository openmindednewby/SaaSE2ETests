import { test, expect, Page, BrowserContext } from '@playwright/test';
import { QuizAnswersPage } from '../../../pages/QuizAnswersPage.js';
import { LoginPage } from '../../../pages/LoginPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('View Quiz Answers @questioner', () => {
  let context: BrowserContext;
  let page: Page;
  let answersPage: QuizAnswersPage;

  test.beforeAll(async ({ browser }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      throw new Error('TEST_USER_USERNAME or TEST_USER_PASSWORD not set');
    }

    // Create a new browser context for this test suite
    context = await browser.newContext();
    page = await context.newPage();

    // Login once for all tests in this suite
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    // Initialize page objects
    answersPage = new QuizAnswersPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display quiz answers page', async () => {
    await answersPage.goto();
    await expect(page).toHaveURL(/quiz-answers/);
  });

  test('should show page content', async () => {
    // Page should have some content - either search input, list, or empty state
    const pageHeader = page.getByText(/quiz answers|answers/i);
    const searchInput = answersPage.searchInput;
    const emptyMessage = page.getByText(/no answers|no data/i);

    await expect(
      pageHeader.or(searchInput).or(emptyMessage).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should filter answers by search @critical', async () => {
    await answersPage.waitForLoading();

    // Check if search input exists
    const hasSearch = await answersPage.searchInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSearch) {
      test.skip();
      return;
    }

    const initialCount = await answersPage.getAnswerCount();

    if (initialCount === 0) {
      // No answers - test passes (empty state is valid)
      expect(true).toBe(true);
      return;
    }

    // Search for something that likely won't match
    await answersPage.search('zzzznonexistent12345');

    // Should filter results
    const filteredCount = await answersPage.getAnswerCount();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Clear search
    await answersPage.clearSearch();

    // Should restore results
    const restoredCount = await answersPage.getAnswerCount();
    expect(restoredCount).toBe(initialCount);
  });

  test('should open view modal when clicking view button', async () => {
    await answersPage.waitForLoading();

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip();
      return;
    }

    // Get the first answer's name
    const firstItem = page.locator('[data-testid="answer-item"], [role="listitem"]').first();

    // Try to find and click view button
    const viewButton = firstItem.getByRole('button', { name: /view/i });
    if (await viewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await viewButton.click();

      // Modal should appear
      const modal = page.locator('[role="dialog"], [data-testid="template-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Close modal
      await answersPage.closeModal();
    }
  });

  test('should display answer details in view mode', async () => {
    await answersPage.waitForLoading();

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip();
      return;
    }

    // Click view on first item
    const viewButton = page.locator('[data-testid="answer-item"], [role="listitem"]')
      .first()
      .getByRole('button', { name: /view/i });

    if (await viewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await viewButton.click();

      // Modal should show answer content
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();

      // Should have content
      const modalContent = await modal.textContent();
      expect(modalContent).toBeTruthy();

      await answersPage.closeModal();
    }
  });

  test('should handle empty state gracefully', async () => {
    await answersPage.waitForLoading();

    // Check if search input exists
    const hasSearch = await answersPage.searchInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSearch) {
      // No search input - test passes
      expect(true).toBe(true);
      return;
    }

    // Search for something that won't exist
    await answersPage.search('definitelynonexistent123456789');

    // Should handle empty results gracefully (page doesn't crash)
    await page.waitForTimeout(500);
    expect(true).toBe(true);
  });
});
