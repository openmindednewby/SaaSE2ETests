import { test, expect } from '../../../fixtures/index.js';
import type { BrowserContext, Page } from '@playwright/test';
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
  // Multi-step tests need more time
  test.setTimeout(60000);

  let context: BrowserContext;
  let page: Page;
  let templatesPage: QuizTemplatesPage;
  const createdTemplates: string[] = [];

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
    // Web-first assertion auto-retries - no need for waitForLoading
    await expect(templatesPage.deleteInactiveButton).toBeVisible({ timeout: 5000 });
  });

  test('should open confirmation dialog when clicking Delete Inactive', async () => {
    // Serial tests share context - already on page from previous test
    await templatesPage.clickDeleteInactive();
    await expect(templatesPage.confirmDialog).toBeVisible({ timeout: 5000 });
    await expect(templatesPage.confirmButton).toBeVisible();
    await expect(templatesPage.cancelConfirmButton).toBeVisible();
    await templatesPage.cancelDeleteInactive();
  });

  test('should close dialog when clicking Cancel', async () => {
    // Serial tests share context - already on page
    await templatesPage.clickDeleteInactive();
    await expect(templatesPage.confirmDialog).toBeVisible();
    await templatesPage.cancelDeleteInactive();
    await expect(templatesPage.confirmDialog).not.toBeVisible({ timeout: 5000 });
  });

  test('should show "no inactive templates" message when all templates are active', async () => {
    // Clean slate: deactivate any active templates, delete all inactive
    await templatesPage.deactivateAllTemplates();
    await templatesPage.deleteInactiveTemplates();

    // Create and activate a single template
    const activeTemplateName = `Active Only ${Date.now()}`;
    createdTemplates.push(activeTemplateName);
    await templatesPage.createTemplate(activeTemplateName);
    await templatesPage.activateTemplate(activeTemplateName);

    // Try to delete inactive - should return 0
    const deletedCount = await templatesPage.deleteInactiveTemplates();
    expect(deletedCount).toBe(0);

    // Cleanup: deactivate and delete
    await templatesPage.activateTemplate(activeTemplateName);
    await templatesPage.deleteInactiveTemplates();
    createdTemplates.pop();
  });

  test('should delete multiple inactive templates and show count @critical', async () => {
    // Ensure clean state
    await templatesPage.deactivateAllTemplates();

    // Create 3 inactive templates (templates are inactive by default)
    const timestamp = Date.now();
    const inactiveNames = [
      `Inactive Test 1 ${timestamp}`,
      `Inactive Test 2 ${timestamp}`,
      `Inactive Test 3 ${timestamp}`,
    ];

    for (const name of inactiveNames) {
      createdTemplates.push(name);
      await templatesPage.createTemplate(name);
    }

    // Delete all inactive templates
    const deletedCount = await templatesPage.deleteInactiveTemplates();
    expect(deletedCount).toBeGreaterThanOrEqual(3);

    // Verify templates are gone (use web-first assertion)
    for (const name of inactiveNames) {
      await expect(templatesPage.getTemplateRow(name)).not.toBeVisible({ timeout: 5000 });
      const idx = createdTemplates.indexOf(name);
      if (idx > -1) createdTemplates.splice(idx, 1);
    }
  });

  test('should not delete active templates when deleting inactive', async () => {
    // Navigate to templates page (required when running test in isolation)
    await templatesPage.goto();

    // Ensure clean state
    await templatesPage.deactivateAllTemplates();

    // Create one active and one inactive template
    const timestamp = Date.now();
    const activeTemplateName = `Should Stay Active ${timestamp}`;
    const inactiveTemplateName = `Should Be Deleted ${timestamp}`;
    createdTemplates.push(activeTemplateName, inactiveTemplateName);

    await templatesPage.createTemplate(activeTemplateName);
    await templatesPage.createTemplate(inactiveTemplateName);

    // Verify both templates are visible before proceeding (prevents race conditions on mobile)
    await expect(templatesPage.getTemplateRow(activeTemplateName)).toBeVisible({ timeout: 10000 });
    await expect(templatesPage.getTemplateRow(inactiveTemplateName)).toBeVisible({ timeout: 10000 });

    // Activate the first template and verify it succeeded
    const activated = await templatesPage.activateTemplate(activeTemplateName);
    expect(activated).toBe(true);

    // Verify template is actually active before deleting inactive templates
    await templatesPage.expectTemplateActive(activeTemplateName, true);

    // Delete inactive templates
    const deletedCount = await templatesPage.deleteInactiveTemplates();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // Refetch to ensure we see current server state (waits for API response, prevents flaky mobile tests)
    await templatesPage.refetchTemplatesList();

    // Active template should still exist, inactive should be gone
    await expect(templatesPage.getTemplateRow(activeTemplateName)).toBeVisible({ timeout: 10000 });
    await expect(templatesPage.getTemplateRow(inactiveTemplateName)).not.toBeVisible({ timeout: 5000 });

    // Cleanup: deactivate (toggle off) and delete
    await templatesPage.activateTemplate(activeTemplateName);
    await templatesPage.deleteTemplate(activeTemplateName, false);
    createdTemplates.splice(createdTemplates.indexOf(activeTemplateName), 1);
    createdTemplates.splice(createdTemplates.indexOf(inactiveTemplateName), 1);
  });

  test('should refresh template list after deleting inactive', async () => {
    // Create an inactive template
    const templateName = `Refresh Test ${Date.now()}`;
    createdTemplates.push(templateName);
    await templatesPage.createTemplate(templateName);

    // Verify it exists using web-first assertion
    await expect(templatesPage.getTemplateRow(templateName)).toBeVisible();

    // Delete inactive - list should auto-refresh
    await templatesPage.deleteInactiveTemplates();

    // Template should be gone (web-first assertion auto-retries)
    await expect(templatesPage.getTemplateRow(templateName)).not.toBeVisible({ timeout: 5000 });
    createdTemplates.splice(createdTemplates.indexOf(templateName), 1);
  });
});
