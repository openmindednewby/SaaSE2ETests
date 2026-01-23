
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
      // Deactivate all templates first (T2 is active at end of test)
      await templatesPage.goto();
      await templatesPage.deactivateAllTemplates();
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
    // Note: deactivateAllTemplates() already called in beforeEach - no need to call again

    // 1. Create two templates
    await createTemplateAndWait(templatesPage, t1Name, 'T1 Desc');
    await createTemplateAndWait(templatesPage, t2Name, 'T2 Desc');

    // 2. Activate T1
    await templatesPage.activateTemplate(t1Name);
    await templatesPage.expectTemplateActive(t1Name, true);

    // 3. Try to activate T2 -> Should fail (409 Conflict)
    await templatesPage.activateTemplate(t2Name);
    // T1 should still be active, T2 should still be inactive
    await templatesPage.expectTemplateActive(t1Name, true);
    await templatesPage.expectTemplateActive(t2Name, false);

    // 4. Deactivate T1 (toggle off)
    await templatesPage.activateTemplate(t1Name);
    await templatesPage.expectTemplateActive(t1Name, false);

    // 5. Now activate T2 -> Should succeed
    // Note: May need retry if there's a race condition with the deactivation
    let t2Activated = await templatesPage.activateTemplate(t2Name);
    if (!t2Activated) {
      // Retry once after a short wait for backend to catch up
      await templatesPage.page.reload({ waitUntil: 'commit' });
      await templatesPage.waitForLoading();
      t2Activated = await templatesPage.activateTemplate(t2Name);
    }
    await templatesPage.expectTemplateActive(t2Name, true);
  });
});
