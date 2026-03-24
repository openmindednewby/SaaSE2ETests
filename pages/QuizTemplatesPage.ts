import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for quiz template CRUD operations.
 * Handles navigation, creating, editing, deleting, and listing templates.
 *
 * For activation/deactivation and bulk operations, use QuizTemplatesQuizPage.
 */
export class QuizTemplatesPage extends BasePage {
  readonly pageHeader: Locator;
  readonly templateNameInput: Locator;
  readonly templateDescriptionInput: Locator;
  readonly saveButton: Locator;
  readonly templateList: Locator;
  readonly loadingIndicator: Locator;
  readonly deleteInactiveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeader = page.getByText(/quiz templates/i);
    this.templateNameInput = page.locator(testIdSelector(TestIds.TEMPLATE_NAME_INPUT));
    this.templateDescriptionInput = page.getByPlaceholder(/description/i);
    const creationForm = page.locator(testIdSelector(TestIds.CREATE_TEMPLATE_FORM));
    this.saveButton = creationForm.getByRole('button', { name: /save/i });
    this.templateList = page.locator(testIdSelector(TestIds.TEMPLATE_LIST));
    this.loadingIndicator = page.locator('[role="progressbar"]');
    this.deleteInactiveButton = page.locator(testIdSelector(TestIds.DELETE_INACTIVE_BUTTON));
  }

  private async waitForPageReady() {
    await this.page.waitForLoadState('load');
    await this.dismissOverlay();
    // 60s timeout accounts for slow dev builds under concurrent browser load
    const PAGE_READY_TIMEOUT = 60000;
    await Promise.race([
      this.templateNameInput.waitFor({ state: 'visible', timeout: PAGE_READY_TIMEOUT }),
      this.deleteInactiveButton.waitFor({ state: 'visible', timeout: PAGE_READY_TIMEOUT }),
    ]);
    await this.waitForLoading();
  }

  async goto() {
    await super.goto('/quiz-templates');

    // Firefox auth recovery: the app may redirect to /login if the addInitScript
    // ran before localStorage was populated. Restore auth and retry once.
    if (this.page.url().includes('/login')) {
      await this.restoreAuth();
      // eslint-disable-next-line no-page-reload/no-page-reload -- auth recovery requires fresh navigation
      await this.page.goto('/quiz-templates', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    try {
      await this.waitForPageReady();
    } catch {
      // Firefox under concurrency may deliver a broken page bundle.
      // Reload once; the retry usually succeeds because the JS assets
      // are now cached by the browser.
      await this.restoreAuth();
      // eslint-disable-next-line no-page-reload/no-page-reload -- recovery reload after page-ready timeout
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.waitForPageReady();
    }
  }

  async refetchTemplatesList() {
    await this.waitForLoading();

    const listFetch = this.page.waitForResponse(
      (response) => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    // eslint-disable-next-line no-page-reload/no-page-reload -- Force fresh server state to avoid stale cache
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.waitForPageReady();
    await listFetch;
  }

  async createTemplate(name: string, description: string = '') {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Ensure form is visible (locator auto-retries, no need for waitForLoading)
      await this.templateNameInput.waitFor({ state: 'visible', timeout: 15000 });

      // Fill name (fill() clears first, no need for separate clear)
      await this.templateNameInput.fill(name);

      if (description) {
        await this.templateDescriptionInput.fill(description);
      }

      // Set up BOTH response listeners BEFORE clicking Save:
      // 1. POST (the create call)
      // 2. GET (the list refetch triggered by React Query cache invalidation)
      const postPromise = this.page.waitForResponse(
        response => response.url().includes('/questionerTemplates') && response.request().method() === 'POST',
        { timeout: 15000 }
      ).catch(() => null);

      const getPromise = this.page.waitForResponse(
        response =>
          response.url().includes('/questionerTemplates') &&
          response.request().method() === 'GET',
        { timeout: 15000 }
      ).catch(() => null);

      await this.saveButton.click({ force: true });

      // Wait for POST to complete
      const postResponse = await postPromise;

      // On 429 (rate limited), wait and retry
      if (postResponse && postResponse.status() === 429 && attempt < MAX_RETRIES) {
        // Wait for any GET that was triggered, then wait before retrying
        await getPromise;
        await this.waitForLoading();
        // eslint-disable-next-line no-wait-for-timeout/no-wait-for-timeout -- intentional backoff for rate-limit retry
        await this.page.waitForTimeout(2000 * attempt);
        continue;
      }

      // Wait for the list refetch GET to complete
      await getPromise;

      // Wait for any loading indicator to clear after the refetch
      await this.waitForLoading();
      return;
    }
  }

  getTemplateRows(name: string): Locator {
    return this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM)).filter({
      has: this.page.locator(testIdSelector(TestIds.HEADING_TEXT), { hasText: name }),
    });
  }

  getTemplateRow(name: string): Locator {
    return this.getTemplateRows(name).first();
  }

  async templateExists(name: string): Promise<boolean> {
    await this.waitForLoading();
    const template = this.getTemplateRow(name);
    return await template.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
  }

  async expectTemplateInList(name: string) {
    const template = this.getTemplateRow(name);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await expect(template).toBeVisible({ timeout: 15000 });
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        // Refetch the list and try again
        await this.refetchTemplatesList();
      }
    }
  }

  async editTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.scrollIntoViewIfNeeded();

    const editBtn = row.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 2000 })) {
      await editBtn.click();
    } else {
      await row.locator('text=/edit/i').first().click();
    }

    // React Native Modal creates two dialog elements (outer wrapper + inner content)
    await expect(this.page.getByRole('dialog').first()).toBeVisible({ timeout: 10000 });
  }

  getEditModal(): Locator {
    return this.page.getByRole('dialog').first();
  }

  async waitForModalToClose() {
    await expect(this.page.getByRole('dialog').first()).not.toBeVisible({ timeout: 10000 });
  }

  async deleteTemplate(name: string, throwOnError: boolean = true) {
    const rows = this.getTemplateRows(name);
    const row = rows.first();
    await row.scrollIntoViewIfNeeded();

    const dialogHandler = async (dialog: any) => {
      await dialog.accept();
    };
    this.page.once('dialog', dialogHandler);

    // 1. DELETE (the delete call)
    const deletePromise = this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'DELETE',
      { timeout: 15000 }
    ).catch(() => null);

    const getPromise = this.page.waitForResponse(
      response =>
        response.url().includes('/questionerTemplates') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    const deleteBtn = row.getByRole('button', { name: /delete/i });
    const deleteBtnByText = row.locator('text=Delete').first();
    const deleteBtnByEmoji = row.locator('text=🗑️').first();

    if (await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtn.click({ force: true });
    } else if (await deleteBtnByText.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtnByText.click({ force: true });
    } else if (await deleteBtnByEmoji.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtnByEmoji.click({ force: true });
    } else {
      await row.locator('[data-testid], [role="button"]').filter({ hasText: /delete/i }).first().click({ force: true });
    }

    // If a custom modal is present, only click within that modal (never a global fallback).
    const dialog = this.page.locator('[role="dialog"]');
    if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      const dialogConfirm = dialog.getByRole('button', { name: /confirm|ok|yes|delete/i }).last();
      if (await dialogConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialogConfirm.click({ timeout: 5000, force: true }).catch(() => {});
      }
    }

    const response = await deletePromise;
    if (response) {
      if (response.status() !== 404 && !response.ok()) {
        const errorMsg = `Template deletion API returned status ${response.status()}`;
        if (throwOnError) {
          throw new Error(errorMsg);
        }
      }
    }

    await getPromise;
    await this.waitForLoading();

    try {
      await expect(rows).toHaveCount(0, { timeout: 5000 });
    } catch {
      if (throwOnError) {
        throw new Error(`Template "${name}" still visible after deletion`);
      }
    }
  }

  async getTemplateNames(): Promise<string[]> {
    await this.waitForLoading();
    const items = this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM));
    await items.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});

    const count = await items.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      // Try to get title from heading-text test ID first, with a very short timeout
      const text = await item.locator(testIdSelector(TestIds.HEADING_TEXT)).first()
        .textContent({ timeout: 1000 })
        .catch(() => null);

      if (text) {
        names.push(text.trim());
      } else {
        // Fallback to searching for the first Text element or just text content
        const fullText = await item.textContent().catch(() => '');
        if (fullText) names.push(fullText.split('\n')[0].trim());
      }
    }
    return names;
  }

}
