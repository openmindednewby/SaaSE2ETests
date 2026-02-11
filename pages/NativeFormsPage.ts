import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for the Native Forms Showcase page.
 * Handles interactions with form fields, combobox dropdowns,
 * validation assertions, and theme toggling.
 */
export class NativeFormsPage extends BasePage {
  // Page container
  readonly pageContainer: Locator;

  // Login form
  readonly loginEmailInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginPasswordToggle: Locator;
  readonly loginRememberCheckbox: Locator;
  readonly loginSubmitButton: Locator;

  // Registration form
  readonly registerNameInput: Locator;
  readonly registerEmailInput: Locator;
  readonly registerPasswordInput: Locator;
  readonly registerConfirmPasswordInput: Locator;
  readonly registerSubmitButton: Locator;

  // Contact form
  readonly contactNameInput: Locator;
  readonly contactEmailInput: Locator;
  readonly contactSubjectCombobox: Locator;
  readonly contactMessageTextarea: Locator;
  readonly contactSubmitButton: Locator;

  // Newsletter form
  readonly newsletterEmailInput: Locator;
  readonly newsletterSubmitButton: Locator;

  // Combobox dropdown elements (scoped to page)
  readonly comboboxDropdown: Locator;
  readonly comboboxOptions: Locator;
  readonly comboboxNoResults: Locator;

  // Error messages
  readonly errorMessages: Locator;

  constructor(page: Page) {
    super(page);

    // Page container
    this.pageContainer = page.locator(testIdSelector(TestIds.NATIVE_FORMS_PAGE));

    // Login form locators
    this.loginEmailInput = page.locator(testIdSelector(TestIds.SHOWCASE_LOGIN_EMAIL));
    this.loginPasswordInput = page.locator(testIdSelector(TestIds.SHOWCASE_LOGIN_PASSWORD));
    this.loginPasswordToggle = page.locator(testIdSelector(TestIds.SHOWCASE_LOGIN_PASSWORD_TOGGLE));
    this.loginRememberCheckbox = page.locator(testIdSelector(TestIds.SHOWCASE_LOGIN_REMEMBER));
    this.loginSubmitButton = page.locator(testIdSelector(TestIds.SHOWCASE_LOGIN_SUBMIT));

    // Registration form locators
    this.registerNameInput = page.locator(testIdSelector(TestIds.SHOWCASE_REGISTER_NAME));
    this.registerEmailInput = page.locator(testIdSelector(TestIds.SHOWCASE_REGISTER_EMAIL));
    this.registerPasswordInput = page.locator(testIdSelector(TestIds.SHOWCASE_REGISTER_PASSWORD));
    this.registerConfirmPasswordInput = page.locator(testIdSelector(TestIds.SHOWCASE_REGISTER_CONFIRM_PASSWORD));
    this.registerSubmitButton = page.locator(testIdSelector(TestIds.SHOWCASE_REGISTER_SUBMIT));

    // Contact form locators
    this.contactNameInput = page.locator(testIdSelector(TestIds.SHOWCASE_CONTACT_NAME));
    this.contactEmailInput = page.locator(testIdSelector(TestIds.SHOWCASE_CONTACT_EMAIL));
    this.contactSubjectCombobox = page.locator(testIdSelector(TestIds.SHOWCASE_CONTACT_SUBJECT));
    this.contactMessageTextarea = page.locator(testIdSelector(TestIds.SHOWCASE_CONTACT_MESSAGE));
    this.contactSubmitButton = page.locator(testIdSelector(TestIds.SHOWCASE_CONTACT_SUBMIT));

    // Newsletter form locators
    this.newsletterEmailInput = page.locator(testIdSelector(TestIds.SHOWCASE_NEWSLETTER_EMAIL));
    this.newsletterSubmitButton = page.locator(testIdSelector(TestIds.SHOWCASE_NEWSLETTER_SUBMIT));

    // Combobox dropdown elements
    this.comboboxDropdown = page.locator('.form-native-combobox-dropdown');
    this.comboboxOptions = page.locator('.form-native-combobox-option');
    this.comboboxNoResults = page.locator('.form-native-combobox-no-results');

    // Error messages
    this.errorMessages = page.locator('.form-native-error');
  }

  // ==================== NAVIGATION ====================

  /**
   * Navigate to the Native Forms Showcase page.
   */
  async gotoNativeForms() {
    await super.goto('/showcase/native-forms');
    await expect(this.pageContainer).toBeVisible({ timeout: 10000 });
  }

  // ==================== COMBOBOX INTERACTION METHODS ====================

  /**
   * Type text into the contact subject combobox to filter options.
   */
  async typeInSubjectCombobox(text: string) {
    await this.contactSubjectCombobox.click();
    await this.contactSubjectCombobox.fill(text);
  }

  /**
   * Open the subject combobox dropdown by focusing the input.
   */
  async openSubjectDropdown() {
    await this.contactSubjectCombobox.click();
  }

  /**
   * Select a combobox option by its visible label text.
   */
  async selectComboboxOption(label: string) {
    const option = this.page.locator('.form-native-combobox-option').filter({
      hasText: new RegExp(`^${label}$`, 'i'),
    });
    await option.click();
  }

  /**
   * Use keyboard navigation to select an option in the combobox.
   * Presses ArrowDown the specified number of times, then Enter.
   */
  async selectComboboxOptionByKeyboard(arrowDownCount: number) {
    for (let i = 0; i < arrowDownCount; i++) {
      await this.contactSubjectCombobox.press('ArrowDown');
    }
    await this.contactSubjectCombobox.press('Enter');
  }

  /**
   * Press Escape to close the combobox dropdown.
   */
  async closeComboboxWithEscape() {
    await this.contactSubjectCombobox.press('Escape');
  }

  /**
   * Click outside the combobox to close the dropdown.
   */
  async closeComboboxByClickingOutside() {
    // Click on the page title which is always outside the combobox
    await this.page.locator('.showcase-page__title').click();
  }

  // ==================== FORM SUBMISSION METHODS ====================

  /**
   * Submit the login form.
   */
  async submitLoginForm() {
    await this.loginSubmitButton.click();
  }

  /**
   * Submit the registration form.
   */
  async submitRegistrationForm() {
    await this.registerSubmitButton.click();
  }

  /**
   * Submit the contact form.
   */
  async submitContactForm() {
    await this.contactSubmitButton.click();
  }

  /**
   * Submit the newsletter form.
   */
  async submitNewsletterForm() {
    await this.newsletterSubmitButton.click();
  }

  /**
   * Fill the login form with valid data.
   */
  async fillLoginForm(email: string, password: string) {
    await this.loginEmailInput.fill(email);
    await this.loginPasswordInput.fill(password);
  }

  /**
   * Fill the registration form with valid data.
   */
  async fillRegistrationForm(name: string, email: string, password: string, confirmPassword: string) {
    await this.registerNameInput.fill(name);
    await this.registerEmailInput.fill(email);
    await this.registerPasswordInput.fill(password);
    await this.registerConfirmPasswordInput.fill(confirmPassword);
  }

  /**
   * Fill the contact form with valid data (excluding subject combobox).
   */
  async fillContactFormFields(name: string, email: string, message: string) {
    await this.contactNameInput.fill(name);
    await this.contactEmailInput.fill(email);
    await this.contactMessageTextarea.fill(message);
  }

  // ==================== ASSERTION METHODS ====================

  /**
   * Expect the page to be visible and loaded.
   */
  async expectPageLoaded() {
    await expect(this.pageContainer).toBeVisible();
    await expect(this.page.locator('.showcase-page__title')).toBeVisible();
  }

  /**
   * Expect all four form cards to be visible.
   */
  async expectAllFormsVisible() {
    await Promise.all([
      expect(this.loginSubmitButton).toBeVisible(),
      expect(this.registerSubmitButton).toBeVisible(),
      expect(this.contactSubmitButton).toBeVisible(),
      expect(this.newsletterSubmitButton).toBeVisible(),
    ]);
  }

  /**
   * Expect the combobox dropdown to be visible.
   */
  async expectDropdownVisible() {
    await expect(this.comboboxDropdown).toBeVisible();
  }

  /**
   * Expect the combobox dropdown to not be visible.
   */
  async expectDropdownHidden() {
    await expect(this.comboboxDropdown).not.toBeVisible();
  }

  /**
   * Expect the combobox to show a specific number of filtered options.
   */
  async expectComboboxOptionCount(count: number) {
    await expect(this.comboboxOptions).toHaveCount(count);
  }

  /**
   * Expect the "No results found" message in the combobox dropdown.
   */
  async expectNoResultsMessage() {
    await expect(this.comboboxNoResults).toBeVisible();
  }

  /**
   * Expect the combobox input to show the selected value label.
   */
  async expectComboboxValue(label: string) {
    await expect(this.contactSubjectCombobox).toHaveValue(label);
  }

  /**
   * Expect error messages to be visible on the page.
   */
  async expectErrorsVisible(minCount: number = 1) {
    const errorCount = await this.errorMessages.count();
    expect(errorCount, `Expected at least ${minCount} error(s)`).toBeGreaterThanOrEqual(minCount);
  }

  /**
   * Expect no error messages visible on the page within a specific form.
   */
  async expectNoErrorsInForm(formLocator: Locator) {
    const errors = formLocator.locator('.form-native-error');
    await expect(errors).toHaveCount(0);
  }

  /**
   * Expect a specific error message text to be visible.
   */
  async expectErrorMessage(message: string) {
    const error = this.page.locator('.form-native-error').filter({ hasText: message });
    await expect(error).toBeVisible();
  }

  /**
   * Expect a specific error message text to not be visible.
   */
  async expectErrorMessageGone(message: string) {
    const error = this.page.locator('.form-native-error').filter({ hasText: message });
    await expect(error).not.toBeVisible();
  }

  /**
   * Get the number of currently visible error messages.
   */
  async getVisibleErrorCount(): Promise<number> {
    return await this.errorMessages.count();
  }

  /**
   * Expect the focused element to match a given testId.
   */
  async expectFocusedElement(testId: string) {
    const focusedTestId = await this.page.evaluate(() => {
      return document.activeElement?.getAttribute('data-testid') ?? '';
    });
    expect(focusedTestId, `Expected focused element to have testId "${testId}"`).toBe(testId);
  }

  // ==================== FORM CARD LOCATOR HELPERS ====================

  /**
   * Get the form card locator containing the login form.
   */
  getLoginFormCard(): Locator {
    return this.page.locator('.form-card').filter({ hasText: 'Login' });
  }

  /**
   * Get the form card locator containing the registration form.
   */
  getRegistrationFormCard(): Locator {
    return this.page.locator('.form-card').filter({ hasText: 'Create Account' });
  }

  /**
   * Get the form card locator containing the contact form.
   */
  getContactFormCard(): Locator {
    return this.page.locator('.form-card').filter({ hasText: 'Contact Us' });
  }

  /**
   * Get the form card locator containing the newsletter form.
   */
  getNewsletterFormCard(): Locator {
    return this.page.locator('.form-card').filter({ hasText: 'Newsletter' });
  }
}
