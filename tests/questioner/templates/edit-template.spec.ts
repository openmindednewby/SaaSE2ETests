import { BrowserContext, expect, Page, test } from '@playwright/test';
import { TEST_USERS } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';
import { TestIds, testIdSelector } from '../../../shared/testIds.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Edit Quiz Template @questioner @crud', () => {
  let context: BrowserContext;
  let page: Page;
  let templatesPage: QuizTemplatesPage;
  let testTemplateName: string;

  test.beforeAll(async ({ browser }) => {
    // Use tenant A admin (has admin role required to create templates)
    const adminUser = TEST_USERS.TENANT_A_ADMIN;

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

  test.afterAll(async () => {
    // Cleanup - try to delete the template if it exists
    try {
      if (testTemplateName && await templatesPage.templateExists(testTemplateName)) {
        await templatesPage.deleteTemplate(testTemplateName);
      }
    } catch {
      // Ignore cleanup errors
    }
    await context?.close();
  });

  test('should create template for editing', async () => {
    testTemplateName = `Edit Test ${Date.now()}`;
    await templatesPage.goto();
    await templatesPage.createTemplate(testTemplateName, 'Original description');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test('should open edit modal when clicking edit @critical', async () => {
    await templatesPage.editTemplate(testTemplateName);

    // Modal should be visible
    const modal = page.locator(`[role="dialog"], ${testIdSelector(TestIds.TEMPLATE_MODAL)}`);
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Close modal - use the modal's cancel button specifically
    const modalCancelButton = page.locator(testIdSelector(TestIds.TEMPLATE_MODAL)).getByRole('button', { name: /cancel/i }).first();
    if (await modalCancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modalCancelButton.click();
    }
  });

  test('should update template name', async () => {
    const newName = `Updated ${Date.now()}`;

    await templatesPage.editTemplate(testTemplateName);

    // Find name input in modal and update
    const modalNameInput = page.locator('[role="dialog"] input[type="text"]').first();
    await modalNameInput.clear();
    await modalNameInput.fill(newName);

    // Save
    const saveButton = page.locator('[role="dialog"]').getByRole('button', { name: /save|update/i });
    await saveButton.click();
    await templatesPage.waitForLoading();

    // Verify new name appears
    await templatesPage.expectTemplateInList(newName);

    // Update reference for cleanup
    testTemplateName = newName;
  });

  test('should cancel edit without saving', async () => {
    await templatesPage.editTemplate(testTemplateName);

    // Modify the name
    const modalNameInput = page.locator('[role="dialog"] input[type="text"]').first();
    await modalNameInput.fill('Should Not Save');

    // Cancel
    const cancelButton = page.locator('[role="dialog"]').getByRole('button', { name: /cancel/i });
    await cancelButton.click();

    // Original name should still be in list
    await templatesPage.expectTemplateInList(testTemplateName);
  });
});
