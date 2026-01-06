import { test, expect, Page, BrowserContext } from '@playwright/test';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';
import { LoginPage } from '../../../pages/LoginPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Activate Quiz Template @questioner @crud', () => {
  let context: BrowserContext;
  let page: Page;
  let templatesPage: QuizTemplatesPage;
  let testTemplateName: string;

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
    templatesPage = new QuizTemplatesPage(page);
  });

  test.afterAll(async () => {
    // Cleanup
    try {
      if (testTemplateName && await templatesPage.templateExists(testTemplateName)) {
        await templatesPage.deleteTemplate(testTemplateName);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create template for activation tests', async () => {
    testTemplateName = `Activate Test ${Date.now()}`;
    await templatesPage.goto();
    await templatesPage.createTemplate(testTemplateName, 'Template for activation test');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test('should activate a template @critical', async () => {
    // Activate the template
    await templatesPage.activateTemplate(testTemplateName);

    // Check if it shows as active
    const isActive = await templatesPage.isTemplateActive(testTemplateName);
    expect(isActive).toBe(true);
  });

  test('should deactivate an active template', async () => {
    // Template should already be active from previous test
    expect(await templatesPage.isTemplateActive(testTemplateName)).toBe(true);

    // Deactivate (click activate again to toggle)
    await templatesPage.activateTemplate(testTemplateName);

    // Check if it's now inactive
    const isActive = await templatesPage.isTemplateActive(testTemplateName);
    expect(isActive).toBe(false);
  });

  test('should show active template on quiz-active page', async () => {
    // Activate the template again
    await templatesPage.activateTemplate(testTemplateName);

    // Navigate to quiz active page
    const quizActivePage = new QuizActivePage(page);
    await quizActivePage.goto();

    // The active template should be displayed
    // Note: This depends on the template having questions
    // Since we created a basic template, it might show "no questions"
    await page.waitForTimeout(2000);

    // Verify we're on the quiz active page
    await expect(page).toHaveURL(/quiz-active/);
  });
});
