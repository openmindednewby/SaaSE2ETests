import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class QuizActivePage extends BasePage {
  readonly pageHeader: Locator;
  readonly quizTitle: Locator;
  readonly quizDescription: Locator;
  readonly nextButton: Locator;
  readonly backButton: Locator;
  readonly submitButton: Locator;
  readonly loadingIndicator: Locator;
  readonly progressIndicator: Locator;
  readonly thankYouMessage: Locator;

  constructor(page: Page) {
    super(page);
    // Based on quiz-active/index.tsx
    this.pageHeader = page.getByText(/active quiz/i);
    this.quizTitle = page.locator('[data-testid="quiz-title"]');
    this.quizDescription = page.locator('[data-testid="quiz-description"]');
    this.nextButton = page.getByRole('button', { name: /next/i });
    this.backButton = page.getByRole('button', { name: /back|previous/i });
    this.submitButton = page.getByRole('button', { name: /submit/i });
    this.loadingIndicator = page.locator('[role="progressbar"]');
    this.progressIndicator = page.getByText(/page \d+ of \d+/i);
    this.thankYouMessage = page.getByText(/thank you/i);
  }

  /**
   * Navigate to active quiz page
   */
  async goto() {
    await super.goto('/(protected)/quiz-active');
    await this.waitForLoading();
  }

  /**
   * Check if a quiz is loaded
   */
  async hasActiveQuiz(): Promise<boolean> {
    const noQuestionsText = this.page.getByText(/no questions found/i);
    const failedText = this.page.getByText(/failed to load/i);

    if (await noQuestionsText.isVisible({ timeout: 2000 }).catch(() => false)) {
      return false;
    }
    if (await failedText.isVisible({ timeout: 2000 }).catch(() => false)) {
      return false;
    }

    // Check if there are any question fields
    const questions = this.page.locator('[data-testid^="question-"]');
    return await questions.count() > 0;
  }

  /**
   * Fill a text input question
   */
  async fillTextQuestion(questionId: string, value: string) {
    const input = this.page.locator(`[data-testid="question-${questionId}"] input, [data-testid="question-${questionId}"] textarea`);
    await input.fill(value);
  }

  /**
   * Fill a text input by placeholder or label
   */
  async fillTextByLabel(labelPattern: RegExp, value: string) {
    const input = this.page.getByPlaceholder(labelPattern);
    if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      await input.fill(value);
      return;
    }
    // Try by label
    const labeledInput = this.page.getByLabel(labelPattern);
    await labeledInput.fill(value);
  }

  /**
   * Select a radio option
   */
  async selectRadioOption(optionLabel: string) {
    await this.page.getByRole('radio', { name: optionLabel }).click();
  }

  /**
   * Select a dropdown option
   */
  async selectDropdownOption(dropdownLabel: string, optionValue: string) {
    const dropdown = this.page.getByLabel(dropdownLabel);
    await dropdown.selectOption(optionValue);
  }

  /**
   * Check a checkbox option
   */
  async checkOption(optionLabel: string) {
    await this.page.getByRole('checkbox', { name: optionLabel }).check();
  }

  /**
   * Click next button
   */
  async clickNext() {
    await this.nextButton.click();
  }

  /**
   * Click back button
   */
  async clickBack() {
    await this.backButton.click();
  }

  /**
   * Submit the quiz
   */
  async submitQuiz() {
    // On the last page, the next button becomes submit
    const submitBtn = this.page.getByRole('button', { name: /submit/i });
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    } else {
      await this.nextButton.click();
    }
  }

  /**
   * Wait for thank you message after submission
   */
  async expectThankYouMessage() {
    await expect(this.thankYouMessage).toBeVisible({ timeout: 10000 });
  }

  /**
   * Get current page number
   */
  async getCurrentPage(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/page (\d+)/i);
    return match ? parseInt(match[1], 10) : 1;
  }

  /**
   * Get total pages
   */
  async getTotalPages(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/of (\d+)/i);
    return match ? parseInt(match[1], 10) : 1;
  }

  /**
   * Check if on last page
   */
  async isLastPage(): Promise<boolean> {
    return await this.submitButton.isVisible();
  }

  /**
   * Get all visible question labels
   */
  async getVisibleQuestionLabels(): Promise<string[]> {
    const labels = this.page.locator('[data-testid^="question-"] label, [data-testid^="question-"] [role="heading"]');
    const count = await labels.count();
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await labels.nth(i).textContent();
      if (text) result.push(text.trim());
    }
    return result;
  }

  /**
   * Check for validation error
   */
  async hasValidationError(): Promise<boolean> {
    const errorText = this.page.getByText(/required|error/i);
    return await errorText.isVisible({ timeout: 2000 }).catch(() => false);
  }
}
