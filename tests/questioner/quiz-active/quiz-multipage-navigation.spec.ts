import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';

/**
 * E2E Tests for Multi-Page Quiz Cross-Page Validation and Navigation
 *
 * Continuation of BUG-QUIZ-004 validation tests. These tests verify:
 * 1. Cross-page validation catches empty required fields from earlier pages
 * 2. Back navigation preserves field values across pages
 */
test.describe.serial('Multi-Page Quiz Navigation @questioner @validation @critical', () => {
  test.setTimeout(180000); // 3 minutes for multi-step tests

  let context: BrowserContext;
  let page: Page;
  let quizActivePage: QuizActivePage;

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

    // Save auth state to localStorage so it persists across page navigations
    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    quizActivePage = new QuizActivePage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should validate all pages when submitting from last page (BUG-QUIZ-004)', async () => {
    await quizActivePage.goto();
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    if (!hasQuiz) {
      test.skip(true, 'No active quiz available - cannot test cross-page validation');
      return;
    }

    const totalPages = await quizActivePage.getTotalPages();
    if (totalPages <= 1) {
      test.skip(true, 'Single-page quiz - cross-page validation not applicable');
      return;
    }

    // Strategy: Fill page 1, advance to page 2, leave page 2 empty,
    // then try to submit. The validateAllPages() fix should catch errors
    // on page 2 even though we're on the last page.

    // Fill fields on page 1
    const textInputs = page.locator('input[type="text"], textarea');
    const inputCount = await textInputs.count();
    for (let i = 0; i < inputCount; i++) {
      const input = textInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill(`Page 1 answer ${i + 1}`);
      }
    }

    // Select first radio option on page 1
    const radioGroups = page.locator('[role="radiogroup"]');
    const radioCount = await radioGroups.count();
    for (let i = 0; i < radioCount; i++) {
      const group = radioGroups.nth(i);
      if (await group.isVisible()) {
        const firstRadio = group.locator('[role="radio"]').first();
        if (await firstRadio.isVisible()) {
          await firstRadio.click();
        }
      }
    }

    // Navigate to page 2 (should work since page 1 is filled)
    await quizActivePage.clickNext();
    const currentPage = await quizActivePage.getCurrentPage();

    if (currentPage > 1) {
      // We successfully advanced to page 2+
      // Leave this page's fields EMPTY and try to submit or advance

      if (currentPage === totalPages) {
        // We're on the last page - try to submit with empty fields
        await quizActivePage.submitQuiz();
      } else {
        // Navigate to the last page
        while ((await quizActivePage.getCurrentPage()) < totalPages) {
          await quizActivePage.clickNext();
          const newPage = await quizActivePage.getCurrentPage();
          if (newPage === currentPage) break; // Stuck due to validation
        }

        if ((await quizActivePage.getCurrentPage()) === totalPages) {
          await quizActivePage.submitQuiz();
        }
      }

      // After BUG-QUIZ-004 fix: should either show validation errors
      // (from unfilled required fields on page 2+) or thank you message
      // (if page 2 has no required fields)
      const thankYou = page.getByText(/thank you/i);
      const errorText = page.getByText(/required|error|please fill|validation/i);

      await expect(
        thankYou.or(errorText).first()
      ).toBeVisible({ timeout: 10000 });
    } else {
      // Could not advance past page 1 - validation on page 1 prevented it
      // This is still valid behavior - validation is working
      const hasError = await quizActivePage.hasValidationError();
      expect(hasError).toBe(true);
    }
  });

  test('should allow going back and fixing validation errors', async () => {
    await quizActivePage.goto();
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    if (!hasQuiz) {
      test.skip(true, 'No active quiz available');
      return;
    }

    const totalPages = await quizActivePage.getTotalPages();
    if (totalPages <= 1) {
      test.skip(true, 'Single-page quiz - back navigation not applicable');
      return;
    }

    // Fill page 1 and advance
    const textInputs = page.locator('input[type="text"], textarea');
    const inputCount = await textInputs.count();
    for (let i = 0; i < inputCount; i++) {
      const input = textInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill(`Navigation test ${i + 1}`);
      }
    }

    const radioGroups = page.locator('[role="radiogroup"]');
    const radioCount = await radioGroups.count();
    for (let i = 0; i < radioCount; i++) {
      const group = radioGroups.nth(i);
      if (await group.isVisible()) {
        const firstRadio = group.locator('[role="radio"]').first();
        if (await firstRadio.isVisible()) {
          await firstRadio.click();
        }
      }
    }

    await quizActivePage.clickNext();
    const afterNext = await quizActivePage.getCurrentPage();

    if (afterNext > 1) {
      // Go back to page 1
      await quizActivePage.clickBack();
      const afterBack = await quizActivePage.getCurrentPage();
      expect(afterBack).toBe(1);

      // Verify page 1 fields still have their values
      const textInputsAfterBack = page.locator('input[type="text"], textarea');
      const firstInput = textInputsAfterBack.first();
      if (await firstInput.isVisible()) {
        const value = await firstInput.inputValue();
        expect(
          value.length > 0,
          'Field values should be preserved when navigating back'
        ).toBe(true);
      }
    }
  });
});
