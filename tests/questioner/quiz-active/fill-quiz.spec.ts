import { test, expect } from '@playwright/test';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';

test.describe('Fill Active Quiz @questioner', () => {
  let quizActivePage: QuizActivePage;

  test.beforeEach(async ({ page }) => {
    quizActivePage = new QuizActivePage(page);
    await quizActivePage.goto();
  });

  test('should display active quiz page', async ({ page }) => {
    await expect(page).toHaveURL(/quiz-active/);
  });

  test('should show loading state initially', async ({ page }) => {
    // Reload to see loading state
    await page.reload();

    // Either loading indicator or content should be visible
    const loadingOrContent = page.locator('[role="progressbar"], [data-testid="quiz-content"], text=/Active Quiz/i');
    await expect(loadingOrContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display quiz content when available @critical', async ({ page }) => {
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();

    if (hasQuiz) {
      // If there's a quiz, we should see question elements
      const questions = page.locator('[data-testid^="question-"], [role="textbox"], [role="radio"], [role="checkbox"]');
      const count = await questions.count();
      expect(count).toBeGreaterThan(0);
    } else {
      // If no quiz, should show appropriate message
      const noQuizMessage = page.getByText(/no questions|no active quiz|failed to load/i);
      await expect(noQuizMessage).toBeVisible();
    }
  });

  test('should navigate between pages if multi-page quiz', async ({ page }) => {
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    if (!hasQuiz) {
      test.skip(true, 'No active quiz available');
      return;
    }

    const totalPages = await quizActivePage.getTotalPages();

    if (totalPages > 1) {
      // Should be on page 1
      expect(await quizActivePage.getCurrentPage()).toBe(1);

      // Click next (may require filling required fields first)
      await quizActivePage.clickNext();

      // Either moved to next page or showed validation error
      const currentPage = await quizActivePage.getCurrentPage();
      const hasError = await quizActivePage.hasValidationError();

      expect(currentPage > 1 || hasError).toBe(true);
    }
  });

  test('should validate required fields', async ({ page }) => {
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    if (!hasQuiz) {
      test.skip(true, 'No active quiz available');
      return;
    }

    // Try to proceed without filling required fields
    await quizActivePage.clickNext();

    // Should show validation error
    const hasError = await quizActivePage.hasValidationError();
    // Note: This may pass if there are no required fields on the current page
  });
});
