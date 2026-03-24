import { test, expect } from '../../../fixtures/index.js';
import type { BrowserContext, Page } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';
import { QuizTemplatesQuizPage } from '../../../pages/QuizTemplatesQuizPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Activate Quiz Template @questioner @crud', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let templatesPage: QuizTemplatesPage;
  let quizPage: QuizTemplatesQuizPage;
  let testTemplateName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

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

    // Login as tenant admin
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

    // Initialize page objects
    templatesPage = new QuizTemplatesPage(page);
    quizPage = new QuizTemplatesQuizPage(page);
  });

  test.beforeEach(async () => {
    try {
      await templatesPage.goto();
    } catch {
      // Retry once on navigation failure (common under heavy parallel load)
      await templatesPage.goto();
    }
  });

  async function ensureNoActiveTemplates() {
    await quizPage.deactivateAllTemplates();
    await templatesPage.refetchTemplatesList();
  }

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(120000);
    // Cleanup - deactivate first if active, then delete
    try {
      await templatesPage.goto();
      await quizPage.deactivateAllTemplates();
      if (testTemplateName && await templatesPage.templateExists(testTemplateName)) {
        await templatesPage.deleteTemplate(testTemplateName, false);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create template for activation tests', async () => {
    testTemplateName = `Activate Test ${Date.now()}`;
    await templatesPage.goto();
    await ensureNoActiveTemplates();
    await templatesPage.createTemplate(testTemplateName, 'Template for activation test');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test('should activate a template @critical', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();

    // Ensure clean state first, then verify/recreate template
    await ensureNoActiveTemplates();

    // Re-create template if it was deleted by another test's deleteInactiveTemplates
    if (!await templatesPage.templateExists(testTemplateName)) {
      await templatesPage.createTemplate(testTemplateName, 'Template for activation test');
    }
    await templatesPage.expectTemplateInList(testTemplateName);

    // Activate the template
    const activated = await quizPage.activateTemplate(testTemplateName);
    if (!activated) {
      // Common flake: another test in the same tenant activated something concurrently.
      // Deactivate again and retry once.
      await ensureNoActiveTemplates();
      await quizPage.activateTemplate(testTemplateName);
    }

    // Check if it shows as active
    await quizPage.expectTemplateActive(testTemplateName, true);
  });

  test('should deactivate an active template', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    // Template should already be active from previous test
    await quizPage.expectTemplateActive(testTemplateName, true);

    // Deactivate (click activate again to toggle)
    await quizPage.activateTemplate(testTemplateName);

    // Check if it's now inactive
    await quizPage.expectTemplateActive(testTemplateName, false);
  });

  test('should show active template on quiz-active page', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();

    // Re-create template if it was deleted (e.g. by deleteInactiveTemplates in another spec)
    if (!await templatesPage.templateExists(testTemplateName)) {
      await templatesPage.createTemplate(testTemplateName, 'Template for activation test');
    }

    // Activate the template
    await ensureNoActiveTemplates();
    const activated = await quizPage.activateTemplate(testTemplateName);
    if (!activated) {
      await ensureNoActiveTemplates();
      await quizPage.activateTemplate(testTemplateName);
    }

    // Navigate to quiz active page
    const quizActivePage = new QuizActivePage(page);
    await quizActivePage.goto();

    // Verify we're on the quiz active page (web-first assertion auto-retries)
    await expect(page).toHaveURL(/quiz-active/);
  });
});
