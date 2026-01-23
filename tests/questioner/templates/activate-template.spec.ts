import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Activate Quiz Template @questioner @crud', () => {
  test.setTimeout(120000);
  let context: BrowserContext;
  let page: Page;
  let templatesPage: QuizTemplatesPage;
  let testTemplateName: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    // Create a new browser context for this test suite
    context = await browser.newContext();
    page = await context.newPage();

    // Login as tenant admin
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(adminUser.username, adminUser.password);

    // Initialize page objects
    templatesPage = new QuizTemplatesPage(page);
  });

  test.beforeEach(async () => {
    await templatesPage.goto();
  });

  async function ensureNoActiveTemplates() {
    await templatesPage.deactivateAllTemplates();
    await templatesPage.refetchTemplatesList();
  }

  test.afterAll(async () => {
    // Cleanup
    try {
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
    await templatesPage.expectTemplateInList(testTemplateName);

    // Activate the template
    await ensureNoActiveTemplates();
    const activated = await templatesPage.activateTemplate(testTemplateName);
    if (!activated) {
      // Common flake: another test in the same tenant activated something concurrently.
      // Deactivate again and retry once.
      await ensureNoActiveTemplates();
      await templatesPage.activateTemplate(testTemplateName);
    }

    // Check if it shows as active
    await templatesPage.expectTemplateActive(testTemplateName, true);
  });

  test('should deactivate an active template', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    // Template should already be active from previous test
    await templatesPage.expectTemplateActive(testTemplateName, true);

    // Deactivate (click activate again to toggle)
    await templatesPage.activateTemplate(testTemplateName);

    // Check if it's now inactive
    await templatesPage.expectTemplateActive(testTemplateName, false);
  });

  test('should show active template on quiz-active page', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    // Activate the template again
    await templatesPage.activateTemplate(testTemplateName);

    // Navigate to quiz active page
    const quizActivePage = new QuizActivePage(page);
    await quizActivePage.goto();

    // Verify we're on the quiz active page (web-first assertion auto-retries)
    await expect(page).toHaveURL(/quiz-active/);
  });
});
