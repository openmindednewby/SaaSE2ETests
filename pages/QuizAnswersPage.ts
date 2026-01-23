import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class QuizAnswersPage extends BasePage {
  readonly pageHeader: Locator;
  readonly searchInput: Locator;
  readonly answersList: Locator;
  readonly loadingIndicator: Locator;
  readonly exportButtons: Locator;

  constructor(page: Page) {
    super(page);
    // Based on quiz-answers/index.tsx
    this.pageHeader = page.getByText(/quiz answers/i);
    this.searchInput = page.getByPlaceholder(/search/i);
    this.answersList = page.locator('[data-testid="answers-list"]');
    this.loadingIndicator = page.locator('[role="progressbar"]');
    this.exportButtons = page.locator('[data-testid="export-buttons"]');
  }

  /**
   * Navigate to quiz answers page
   * Expo Router: (protected) is a route group, URL is just /quiz-answers
   */
  async goto() {
    await super.goto('/quiz-answers');
    await this.waitForLoading();
  }

  /**
   * Search for answers
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    // Wait for list to filter (debounce)
    await this.waitForLoading();
  }

  /**
   * Clear search
   */
  async clearSearch() {
    await this.searchInput.clear();
    await this.waitForLoading();
  }

  /**
   * Get answer row by name
   */
  getAnswerRow(name: string): Locator {
    return this.page.locator(`text="${name}"`).locator('..');
  }

  /**
   * Check if an answer exists in the list
   */
  async answerExists(name: string): Promise<boolean> {
    const answer = this.page.getByText(name, { exact: false });
    return await answer.isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Expect answer to be visible in the list
   */
  async expectAnswerInList(name: string) {
    await expect(this.page.getByText(name)).toBeVisible();
  }

  /**
   * Click view button for an answer
   */
  async viewAnswer(name: string) {
    const row = this.getAnswerRow(name);
    await row.getByRole('button', { name: /view/i }).click();
    // Wait for modal to open
    await expect(this.page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Click edit button for an answer
   */
  async editAnswer(name: string) {
    const row = this.getAnswerRow(name);
    await row.getByRole('button', { name: /edit/i }).click();
  }

  /**
   * Click delete button for an answer
   */
  async deleteAnswer(name: string) {
    const row = this.getAnswerRow(name);
    await row.getByRole('button', { name: /delete/i }).click();

    // Handle confirmation dialog if present
    const confirmButton = this.page.getByRole('button', { name: /confirm|yes|ok/i });
    if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmButton.click();
    }

    await this.waitForLoading();
  }

  /**
   * Close the view/edit modal
   */
  async closeModal() {
    const closeButton = this.page.getByRole('button', { name: /close|cancel/i });
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }
  }

  /**
   * Get count of answers in list
   */
  async getAnswerCount(): Promise<number> {
    await this.waitForLoading();
    const items = this.page.locator('[data-testid="answer-item"], [role="listitem"]');
    return await items.count();
  }

  /**
   * Export answers (if export buttons are available)
   */
  async exportToCsv() {
    const csvButton = this.page.getByRole('button', { name: /csv|export/i });
    if (await csvButton.isVisible()) {
      await csvButton.click();
    }
  }

  /**
   * Check if list is empty
   */
  async isListEmpty(): Promise<boolean> {
    const count = await this.getAnswerCount();
    return count === 0;
  }
}
