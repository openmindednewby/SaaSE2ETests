import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Edit Quiz Template @questioner @crud', () => {
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

  test.afterAll(async () => {
    // Cleanup - try to delete the template if it exists
    try {
      // Only attempt cleanup if context is still open
      if (context?.pages().length > 0) {
          if (testTemplateName && await templatesPage.templateExists(testTemplateName)) {
            await templatesPage.deleteTemplate(testTemplateName);
          }
      }
    } catch (e) {
      console.log('Cleanup failed (expected if test crashed):', e);
    } finally {
        await context?.close().catch(() => {});
    }
  });

  test('should create template for editing', async () => {
    testTemplateName = `Edit Test ${Date.now()}`;
    await templatesPage.goto();
    await templatesPage.createTemplate(testTemplateName, 'Original description');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test('should open edit modal when clicking edit @critical', async () => {
    await templatesPage.editTemplate(testTemplateName);

    // Modal should be visible - use page object's getEditModal
    const modal = templatesPage.getEditModal();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Close modal - use cancel button within the modal
    const cancelButton = modal.getByRole('button', { name: /cancel/i }).first();
    if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelButton.click();
      await templatesPage.waitForModalToClose();
    }
  });

  test('should update template name', async () => {
    const newName = `Updated ${Date.now()}`;

    await templatesPage.editTemplate(testTemplateName);

    // Find name input in modal and update - use page object's getEditModal
    const modal = templatesPage.getEditModal();
    // Use the same selector strategy as in create (placeholder) for better reliability
    const modalNameInput = modal.getByPlaceholder(/name/i).first();
    await modalNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await modalNameInput.clear();
    await modalNameInput.fill(newName);

    // Save
    const saveButton = modal.getByRole('button', { name: /save|update/i }).first();
    await saveButton.click({ force: true });
    await templatesPage.waitForLoading();
    await templatesPage.waitForModalToClose();

    // Verify new name appears
    await templatesPage.expectTemplateInList(newName);

    // Update reference for cleanup
    testTemplateName = newName;
  });

  test('should cancel edit without saving', async () => {
    await templatesPage.editTemplate(testTemplateName);

    // Modify the name - use page object's getEditModal
    const modal = templatesPage.getEditModal();
    const modalNameInput = modal.getByPlaceholder(/name/i).first();
    await modalNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await modalNameInput.clear();
    await modalNameInput.fill('Should Not Save');

    // Cancel
    const cancelButton = modal.getByRole('button', { name: /cancel/i });
    await cancelButton.click();
    await templatesPage.waitForModalToClose();

    // Original name should still be in list
    await templatesPage.expectTemplateInList(testTemplateName);
  });
});
