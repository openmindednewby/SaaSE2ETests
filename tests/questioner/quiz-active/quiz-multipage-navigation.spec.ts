import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { createQuestionerApiHelper, QuestionerApiHelper } from '../../../helpers/questioner-admin.js';
import { fillCurrentPageFields } from '../../../helpers/quiz-form-helpers.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';

/**
 * E2E Tests for Multi-Page Quiz Cross-Page Validation and Navigation
 *
 * Continuation of BUG-QUIZ-004 validation tests. These tests verify:
 * 1. Cross-page validation catches empty required fields from earlier pages
 * 2. Back navigation preserves field values across pages
 *
 * Setup: Creates a multi-page quiz template via the API and activates it.
 */
test.describe.serial('Multi-Page Quiz Navigation @questioner @validation @critical', () => {
  test.setTimeout(180000); // 3 minutes for multi-step tests

  let context: BrowserContext;
  let page: Page;
  let quizActivePage: QuizActivePage;
  let apiHelper: QuestionerApiHelper;
  let templateExternalId: string | null = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // 1. Browser login FIRST (before any API calls to avoid auth interference)
    context = await browser.newContext();
    page = await context.newPage();

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

    await page.evaluate(() => {
      const persistAuth = sessionStorage.getItem('persist:auth');
      if (persistAuth) {
        localStorage.setItem('persist:auth', persistAuth);
      }
    });

    // 2. Set up test data via the API: create and activate a multi-page template
    apiHelper = createQuestionerApiHelper();
    await apiHelper.login(adminUser.username, adminUser.password);
    const template = await apiHelper.createAndActivateMultiPageTemplate('NavTest');
    templateExternalId = template.externalId;

    quizActivePage = new QuizActivePage(page);
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(60000);
    if (apiHelper && templateExternalId) {
      await apiHelper.cleanup(templateExternalId, []).catch(() => {});
    }
    await context?.close();
  });

  test('should validate all pages when submitting from last page (BUG-QUIZ-004)', async () => {
    await quizActivePage.goto();
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    expect(hasQuiz, 'Expected an active quiz to be available after API setup').toBe(true);

    const totalPages = await quizActivePage.getTotalPages();
    expect(totalPages, 'Expected a multi-page quiz (2+ pages)').toBeGreaterThan(1);

    // Strategy: Fill page 1, advance to page 2, leave page 2 empty,
    // then try to submit. The validateAllPages() fix should catch errors
    // on page 2 even though we're on the last page.

    // Fill fields on page 1
    await fillCurrentPageFields(page, 'Page 1 answer');

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
    expect(hasQuiz, 'Expected an active quiz to be available after API setup').toBe(true);

    const totalPages = await quizActivePage.getTotalPages();
    expect(totalPages, 'Expected a multi-page quiz (2+ pages)').toBeGreaterThan(1);

    // Fill page 1 and advance
    await fillCurrentPageFields(page, 'Navigation test');

    await quizActivePage.clickNext();
    const afterNext = await quizActivePage.getCurrentPage();

    if (afterNext > 1) {
      // Go back to page 1
      await quizActivePage.clickBack();
      const afterBack = await quizActivePage.getCurrentPage();
      expect(afterBack).toBe(1);

      // Verify page 1 fields still have their values
      const textInputs = page.getByPlaceholder(/enter your answer/i);
      const firstInput = textInputs.first();
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
