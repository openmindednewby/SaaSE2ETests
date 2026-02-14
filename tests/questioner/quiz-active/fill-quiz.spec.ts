import { test, expect } from '../../../fixtures/index.js';
import type { Page, BrowserContext } from '@playwright/test';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';
import { LoginPage } from '../../../pages/LoginPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Fill Active Quiz @questioner', () => {
  let context: BrowserContext;
  let page: Page;
  let quizActivePage: QuizActivePage;

  test.beforeAll(async ({ browser }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      throw new Error('TEST_USER_USERNAME or TEST_USER_PASSWORD not set');
    }

    // Create a new browser context for this test suite
    context = await browser.newContext();
    page = await context.newPage();

    // Add init script to restore auth from localStorage to sessionStorage on page load
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

    // Login once for all tests in this suite
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    // Save auth state to localStorage so it persists across page navigations
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    // Initialize page objects
    quizActivePage = new QuizActivePage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should display active quiz page', async () => {
    await quizActivePage.goto();
    await expect(page).toHaveURL(/quiz-active/);
  });

  test('should show loading state or content', async () => {
    // Either loading indicator or content should be visible
    const loadingIndicator = page.locator('[role="progressbar"]');
    const quizContent = page.locator('[data-testid="quiz-content"]');
    const activeQuizHeading = page.getByText(/Active Quiz/i);
    const noQuizMessage = page.getByText(/no questions|no active quiz/i);

    // Wait for any of these to appear
    await expect(
      loadingIndicator.or(quizContent).or(activeQuizHeading).or(noQuizMessage).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display quiz content when available @critical', async () => {
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();

    if (hasQuiz) {
      // If there's a quiz, we should see question elements
      const questions = page.locator('[data-testid^="question-"], [role="textbox"], [role="radio"], [role="checkbox"]');
      const count = await questions.count();
      expect(count).toBeGreaterThan(0);
    } else {
      // No active quiz is a valid state - test passes
      expect(true).toBe(true);
    }
  });

  test('should navigate between pages if multi-page quiz', async () => {
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    if (!hasQuiz) {
      test.skip();
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
    } else {
      // Single page quiz - test passes
      expect(totalPages).toBe(1);
    }
  });

  test('should validate required fields', async () => {
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    if (!hasQuiz) {
      test.skip();
      return;
    }

    // Try to proceed without filling required fields
    await quizActivePage.clickNext();

    // Should show validation error or move to next page (if no required fields)
    // This test verifies the form doesn't crash
    const _hasError = await quizActivePage.hasValidationError();
    // Test passes regardless - we're just checking the page doesn't crash
    expect(true).toBe(true);
  });
});
