import { test, expect } from '../../../fixtures/index.js';
import type { Page, BrowserContext } from '@playwright/test';
import { QuizAnswersPage } from '../../../pages/QuizAnswersPage.js';
import { loginAsTenantAdminBrowser } from '../../../helpers/realm-browser-auth.js';

// Use serial mode so tests run in order and share the same browser context
test.describe.serial('View Quiz Answers @questioner', () => {
  let context: BrowserContext;
  let page: Page;
  let answersPage: QuizAnswersPage;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90000);
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    if (!username || !password) {
      throw new Error('TEST_USER_USERNAME or TEST_USER_PASSWORD not set');
    }

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

    // KI-5: login against the questioner realm for questioner-api access.
    await loginAsTenantAdminBrowser(page, { username, password }, { productRealm: 'questioner' });

    // Initialize page objects
    answersPage = new QuizAnswersPage(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('should open view modal when clicking view button', async () => {
    await answersPage.waitForLoading();

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip();
      return;
    }

    // Get the first answer's name
    const firstItem = page.locator('[data-testid="answer-item"], [role="listitem"]').first();

    // Try to find and click view button
    const viewButton = firstItem.getByRole('button', { name: /view/i });
    if (await viewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await viewButton.click();

      // Modal should appear
      const modal = page.locator('[role="dialog"], [data-testid="template-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Close modal
      await answersPage.closeModal();
    }
  });

  test('should display answer details in view mode', async () => {
    await answersPage.waitForLoading();

    const answerCount = await answersPage.getAnswerCount();
    if (answerCount === 0) {
      test.skip();
      return;
    }

    // Click view on first item
    const viewButton = page.locator('[data-testid="answer-item"], [role="listitem"]')
      .first()
      .getByRole('button', { name: /view/i });

    if (await viewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await viewButton.click();

      // Modal should show answer content
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();

      // Should have content
      const modalContent = await modal.textContent();
      expect(modalContent).toBeTruthy();

      await answersPage.closeModal();
    }
  });
});
