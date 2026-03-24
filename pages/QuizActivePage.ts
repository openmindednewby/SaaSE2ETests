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
    // Use exact match for "Back" to avoid matching "Feedback" sidebar button
    this.backButton = page.getByRole('button', { name: 'Back', exact: true });
    this.submitButton = page.getByRole('button', { name: /submit/i });
    this.loadingIndicator = page.locator('[role="progressbar"]');
    // Progress indicator renders as "Page 1 / 2" (using FM() localization)
    this.progressIndicator = page.getByText(/page\s+\d+\s*[/|of]\s*\d+/i);
    this.thankYouMessage = page.getByText(/thank you/i);
  }

  /**
   * Navigate to active quiz page
   * Expo Router: (protected) is a route group, URL is just /quiz-active
   */
  async goto() {
    await super.goto('/quiz-active');
    await this.waitForLoading();
  }

  /**
   * Check if a quiz is loaded
   */
  async hasActiveQuiz(): Promise<boolean> {
    // React Native Web renders TextInput as <input> and radio options as
    // TouchableOpacity (role="button"). Look for the placeholder text or
    // any input elements to detect a loaded quiz.
    const quizInputs = this.page.getByPlaceholder(/enter your answer/i);
    const questionFields = this.page.locator(
      '[data-testid^="question-"], input, textarea'
    );
    const noQuestionsText = this.page.getByText(/no questions found/i);
    const failedText = this.page.getByText(/failed to load/i);

    // Wait up to 15 seconds for either quiz content or an error/empty state to appear
    try {
      await quizInputs.or(questionFields).or(noQuestionsText).or(failedText).first()
        .waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      // Neither quiz content nor error appeared -- treat as no quiz
      return false;
    }

    if (await noQuestionsText.isVisible({ timeout: 1000 }).catch(() => false)) {
      return false;
    }
    if (await failedText.isVisible({ timeout: 1000 }).catch(() => false)) {
      return false;
    }

    // Check for quiz inputs by placeholder or by element presence
    if (await quizInputs.count() > 0) return true;
    return await questionFields.count() > 0;
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
    try {
      const progressText = await this.progressIndicator.textContent({ timeout: 5000 });
      // Matches "Page 1 / 2" or "Page 1 of 2"
      const match = progressText?.match(/page\s+(\d+)/i);
      return match ? parseInt(match[1], 10) : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Get total pages
   */
  async getTotalPages(): Promise<number> {
    try {
      const progressText = await this.progressIndicator.textContent({ timeout: 5000 });
      // Matches "Page 1 / 2" or "Page 1 of 2"
      const match = progressText?.match(/(\d+)\s*$/);
      return match ? parseInt(match[1], 10) : 1;
    } catch {
      return 1;
    }
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
