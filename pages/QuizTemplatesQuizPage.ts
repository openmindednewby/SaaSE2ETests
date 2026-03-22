import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for quiz-taking and active quiz template operations.
 * Handles template activation/deactivation, status checks, bulk operations,
 * and the delete-inactive-templates flow.
 *
 * For template CRUD (create, edit, delete, list), use QuizTemplatesPage.
 */
export class QuizTemplatesQuizPage extends BasePage {
  readonly templateList: Locator;
  readonly deleteInactiveButton: Locator;
  readonly confirmDialog: Locator;
  readonly confirmButton: Locator;
  readonly cancelConfirmButton: Locator;
  readonly templateNameInput: Locator;

  constructor(page: Page) {
    super(page);
    this.templateList = page.locator(testIdSelector(TestIds.TEMPLATE_LIST));
    this.deleteInactiveButton = page.locator(testIdSelector(TestIds.DELETE_INACTIVE_BUTTON));
    this.confirmDialog = page.locator(testIdSelector(TestIds.CONFIRM_DIALOG));
    this.confirmButton = page.locator(testIdSelector(TestIds.CONFIRM_BUTTON));
    this.cancelConfirmButton = page.locator(testIdSelector(TestIds.CANCEL_CONFIRM_BUTTON));
    this.templateNameInput = page.locator(testIdSelector(TestIds.TEMPLATE_NAME_INPUT));
  }

  /**
   * Wait for page to be ready after navigation.
   */
  private async waitForPageReady() {
    await this.page.waitForLoadState('load');
    await this.dismissOverlay();
    const PAGE_READY_TIMEOUT = 60000;
    await Promise.race([
      this.templateNameInput.waitFor({ state: 'visible', timeout: PAGE_READY_TIMEOUT }),
      this.deleteInactiveButton.waitFor({ state: 'visible', timeout: PAGE_READY_TIMEOUT }),
    ]);
    await this.waitForLoading();
  }

  /**
   * Navigate to quiz templates page
   */
  async goto() {
    await super.goto('/quiz-templates');
    await this.waitForPageReady();
  }

  /**
   * Get template row by name
   */
  private getTemplateRows(name: string): Locator {
    return this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM)).filter({
      has: this.page.locator(testIdSelector(TestIds.HEADING_TEXT), { hasText: name }),
    });
  }

  private getTemplateRow(name: string): Locator {
    return this.getTemplateRows(name).first();
  }

  /**
   * Click activate button for a template
   */
  async activateTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.scrollIntoViewIfNeeded();

    const statusLabel = row.locator(testIdSelector(TestIds.STATUS_LABEL));
    const statusBefore = ((await statusLabel.textContent().catch(() => '')) ?? '').trim();
    const wasActive = /^(active|enabled)$/i.test(statusBefore);

    const apiPromise = this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && (response.request().method() === 'PUT' || response.request().method() === 'DELETE'),
      { timeout: 15000 }
    ).catch(() => null);

    const getPromise = this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    const activateBtn = row.getByRole('button', { name: /activate|deactivate/i });
    if (await activateBtn.isVisible({ timeout: 2000 })) {
      await activateBtn.click({ force: true });
    } else {
      await row.locator('text=/activate|🔁/i').first().click({ force: true });
    }

    const response = await apiPromise;
    let apiSuccess = false;

    if (response?.ok()) {
      apiSuccess = true;
      await getPromise;
    }

    await this.waitForLoading();

    if (apiSuccess) {
      const expectedStatus = wasActive ? /inactive|disabled/i : /active|enabled/i;
      await expect(statusLabel).toHaveText(expectedStatus, { timeout: 5000 }).catch(() => {});
    }

    return apiSuccess;
  }

  /**
   * Check if template is active
   */
  async isTemplateActive(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const statusLabel = row.locator(testIdSelector(TestIds.STATUS_LABEL));
    const statusText = ((await statusLabel.textContent().catch(() => '')) ?? '').trim();
    return /^(active|enabled)$/i.test(statusText);
  }

  async expectTemplateActive(name: string, active: boolean = true) {
    const expected = active ? /active|enabled/i : /inactive|disabled/i;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.waitForLoading();
      const row = this.getTemplateRow(name);
      const statusLabel = row.locator(testIdSelector(TestIds.STATUS_LABEL));
      try {
        await expect(statusLabel).toHaveText(expected, { timeout: 10000 });
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        await this.goto();
      }
    }
  }

  /**
   * Click the Delete Inactive button to open the confirmation dialog
   */
  async clickDeleteInactive(): Promise<void> {
    await this.waitForLoading();
    await this.deleteInactiveButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.deleteInactiveButton.click();
    await this.confirmDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Confirm the delete inactive dialog and wait for API response
   */
  async confirmDeleteInactive(): Promise<number> {
    const deletePromise = this.page.waitForResponse(
      response =>
        response.url().includes('/questionerTemplates/delete/inactive') &&
        response.request().method() === 'DELETE',
      { timeout: 15000 }
    );

    const getPromise = this.page.waitForResponse(
      response =>
        response.url().includes('/questionerTemplates') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    await this.confirmButton.click();

    const response = await deletePromise;
    let deletedCount = 0;

    if (response.ok()) {
      try {
        const body = await response.json();
        deletedCount = body.deletedCount ?? 0;
      } catch {
        // Could not parse delete inactive response
      }
    }

    await expect(this.confirmDialog).not.toBeVisible({ timeout: 5000 });
    await getPromise;
    await this.waitForLoading();
    return deletedCount;
  }

  async cancelDeleteInactive(): Promise<void> {
    await this.cancelConfirmButton.click();
    await expect(this.confirmDialog).not.toBeVisible({ timeout: 5000 });
  }

  async deleteInactiveTemplates(): Promise<number> {
    await this.clickDeleteInactive();
    return await this.confirmDeleteInactive();
  }

  /**
   * Deactivate any templates that are currently marked as active/enabled.
   */
  async deactivateAllTemplates() {
    // eslint-disable-next-line no-page-reload/no-page-reload -- reload ensures fresh server state, not stale React Query cache
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.waitForPageReady();

    const statusSelector = testIdSelector(TestIds.STATUS_LABEL);
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;
      const activeRows = this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM)).filter({
        has: this.page.locator(statusSelector, { hasText: /^(active|enabled)$/i })
      });
      const count = await activeRows.count();
      if (count === 0) break;

      const row = activeRows.first();
      await row.scrollIntoViewIfNeeded().catch(() => {});

      const apiPromise = this.page.waitForResponse(
        response => response.url().includes('/questionerTemplates') && (response.request().method() === 'PUT' || response.request().method() === 'DELETE'),
        { timeout: 10000 }
      ).catch(() => null);

      const getPromise = this.page.waitForResponse(
        response => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
        { timeout: 10000 }
      ).catch(() => null);

      const activateButton = row.getByRole('button', { name: /activate|deactivate/i }).first();
      const activateFallback = row.locator('text=/activate|🔁|⚡/i').first();

      if (await activateButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await activateButton.click({ force: true });
      } else if (await activateFallback.isVisible({ timeout: 1000 }).catch(() => false)) {
        await activateFallback.click({ force: true });
      } else {
        // eslint-disable-next-line no-page-reload/no-page-reload -- reload required when no activate button found to refresh DOM state
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.waitForPageReady();
        continue;
      }

      await apiPromise;
      await getPromise;
      await this.waitForLoading();
    }
  }
}
