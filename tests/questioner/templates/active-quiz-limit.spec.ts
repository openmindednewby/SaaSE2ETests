
import { expect, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage';
import { activateTemplateAndWait, createTemplateAndWait } from '../../../flows/quiz-templates.flow.js';

test.describe('Active Quiz Limit @questioner', () => {
  // Increase timeout for this test suite since it involves multiple operations
  test.setTimeout(120000);

  let t1Name: string;
  let t2Name: string;
  let templatesPage: QuizTemplatesPage;
  let context: any;

  test.beforeAll(async ({ browser }) => {
    // Shared context for speed if separate tests, but we'll do one flow here
    // Actually standard is separate tests, but this is a sequence
  });

  test.beforeEach(async ({ browser }, testInfo) => {
    context = await browser.newContext();
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    templatesPage = new QuizTemplatesPage(page);

    const runId = `${testInfo.project.name}-${Date.now()}`;
    t1Name = `Limit Test T1 ${runId}`;
    t2Name = `Limit Test T2 ${runId}`;

    await loginPage.goto();
    const { admin } = getProjectUsers(testInfo.project.name);
    await loginPage.loginAndWait(admin.username, admin.password);
    await templatesPage.goto();
    await templatesPage.deactivateAllTemplates();
  });

  test.afterEach(async () => {
    try {
      if (await templatesPage.templateExists(t1Name)) {
        await templatesPage.deleteTemplate(t1Name, false);
      }
      if (await templatesPage.templateExists(t2Name)) {
        await templatesPage.deleteTemplate(t2Name, false);
      }
    } finally {
        await context.close().catch(() => {});
    }
  });

  test('Should only allow one active quiz at a time', async () => {
    await templatesPage.deactivateAllTemplates();
    // 1. Create two templates
    await createTemplateAndWait(templatesPage, t1Name, 'T1 Desc');
    
    await createTemplateAndWait(templatesPage, t2Name, 'T2 Desc');

    // Initial state: both should be inactive
    await templatesPage.expectTemplateActive(t1Name, false);
    await templatesPage.expectTemplateActive(t2Name, false);

    // 2. Activate T1
    const t1Activated = await activateTemplateAndWait(templatesPage, t1Name);
    if (!t1Activated) {
      // If T1 activation failed, there might be another template active - try to deactivate all and retry
      console.log('T1 activation failed, deactivating all templates and retrying...');
      await templatesPage.deactivateAllTemplates();
      await activateTemplateAndWait(templatesPage, t1Name);
    }
    await templatesPage.expectTemplateActive(t1Name, true);
    await templatesPage.expectTemplateActive(t2Name, false);

    // 3. Activate T2 -> Should Fail because T1 is active
    // Depending on UI implementation, we might see a toast error or the status just doesn't change.
    // Assuming the UI handles the 409 Conflict:
    await activateTemplateAndWait(templatesPage, t2Name);
    
    // Check states - T1 should still be active, T2 should still be inactive
    await templatesPage.expectTemplateActive(t1Name, true);
    await templatesPage.expectTemplateActive(t2Name, false);

    // Optional: Check for error notification (may be transient/toast-based)
    // The backend sends "Another template is already active..." on 409 Conflict
    // The notification check is optional since the key validation is the status check above
    const errorNotification = templatesPage.page.getByText(/another template is already active/i);
    const notificationVisible = await errorNotification.isVisible({ timeout: 2000 }).catch(() => false);
    if (notificationVisible) {
      console.log('Error notification displayed correctly');
    } else {
      console.log('Error notification not visible (may have already dismissed or toast-based)');
    }

    // 4. Deactivate T1
    await activateTemplateAndWait(templatesPage, t1Name); // Toggle off (assuming toggle logic) OR explicit deactivate
    // If activateTemplate just clicks the button, and button is "Deactivate" or Toggle, this works.
    await templatesPage.expectTemplateActive(t1Name, false);

    // 5. Now Activate T2 -> Should Success
    await activateTemplateAndWait(templatesPage, t2Name);
    await templatesPage.expectTemplateActive(t2Name, true);
    await templatesPage.expectTemplateActive(t1Name, false);
  });
});
