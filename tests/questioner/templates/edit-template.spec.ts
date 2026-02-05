import { test, expect } from '../../../fixtures/index.js';
import type { BrowserContext, Page } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('Edit Quiz Template @questioner @crud', () => {
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
  });

  test.beforeEach(async () => {
    await templatesPage.goto();
  });

  async function ensureNoActiveTemplates() {
    await templatesPage.deactivateAllTemplates();
    await templatesPage.refetchTemplatesList();
  }

  test.afterAll(async () => {
    // Cleanup - try to delete the template if it exists
    try {
      // Only attempt cleanup if context is still open
      if (context?.pages().length > 0) {
          await templatesPage.goto();
          if (testTemplateName && await templatesPage.templateExists(testTemplateName)) {
            await templatesPage.deleteTemplate(testTemplateName, false);
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
    await ensureNoActiveTemplates();
    await templatesPage.createTemplate(testTemplateName, 'Original description');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test('should open edit modal when clicking edit @critical', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    await templatesPage.expectTemplateInList(testTemplateName);
    await templatesPage.editTemplate(testTemplateName);

    // Modal should be visible - use page object's getEditModal
    const modal = templatesPage.getEditModal();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Close modal - scroll cancel button into view first (modal content may exceed viewport)
    const cancelButton = modal.getByRole('button', { name: /cancel/i }).first();
    await cancelButton.scrollIntoViewIfNeeded();
    await cancelButton.click();
    await templatesPage.waitForModalToClose();
  });

  test('should pre-populate name field with existing template name @critical', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    await templatesPage.expectTemplateInList(testTemplateName);
    await templatesPage.editTemplate(testTemplateName);

    // Modal should be visible
    const modal = templatesPage.getEditModal();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Name input should be pre-populated with the template's existing name (use data-testid)
    const modalNameInput = modal.locator('[data-testid="template-name-input"]');
    await expect(modalNameInput).toHaveValue(testTemplateName);

    // Close modal
    const cancelButton = modal.getByRole('button', { name: /cancel/i }).first();
    await cancelButton.scrollIntoViewIfNeeded();
    await cancelButton.click();
    await templatesPage.waitForModalToClose();
  });

  test('should update template name', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    await templatesPage.expectTemplateInList(testTemplateName);
    const newName = `Updated ${Date.now()}`;

    await templatesPage.editTemplate(testTemplateName);

    // Find name input in modal and update - use page object's getEditModal
    const modal = templatesPage.getEditModal();
    // Use the same selector strategy as in create (placeholder) for better reliability
    const modalNameInput = modal.getByPlaceholder(/name/i).first();
    await modalNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await modalNameInput.clear();
    await modalNameInput.fill(newName);

    // Save - scroll button into view first (modal content may exceed viewport)
    const saveButton = modal.getByRole('button', { name: /save|update/i }).first();
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    await templatesPage.waitForModalToClose();

    // Verify new name appears
    await templatesPage.expectTemplateInList(newName);

    // Update reference for cleanup
    testTemplateName = newName;
  });

  test('should cancel edit without saving', async () => {
    expect(testTemplateName, 'Test template name not set; did the create test run?').toBeTruthy();
    await templatesPage.expectTemplateInList(testTemplateName);
    await templatesPage.editTemplate(testTemplateName);

    // Modify the name - use page object's getEditModal
    const modal = templatesPage.getEditModal();
    const modalNameInput = modal.getByPlaceholder(/name/i).first();
    await modalNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await modalNameInput.clear();
    await modalNameInput.fill('Should Not Save');

    // Cancel - scroll button into view first (modal content may exceed viewport)
    const cancelButton = modal.getByRole('button', { name: /cancel/i }).first();
    await cancelButton.scrollIntoViewIfNeeded();
    await cancelButton.click();
    await templatesPage.waitForModalToClose();

    // Original name should still be in list
    await templatesPage.expectTemplateInList(testTemplateName);
  });
});
