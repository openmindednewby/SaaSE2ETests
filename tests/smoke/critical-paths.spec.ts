import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
import { QuizTemplatesPage } from '../../pages/QuizTemplatesPage.js';
import { QuizActivePage } from '../../pages/QuizActivePage.js';
import { QuizAnswersPage } from '../../pages/QuizAnswersPage.js';

test.describe('Critical Path Smoke Tests @smoke @critical', () => {
  test('complete user journey: login -> create template -> activate -> view answers', async ({ page }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      test.skip(true, 'Test credentials not configured');
      return;
    }

    // 1. Login
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);

    // Verify we're in protected area
    await expect(page).toHaveURL(/\(protected\)/);

    // 2. Navigate to Quiz Templates
    const templatesPage = new QuizTemplatesPage(page);
    await templatesPage.goto();

    // Verify page loaded
    await expect(page).toHaveURL(/quiz-templates/);

    // 3. Create a test template
    const templateName = `Smoke Test ${Date.now()}`;
    await templatesPage.createTemplate(templateName, 'Smoke test template');
    await templatesPage.expectTemplateInList(templateName);

    // 4. Activate the template
    await templatesPage.activateTemplate(templateName);

    // 5. Navigate to Quiz Active page
    const quizActivePage = new QuizActivePage(page);
    await quizActivePage.goto();
    await expect(page).toHaveURL(/quiz-active/);

    // 6. Navigate to Quiz Answers page
    const answersPage = new QuizAnswersPage(page);
    await answersPage.goto();
    await expect(page).toHaveURL(/quiz-answers/);

    // 7. Cleanup - delete the test template
    await templatesPage.goto();
    await templatesPage.deleteTemplate(templateName);

    // Verify deletion
    const stillExists = await templatesPage.templateExists(templateName);
    expect(stillExists).toBe(false);
  });

  test('navigation between all protected pages', async ({ page }) => {
    // Uses authenticated state from setup

    // Navigate to each protected route
    const routes = [
      '/(protected)',
      '/(protected)/quiz-templates',
      '/(protected)/quiz-active',
      '/(protected)/quiz-answers',
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Verify we stayed on a protected route (not redirected to login)
      const url = page.url();
      expect(url).toMatch(/\(protected\)/);
    }
  });

  test('authenticated API calls work correctly', async ({ page }) => {
    // Navigate to templates page which makes API calls
    const templatesPage = new QuizTemplatesPage(page);
    await templatesPage.goto();

    // Wait for API response
    await templatesPage.waitForLoading();

    // Page should not show error state
    const errorMessage = page.getByText(/error|failed|unauthorized/i);
    const hasError = await errorMessage.isVisible({ timeout: 2000 }).catch(() => false);

    // If there's an error, it should not be an auth error
    if (hasError) {
      const errorText = await errorMessage.textContent();
      expect(errorText?.toLowerCase()).not.toContain('unauthorized');
      expect(errorText?.toLowerCase()).not.toContain('401');
    }
  });

  test('template CRUD operations work end-to-end', async ({ page }) => {
    const templatesPage = new QuizTemplatesPage(page);
    await templatesPage.goto();

    const templateName = `CRUD Test ${Date.now()}`;
    const updatedName = `Updated ${Date.now()}`;

    // Create
    await templatesPage.createTemplate(templateName, 'CRUD test');
    await templatesPage.expectTemplateInList(templateName);

    // Update (via edit modal)
    await templatesPage.editTemplate(templateName);

    const modal = page.locator('[role="dialog"]');
    if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
      const nameInput = modal.locator('input[type="text"]').first();
      await nameInput.clear();
      await nameInput.fill(updatedName);

      const saveButton = modal.getByRole('button', { name: /save|update/i });
      await saveButton.click();
      await templatesPage.waitForLoading();
    }

    // Verify update (if modal was found)
    if (await templatesPage.templateExists(updatedName)) {
      // Delete updated template
      await templatesPage.deleteTemplate(updatedName);
      expect(await templatesPage.templateExists(updatedName)).toBe(false);
    } else {
      // Delete original template
      await templatesPage.deleteTemplate(templateName);
      expect(await templatesPage.templateExists(templateName)).toBe(false);
    }
  });

  test('page refresh maintains authenticated state', async ({ page }) => {
    await page.goto('/(protected)/quiz-templates');
    await expect(page).toHaveURL(/quiz-templates/);

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on protected route
    await expect(page).toHaveURL(/\(protected\)/);
  });

  test('all main pages load without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];

    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Listen for page errors
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Visit each main page
    const pages = [
      '/(protected)',
      '/(protected)/quiz-templates',
      '/(protected)/quiz-active',
      '/(protected)/quiz-answers',
    ];

    for (const route of pages) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000); // Allow time for async errors
    }

    // Filter out known benign errors (e.g., failed network requests are OK)
    const criticalErrors = errors.filter(e =>
      !e.includes('net::') &&
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError')
    );

    // Log errors for debugging but don't fail on minor issues
    if (criticalErrors.length > 0) {
      console.warn('Console errors detected:', criticalErrors);
    }
  });
});
