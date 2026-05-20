import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { createQuestionerApiHelper, QuestionerApiHelper } from '../../../helpers/questioner-admin.js';
import { fillCurrentPageFields } from '../../../helpers/quiz-form-helpers.js';
import { loginAsTenantAdminBrowser } from '../../../helpers/realm-browser-auth.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';

/**
 * E2E Tests for Submitting an Active Quiz
 *
 * Setup: Creates a multi-page quiz template via the API and activates it.
 *
 * These tests verify:
 * 1. Submit button is visible on the last page
 * 2. Successful submission shows a thank-you message
 * 3. Form is interactive and accepts input
 */
test.describe.serial('Submit Quiz @questioner', () => {
  test.setTimeout(120000);

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

    // KI-5: login against the questioner realm for questioner-api access.
    await loginAsTenantAdminBrowser(page, adminUser, { productRealm: 'questioner' });

    // 2. Set up test data via the API: create and activate a multi-page template
    apiHelper = createQuestionerApiHelper();
    await apiHelper.login(adminUser.username, adminUser.password);
    const template = await apiHelper.createAndActivateMultiPageTemplate('SubmitTest');
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

  test('should show thank you message after successful submission', async () => {
    await quizActivePage.goto();
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    expect(hasQuiz, 'Expected an active quiz to be available after API setup').toBe(true);

    // Fill all pages and submit
    const totalPages = await quizActivePage.getTotalPages();
    let currentPage = await quizActivePage.getCurrentPage();

    // Fill fields on the current page
    await fillCurrentPageFields(page);

    // Navigate through remaining pages, filling fields on each
    while (currentPage < totalPages) {
      await quizActivePage.clickNext();
      await quizActivePage.waitForLoading();
      const newPage = await quizActivePage.getCurrentPage();
      if (newPage === currentPage) {
        // Stuck - might have validation errors
        break;
      }
      currentPage = newPage;

      // Fill fields on the new page
      await fillCurrentPageFields(page);
    }

    // Submit the quiz
    await quizActivePage.submitQuiz();

    // Wait for thank you message
    await quizActivePage.expectThankYouMessage();
  });

  test('should accept input in form fields', async () => {
    await quizActivePage.goto();
    await quizActivePage.waitForLoading();

    const hasQuiz = await quizActivePage.hasActiveQuiz();
    expect(hasQuiz, 'Expected an active quiz to be available after API setup').toBe(true);

    // Fill a text input and verify it accepted the value
    const textInput = page.locator('input[type="text"]').first();
    if (await textInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textInput.fill('Test value before submit');

      const value = await textInput.inputValue();
      expect(value).toBe('Test value before submit');
    }
  });
});

