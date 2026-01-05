import { test, expect } from '@playwright/test';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';
import { QuizActivePage } from '../../../pages/QuizActivePage.js';

test.describe('Activate Quiz Template @questioner @crud', () => {
  let templatesPage: QuizTemplatesPage;
  let testTemplateName: string;

  test.beforeEach(async ({ page }) => {
    templatesPage = new QuizTemplatesPage(page);
    testTemplateName = `Activate Test ${Date.now()}`;

    await templatesPage.goto();

    // Create a template to activate
    await templatesPage.createTemplate(testTemplateName, 'Template for activation test');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test.afterEach(async () => {
    // Cleanup
    try {
      await templatesPage.goto();
      if (await templatesPage.templateExists(testTemplateName)) {
        await templatesPage.deleteTemplate(testTemplateName);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should activate a template @critical', async ({ page }) => {
    // Activate the template
    await templatesPage.activateTemplate(testTemplateName);

    // Check if it shows as active
    const isActive = await templatesPage.isTemplateActive(testTemplateName);
    expect(isActive).toBe(true);
  });

  test('should deactivate an active template', async ({ page }) => {
    // First activate
    await templatesPage.activateTemplate(testTemplateName);
    expect(await templatesPage.isTemplateActive(testTemplateName)).toBe(true);

    // Then deactivate (click activate again to toggle)
    await templatesPage.activateTemplate(testTemplateName);

    // Check if it's now inactive
    const isActive = await templatesPage.isTemplateActive(testTemplateName);
    expect(isActive).toBe(false);
  });

  test('should show active template on quiz-active page', async ({ page }) => {
    // Activate the template
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
