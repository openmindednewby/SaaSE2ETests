import { test, expect } from '@playwright/test';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';

test.describe('Edit Quiz Template @questioner @crud', () => {
  let templatesPage: QuizTemplatesPage;
  let testTemplateName: string;

  test.beforeEach(async ({ page }) => {
    templatesPage = new QuizTemplatesPage(page);
    testTemplateName = `Edit Test ${Date.now()}`;

    await templatesPage.goto();

    // Create a template to edit
    await templatesPage.createTemplate(testTemplateName, 'Original description');
    await templatesPage.expectTemplateInList(testTemplateName);
  });

  test.afterEach(async () => {
    // Cleanup - try to delete the template
    try {
      if (await templatesPage.templateExists(testTemplateName)) {
        await templatesPage.deleteTemplate(testTemplateName);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should open edit modal when clicking edit @critical', async ({ page }) => {
    await templatesPage.editTemplate(testTemplateName);

    // Modal should be visible
    const modal = page.locator('[role="dialog"], [data-testid="template-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Close modal
    const cancelButton = page.getByRole('button', { name: /cancel|close/i });
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
    }
  });

  test('should update template name', async ({ page }) => {
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

  test('should cancel edit without saving', async ({ page }) => {
    await templatesPage.editTemplate(testTemplateName);

    // Modify the name
    const modalNameInput = page.locator('[role="dialog"] input[type="text"]').first();
    const originalValue = await modalNameInput.inputValue();
    await modalNameInput.fill('Should Not Save');

    // Cancel
    const cancelButton = page.locator('[role="dialog"]').getByRole('button', { name: /cancel/i });
    await cancelButton.click();

    // Original name should still be in list
    await templatesPage.expectTemplateInList(testTemplateName);
  });
});
