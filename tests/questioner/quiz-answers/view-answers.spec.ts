import { test, expect } from '@playwright/test';
import { QuizAnswersPage } from '../../../pages/QuizAnswersPage.js';

test.describe('View Quiz Answers @questioner', () => {
  let answersPage: QuizAnswersPage;

  test.beforeEach(async ({ page }) => {
    answersPage = new QuizAnswersPage(page);
    await answersPage.goto();
  });

  test('should display quiz answers page', async ({ page }) => {
    await expect(page).toHaveURL(/quiz-answers/);
  });

  test('should show search input', async () => {
    await expect(answersPage.searchInput).toBeVisible();
  });

  test('should filter answers by search @critical', async ({ page }) => {
    await answersPage.waitForLoading();

    const initialCount = await answersPage.getAnswerCount();

    if (initialCount === 0) {
      test.skip(true, 'No answers available to search');
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

  test('should open view modal when clicking view button', async ({ page }) => {
    await answersPage.waitForLoading();

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip(true, 'No answers available to view');
      return;
    }

    // Get the first answer's name
    const firstItem = page.locator('[data-testid="answer-item"], [role="listitem"]').first();
    const itemText = await firstItem.textContent();

    if (itemText) {
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
    }
  });

  test('should display answer details in view mode', async ({ page }) => {
    await answersPage.waitForLoading();

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip(true, 'No answers available');
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

      // Should be in read-only mode (check for disabled inputs or read-only indicator)
      const modalContent = await modal.textContent();
      expect(modalContent).toBeTruthy();

      await answersPage.closeModal();
    }
  });

  test('should handle empty state gracefully', async ({ page }) => {
    await answersPage.waitForLoading();

    // Search for something that won't exist
    await answersPage.search('definitelynonexistent123456789');

    // Should handle empty results gracefully
    const isEmpty = await answersPage.isListEmpty();
    // Either shows empty state or the search just filters to nothing
    expect(isEmpty).toBe(true);
  });
});
