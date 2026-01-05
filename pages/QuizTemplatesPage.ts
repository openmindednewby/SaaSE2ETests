import { Page, Locator, expect } from '@playwright/test';
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
    this.templateNameInput = page.getByPlaceholder(/name/i).first();
    this.templateDescriptionInput = page.getByPlaceholder(/description/i).first();
    this.saveButton = page.getByRole('button', { name: /save/i }).first();
    this.templateList = page.locator('[data-testid="template-list"]');
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to quiz templates page
   */
  async goto() {
    await super.goto('/(protected)/quiz-templates');
    await this.waitForLoading();
  }

  /**
   * Create a new template
   */
  async createTemplate(name: string, description: string = '') {
    await this.templateNameInput.fill(name);
    if (description) {
      await this.templateDescriptionInput.fill(description);
    }
    await this.saveButton.click();
    await this.waitForLoading();
  }

  /**
   * Get template row by name
   */
  getTemplateRow(name: string): Locator {
    return this.page.locator(`text="${name}"`).locator('..');
  }

  /**
   * Check if a template exists in the list
   */
  async templateExists(name: string): Promise<boolean> {
    const template = this.page.getByText(name, { exact: false });
    return await template.isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Expect template to be visible in the list
   */
  async expectTemplateInList(name: string) {
    await expect(this.page.getByText(name)).toBeVisible();
  }

  /**
   * Click edit button for a template
   */
  async editTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await row.getByRole('button', { name: /edit/i }).click();
  }

  /**
   * Click delete button for a template
   */
  async deleteTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await row.getByRole('button', { name: /delete/i }).click();

    // Handle confirmation dialog if present
    const confirmButton = this.page.getByRole('button', { name: /confirm|yes|ok/i });
    if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmButton.click();
    }

    await this.waitForLoading();
  }

  /**
   * Click activate button for a template
   */
  async activateTemplate(name: string) {
    const row = this.getTemplateRow(name);
    await row.getByRole('button', { name: /activate/i }).click();
    await this.waitForLoading();
  }

  /**
   * Check if template is active
   */
  async isTemplateActive(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const activeIndicator = row.getByText(/active/i);
    return await activeIndicator.isVisible();
  }

  /**
   * Get all template names
   */
  async getTemplateNames(): Promise<string[]> {
    await this.waitForLoading();
    const items = this.page.locator('[data-testid="template-item"], [role="listitem"]');
    const count = await items.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text) names.push(text.trim());
    }
    return names;
  }
}
