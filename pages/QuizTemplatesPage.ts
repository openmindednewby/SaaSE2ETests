import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

export class QuizTemplatesPage extends BasePage {
  readonly pageHeader: Locator;
  readonly templateNameInput: Locator;
  readonly templateDescriptionInput: Locator;
  readonly saveButton: Locator;
  readonly templateList: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    // Based on quiz-templates/index.tsx
    this.pageHeader = page.getByText(/quiz templates/i);
    // TemplateForm component inputs
    const creationForm = page.locator(testIdSelector(TestIds.CREATE_TEMPLATE_FORM));
    this.templateNameInput = creationForm.getByPlaceholder(/name/i);
    this.templateDescriptionInput = creationForm.getByPlaceholder(/description/i);
    this.saveButton = creationForm.getByRole('button', { name: /save/i });
    this.templateList = page.locator(testIdSelector(TestIds.TEMPLATE_LIST));
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to quiz templates page
   * Expo Router: (protected) is a route group, URL is just /quiz-templates
   */
  async goto() {
    await super.goto('/quiz-templates');
    await this.waitForLoading();
  }

  /**
   * Force a fresh fetch of the templates list (helps when React Query cache is stale).
   */
  async refetchTemplatesList() {
    await this.waitForLoading();

    const listFetch = this.page.waitForResponse(
      (response) => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForLoading();
    await listFetch;
    await this.page.waitForTimeout(200);
  }

  /**
   * Create a new template
   */
  async createTemplate(name: string, description: string = '') {
    await this.waitForLoading();
    
    // Ensure form is visible
    await this.templateNameInput.waitFor({ state: 'visible', timeout: 5000 });

    // Clear and fill name
    await this.templateNameInput.fill('');
    await this.templateNameInput.fill(name);
    
    if (description) {
      await this.templateDescriptionInput.fill('');
      await this.templateDescriptionInput.fill(description);
    }

    // Ensure button is clickable
    await this.saveButton.waitFor({ state: 'visible' });
    const isDisabled = await this.saveButton.isDisabled();
    if (isDisabled) {
      console.error('Save button is disabled. Form validation might have failed.');
      // Try to focus name input to trigger validation
      await this.templateNameInput.focus();
      await this.page.waitForTimeout(500);
    }

    // Click Save button and wait for API response
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'POST',
      { timeout: 15000 }
    ).catch(() => null);

    await this.saveButton.click({ force: true });

    const response = await responsePromise;
    if (response) {
      if (response.ok()) {
        console.log(`Template "${name}" created successfully.`);
      } else {
        console.warn(`Template creation API returned status ${response.status()}`);
      }
    } else {
      console.warn('No POST /questionerTemplates API call detected for template creation');
    }

    await this.waitForLoading();

    // Wait for the list to refetch (the GET call after create)
    await this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    await this.page.waitForTimeout(500);
  }

  /**
   * Get template row by name
   */
  getTemplateRows(name: string): Locator {
    return this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM)).filter({
      has: this.page.locator(testIdSelector(TestIds.HEADING_TEXT), { hasText: name }),
    });
  }

  getTemplateRow(name: string): Locator {
    // Find the template item that contains a heading with the specified name
    return this.getTemplateRows(name).first();
  }

  /**
   * Check if a template exists in the list
   */
  async templateExists(name: string): Promise<boolean> {
    await this.waitForLoading();
    const template = this.getTemplateRow(name);
    return await template.waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Expect template to be visible in the list
   */
  async expectTemplateInList(name: string) {
    const template = this.getTemplateRow(name);
    await expect(template).toBeVisible({ timeout: 10000 });
  }

  /**
   * Click edit button for a template
   */
  async editTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await row.scrollIntoViewIfNeeded();

    const editBtn = row.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 2000 })) {
      await editBtn.click({ force: true });
    } else {
      await row.locator('text=/edit/i').first().click({ force: true });
    }

    // Wait for modal to appear - try both testId and role="dialog"
    const modalByTestId = this.page.locator(testIdSelector(TestIds.TEMPLATE_MODAL));
    const modalByRole = this.page.locator('[role="dialog"]');

    // Wait for either to be visible
    await Promise.race([
      modalByTestId.waitFor({ state: 'visible', timeout: 5000 }),
      modalByRole.waitFor({ state: 'visible', timeout: 5000 }),
    ]).catch(() => {
      throw new Error('Edit modal did not appear within 5 seconds');
    });

    // Wait for animations to settle
    await this.page.waitForTimeout(500);
  }

  /**
   * Get the edit modal locator (handles both testId and role="dialog")
   */
  getEditModal(): Locator {
    // Check if testId-based modal exists, otherwise use role="dialog"
    const modalByTestId = this.page.locator(testIdSelector(TestIds.TEMPLATE_MODAL));
    const modalByRole = this.page.locator('[role="dialog"]');
    // Return a combined locator that matches either
    return this.page.locator(`${testIdSelector(TestIds.TEMPLATE_MODAL)}, [role="dialog"]`).first();
  }

  async waitForModalToClose() {
    // Wait for both possible modal types to close
    const modalByTestId = this.page.locator(testIdSelector(TestIds.TEMPLATE_MODAL));
    const modalByRole = this.page.locator('[role="dialog"]');

    await Promise.all([
      expect(modalByTestId).not.toBeVisible({ timeout: 10000 }).catch(() => {}),
      expect(modalByRole).not.toBeVisible({ timeout: 10000 }).catch(() => {}),
    ]);
  }

  /**
   * Click delete button for a template
   * @param throwOnError - If false, won't throw on API errors (useful for cleanup)
   */
  async deleteTemplate(name: string, throwOnError: boolean = true) {
    const rows = this.getTemplateRows(name);
    const row = rows.first();
    // Scroll to row
    await row.scrollIntoViewIfNeeded();

    // Set up dialog handler
    const dialogHandler = async (dialog: any) => {
      await dialog.accept();
    };
    this.page.once('dialog', dialogHandler);

    // Set up response listener for delete API call
    const deletePromise = this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'DELETE',
      { timeout: 15000 }
    ).catch(() => null);

    // Try multiple selectors for the delete button
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

    // Most quiz template deletes are immediate (no confirmation modal).
    // If a custom modal is present, only click within that modal (never a global fallback).
    const dialog = this.page.locator('[role="dialog"]');
    if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      const dialogConfirm = dialog.getByRole('button', { name: /confirm|ok|yes|delete/i }).last();
      if (await dialogConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialogConfirm.click({ timeout: 5000, force: true }).catch(() => {});
      }
    }

    // Wait for the delete API call to complete
    const response = await deletePromise;
    if (response) {
      if (response.status() === 404) {
        console.warn(`Template deletion API returned 404 for "${name}" (already removed?).`);
      } else if (!response.ok()) {
        const errorMsg = `Template deletion API returned status ${response.status()}`;
        if (throwOnError) {
          throw new Error(errorMsg);
        } else {
          console.warn(errorMsg);
        }
      } else {
        console.log(`Template "${name}" deleted successfully.`);
      }
    } else {
      console.warn('No DELETE /questionerTemplates API call detected, but continuing check...');
    }

    // Wait for UI to update
    await this.waitForLoading();

    // Wait for the list to refetch
    await this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    // Wait for the item to disappear (avoid hard reloads which can be flaky)
    const stillExists = await rows.count().then(c => c > 0).catch(() => false);
    if (stillExists) {
      // Give the UI a bit more time to refresh (React Query refetch)
      await this.page.waitForTimeout(500);
    }
    const stillExistsAfter = await rows.count().then(c => c > 0).catch(() => false);
    if (stillExistsAfter && throwOnError) {
      throw new Error(`Template "${name}" still visible after deletion`);
    } else if (stillExistsAfter) {
      console.warn(`Template "${name}" still visible after deletion attempt`);
    }
  }

  /**
   * Click activate button for a template
   */
  async activateTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await row.scrollIntoViewIfNeeded();

    // Get current status before clicking
    const statusLabel = row.locator(testIdSelector(TestIds.STATUS_LABEL));
    const statusBefore = (await statusLabel.textContent().catch(() => '')) || '';
    const wasActive = statusBefore.toLowerCase().includes('enabled') || statusBefore.toLowerCase().includes('active');
    console.log(`Template "${name}" status before: "${statusBefore}" (wasActive: ${wasActive})`);

    // Set up response listener for activate API call
    // Set up response listener (could be Activate (PUT) or Deactivate (PUT/DELETE))
    // We broaden the match so we don't miss different endpoints
    const apiPromise = this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && (response.request().method() === 'PUT' || response.request().method() === 'DELETE'),
      { timeout: 15000 }
    ).catch(() => null);

    const activateBtn = row.getByRole('button', { name: /activate|deactivate/i });
    if (await activateBtn.isVisible({ timeout: 2000 })) {
      const text = await activateBtn.textContent();
      console.log(`Clicking activation button: "${text}"`);
      await activateBtn.click({ force: true });
    } else {
      // Fallback to finding the button with the emoji/text
      console.log('Clicking activation button via text fallback');
      await row.locator('text=/activate|🔁/i').first().click({ force: true });
    }

    // Wait for the API call to complete
    const response = await apiPromise;
    let apiSuccess = false;

    if (response) {
      const requestUrl = response.url();
      console.log(`API request URL: ${requestUrl}`);
      if (response.ok()) {
        console.log(`Template "${name}" activation toggled successfully.`);
        apiSuccess = true;
      } else {
        const responseBody = await response.text().catch(() => '');
        console.warn(`Template activation API returned status ${response.status()}: ${responseBody}`);
        // 409 means another template is active - this is an expected business error
        if (response.status() === 409) {
          console.log('409 Conflict: Another template is already active');
        }
      }
    } else {
      console.warn('No PUT /questionerTemplates API call detected');
    }

    await this.waitForLoading();

    // Wait for the list to refetch
    await this.page.waitForResponse(
      response => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    // Wait a bit for the status change to reflect in UI
    await this.page.waitForTimeout(500);

    // Verify status changed - if not, try refreshing the page
    const statusAfter = (await statusLabel.textContent().catch(() => '')) || '';
    console.log(`Template "${name}" status after: "${statusAfter}"`);

    const isNowActive = statusAfter.toLowerCase().includes('enabled') || statusAfter.toLowerCase().includes('active');

    // If API succeeded but status didn't change, refresh the page
    if (wasActive === isNowActive && apiSuccess) {
      console.log('Status did not change after API success, refreshing page...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.waitForLoading();
      const statusAfterRefresh = (await this.getTemplateRow(name).locator(testIdSelector(TestIds.STATUS_LABEL)).textContent().catch(() => '')) || '';
      console.log(`Template "${name}" status after refresh: "${statusAfterRefresh}"`);
    }

    // Return whether the activation was successful (API returned 2xx)
    return apiSuccess;
  }

  /**
   * Check if template is active
   */
  async isTemplateActive(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const statusLabel = row.locator(testIdSelector(TestIds.STATUS_LABEL));
    const statusText = (await statusLabel.textContent().catch(() => '')) || '';

    // Status should be "Active" or "Enabled"
    return statusText.toLowerCase().includes('active') || statusText.toLowerCase().includes('enabled');
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
        console.log(`expectTemplateActive: "${name}" not "${active ? 'active' : 'inactive'}" yet, refetching list (attempt ${attempt})...`);
        await this.refetchTemplatesList();
      }
    }
  }

  /**
   * Get all template names
   */
  async getTemplateNames(): Promise<string[]> {
    await this.waitForLoading();
    const items = this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM));
    // Wait for at least one item if any
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

  /**
   * Deactivate any templates that are currently marked as active/enabled.
   * Useful when a test needs to start from a clean state with no active quizzes.
   */
  async deactivateAllTemplates() {
    await this.waitForLoading();

    // Refresh the page first to ensure we have the latest state
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForLoading();

    const statusSelector = testIdSelector(TestIds.STATUS_LABEL);
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      attempts++;
      const activeRows = this.page.locator(testIdSelector(TestIds.TENANT_LIST_ITEM)).filter({
        has: this.page.locator(statusSelector, { hasText: /active|enabled/i })
      });

      const count = await activeRows.count();
      console.log(`deactivateAllTemplates: Found ${count} active templates (attempt ${attempts})`);

      if (count === 0) {
        break;
      }

      const row = activeRows.first();
      const templateName = await row.locator(testIdSelector(TestIds.HEADING_TEXT)).textContent().catch(() => 'unknown');
      console.log(`Deactivating template: ${templateName}`);

      // Set up response listener
      const apiPromise = this.page.waitForResponse(
        response => response.url().includes('/questionerTemplates') && response.request().method() === 'PUT',
        { timeout: 10000 }
      ).catch(() => null);

      const activateButton = row.getByRole('button', { name: /activate/i }).first();
      if (await activateButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await activateButton.click({ force: true });

        // Wait for API response
        const response = await apiPromise;
        if (response?.ok()) {
          console.log(`Deactivated template: ${templateName}`);
        } else {
          console.warn(`Failed to deactivate template: ${templateName}, status: ${response?.status()}`);
        }

        await this.waitForLoading();

        // Wait for list refresh
        await this.page.waitForResponse(
          response => response.url().includes('/questionerTemplates') && response.request().method() === 'GET',
          { timeout: 5000 }
        ).catch(() => null);

        await this.page.waitForTimeout(300);
      } else {
        console.warn('Active template detected but activate button is not yet visible, refreshing...');
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.waitForLoading();
      }
    }

    if (attempts >= maxAttempts) {
      console.warn(`deactivateAllTemplates: Reached max attempts (${maxAttempts}), some templates may still be active`);
    }
  }
}
