
import { expect, test } from '@playwright/test';
import { TEST_USERS } from '../../../fixtures/test-data';
import { LoginPage } from '../../../pages/LoginPage';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage';

test.describe('Active Quiz Limit @questioner', () => {
  const t1Name = `Limit Test T1 ${Date.now()}`;
  const t2Name = `Limit Test T2 ${Date.now()}`;
  let templatesPage: QuizTemplatesPage;
  let context: any;

  test.beforeAll(async ({ browser }) => {
    // Shared context for speed if separate tests, but we'll do one flow here
    // Actually standard is separate tests, but this is a sequence
  });

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    templatesPage = new QuizTemplatesPage(page);

    await loginPage.goto();
    await loginPage.loginAndWait(TEST_USERS.TENANT_A_ADMIN.username, TEST_USERS.TENANT_A_ADMIN.password);
    await templatesPage.goto();
  });

  test.afterEach(async () => {
    try {
      if (await templatesPage.templateExists(t1Name)) {
        await templatesPage.deleteTemplate(t1Name);
      }
      if (await templatesPage.templateExists(t2Name)) {
        await templatesPage.deleteTemplate(t2Name);
      }
    } finally {
        await context.close().catch(() => {});
    }
  });

  test('Should only allow one active quiz at a time', async () => {
    // 1. Create two templates
    await templatesPage.createTemplate(t1Name, 'T1 Desc');
    await templatesPage.expectTemplateInList(t1Name);
    
    await templatesPage.createTemplate(t2Name, 'T2 Desc');
    await templatesPage.expectTemplateInList(t2Name);

    // Initial state: both should be inactive
    await templatesPage.expectTemplateActive(t1Name, false);
    await templatesPage.expectTemplateActive(t2Name, false);

    // 2. Activate T1
    await templatesPage.activateTemplate(t1Name);
    await templatesPage.expectTemplateActive(t1Name, true);
    await templatesPage.expectTemplateActive(t2Name, false);

    // 3. Activate T2 -> Should Fail because T1 is active
    // Depending on UI implementation, we might see a toast error or the status just doesn't change.
    // Assuming the UI handles the 409 Conflict:
    await templatesPage.activateTemplate(t2Name);
    
    // Check states - T1 should still be active, T2 should still be inactive
    await templatesPage.expectTemplateActive(t1Name, true);
    await templatesPage.expectTemplateActive(t2Name, false);

    // Expect error notification
    // The exact text depends on translation, but backend sends "Another template is already active..."
    await expect(templatesPage.page.getByText(/another template is already active/i)).toBeVisible({ timeout: 5000 });
    
    // 4. Deactivate T1
    await templatesPage.activateTemplate(t1Name); // Toggle off (assuming toggle logic) OR explicit deactivate
    // If activateTemplate just clicks the button, and button is "Deactivate" or Toggle, this works.
    await templatesPage.expectTemplateActive(t1Name, false);

    // 5. Now Activate T2 -> Should Success
    await templatesPage.activateTemplate(t2Name);
    await templatesPage.expectTemplateActive(t2Name, true);
    await templatesPage.expectTemplateActive(t1Name, false);
  });
});
