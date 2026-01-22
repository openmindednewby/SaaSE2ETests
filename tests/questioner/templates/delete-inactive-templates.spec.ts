import { BrowserContext, expect, Page, test } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { LoginPage } from '../../../pages/LoginPage.js';
import { QuizTemplatesPage } from '../../../pages/QuizTemplatesPage.js';

/**
 * Tests for the "Delete Inactive Templates" feature.
 *
 * This feature allows users to bulk delete all templates that are not currently active,
 * helping to clean up old/unused templates.
 */
test.describe.serial('Delete Inactive Templates @questioner @crud', () => {
  let context: BrowserContext;
  let page: Page;
  let templatesPage: QuizTemplatesPage;
  const createdTemplates: string[] = [];

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
    // Cleanup any remaining templates created during tests
    if (templatesPage) {
      await templatesPage.goto();
      for (const name of createdTemplates) {
        try {
          const exists = await templatesPage.templateExists(name);
          if (exists) {
            await templatesPage.deleteTemplate(name, false);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    await context?.close();
  });

  test('should display Delete Inactive button on templates page', async () => {
    await templatesPage.goto();

    // Wait for page to load
    await templatesPage.waitForLoading();

    // Check that Delete Inactive button is visible
    await expect(templatesPage.deleteInactiveButton).toBeVisible({ timeout: 5000 });
  });

  test('should open confirmation dialog when clicking Delete Inactive', async () => {
    await templatesPage.goto();
    await templatesPage.waitForLoading();

    // Click delete inactive button
    await templatesPage.clickDeleteInactive();

    // Verify dialog is visible
    await expect(templatesPage.confirmDialog).toBeVisible({ timeout: 5000 });

    // Verify dialog has confirm and cancel buttons
    await expect(templatesPage.confirmButton).toBeVisible();
    await expect(templatesPage.cancelConfirmButton).toBeVisible();

    // Cancel to close dialog
    await templatesPage.cancelDeleteInactive();
  });

  test('should close dialog when clicking Cancel', async () => {
    await templatesPage.goto();
    await templatesPage.waitForLoading();

    // Open dialog
    await templatesPage.clickDeleteInactive();
    await expect(templatesPage.confirmDialog).toBeVisible();

    // Cancel
    await templatesPage.cancelDeleteInactive();

    // Dialog should be closed
    await expect(templatesPage.confirmDialog).not.toBeVisible({ timeout: 5000 });
  });

  test('should show "no inactive templates" message when all templates are active', async () => {
    // Increase timeout for this test since it involves multiple operations
    test.setTimeout(60000);

    await templatesPage.goto();
    await templatesPage.waitForLoading();

    // First, deactivate all existing templates and delete them to start fresh
    await templatesPage.deactivateAllTemplates();
    await templatesPage.deleteInactiveTemplates();

    // Create a single template (created as inactive by default)
    const activeTemplateName = `Active Only ${Date.now()}`;
    createdTemplates.push(activeTemplateName);

    await templatesPage.createTemplate(activeTemplateName, 'Test active template');

    // Activate it (templates are created inactive by default)
    const isAlreadyActive = await templatesPage.isTemplateActive(activeTemplateName);
    if (!isAlreadyActive) {
      await templatesPage.activateTemplate(activeTemplateName);
    }
    await templatesPage.expectTemplateActive(activeTemplateName, true);

    // Now try to delete inactive - should return 0 since our only template is active
    const deletedCount = await templatesPage.deleteInactiveTemplates();
    expect(deletedCount).toBe(0);

    // Cleanup: Just delete the template directly - deactivate via the delete inactive flow
    // Toggle to inactive first
    await templatesPage.activateTemplate(activeTemplateName);
    // Delete it (now inactive)
    await templatesPage.deleteInactiveTemplates();
    createdTemplates.pop();
  });

  test('should delete multiple inactive templates and show count @critical', async () => {
    await templatesPage.goto();
    await templatesPage.waitForLoading();

    // First deactivate all templates
    await templatesPage.deactivateAllTemplates();

    // Create 3 inactive templates
    const inactiveNames: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const name = `Inactive Test ${i} ${Date.now()}`;
      inactiveNames.push(name);
      createdTemplates.push(name);
      await templatesPage.createTemplate(name, `Inactive template ${i}`);
    }

    // Verify all templates are inactive (they should be inactive by default)
    for (const name of inactiveNames) {
      await templatesPage.expectTemplateActive(name, false);
    }

    // Delete all inactive templates
    const deletedCount = await templatesPage.deleteInactiveTemplates();

    // Should have deleted at least 3 (our created templates)
    expect(deletedCount).toBeGreaterThanOrEqual(3);

    // Verify templates are gone
    for (const name of inactiveNames) {
      const exists = await templatesPage.templateExists(name);
      expect(exists).toBe(false);
    }

    // Remove from cleanup list since they're already deleted
    inactiveNames.forEach(name => {
      const idx = createdTemplates.indexOf(name);
      if (idx > -1) createdTemplates.splice(idx, 1);
    });
  });

  test('should not delete active templates when deleting inactive', async () => {
    await templatesPage.goto();
    await templatesPage.waitForLoading();

    // Deactivate all templates first
    await templatesPage.deactivateAllTemplates();

    // Create one active template and one inactive template
    const activeTemplateName = `Should Stay Active ${Date.now()}`;
    const inactiveTemplateName = `Should Be Deleted ${Date.now()}`;
    createdTemplates.push(activeTemplateName, inactiveTemplateName);

    await templatesPage.createTemplate(activeTemplateName, 'Active template');
    await templatesPage.createTemplate(inactiveTemplateName, 'Inactive template');

    // Activate only one template
    await templatesPage.activateTemplate(activeTemplateName);
    await templatesPage.expectTemplateActive(activeTemplateName, true);
    await templatesPage.expectTemplateActive(inactiveTemplateName, false);

    // Delete inactive templates
    const deletedCount = await templatesPage.deleteInactiveTemplates();

    // Should have deleted at least the inactive one
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // Active template should still exist
    const activeExists = await templatesPage.templateExists(activeTemplateName);
    expect(activeExists).toBe(true);

    // Inactive template should be gone
    const inactiveExists = await templatesPage.templateExists(inactiveTemplateName);
    expect(inactiveExists).toBe(false);

    // Cleanup - deactivate and delete the active template
    await templatesPage.activateTemplate(activeTemplateName); // Toggle to inactive
    await templatesPage.deleteTemplate(activeTemplateName, false);

    // Update cleanup list
    const activeIdx = createdTemplates.indexOf(activeTemplateName);
    if (activeIdx > -1) createdTemplates.splice(activeIdx, 1);
    const inactiveIdx = createdTemplates.indexOf(inactiveTemplateName);
    if (inactiveIdx > -1) createdTemplates.splice(inactiveIdx, 1);
  });

  test('should refresh template list after deleting inactive', async () => {
    await templatesPage.goto();
    await templatesPage.waitForLoading();

    // Create an inactive template
    const templateName = `Refresh Test ${Date.now()}`;
    createdTemplates.push(templateName);

    await templatesPage.createTemplate(templateName, 'Test template');

    // Verify it exists
    let exists = await templatesPage.templateExists(templateName);
    expect(exists).toBe(true);

    // Delete inactive
    await templatesPage.deleteInactiveTemplates();

    // List should automatically refresh - template should be gone without manual refresh
    exists = await templatesPage.templateExists(templateName);
    expect(exists).toBe(false);

    // Remove from cleanup
    const idx = createdTemplates.indexOf(templateName);
    if (idx > -1) createdTemplates.splice(idx, 1);
  });
});
