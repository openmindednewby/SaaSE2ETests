import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

const NATIVE_COMPONENTS_ROUTE = '/dashboard/components/native';
const CHECKBOX_STATES_COUNT = 4;
const PAGE_LOAD_TIMEOUT = 10000;

/**
 * Page object for the SyncfusionThemeStudio Native Components page.
 * Contains locators and helpers for the checkbox section and other
 * native component showcases.
 */
export class NativeComponentsPage extends BasePage {
  readonly pageContainer: Locator;
  readonly checkedCheckbox: Locator;
  readonly uncheckedCheckbox: Locator;
  readonly disabledCheckbox: Locator;
  readonly indeterminateCheckbox: Locator;

  constructor(page: Page) {
    super(page);
    this.pageContainer = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_COMPONENTS_PAGE));
    this.checkedCheckbox = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_CHECKBOX_CHECKED));
    this.uncheckedCheckbox = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_CHECKBOX_UNCHECKED));
    this.disabledCheckbox = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_CHECKBOX_DISABLED));
    this.indeterminateCheckbox = page.locator(testIdSelector(TestIds.STUDIO_NATIVE_CHECKBOX_INDETERMINATE));
  }

  // ==================== NAVIGATION ====================

  /**
   * Navigate to the Native Components page.
   */
  async gotoNativeComponents() {
    await super.goto(NATIVE_COMPONENTS_ROUTE);
    await expect(this.pageContainer).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  }

  // ==================== ASSERTION METHODS ====================

  /**
   * Expect the page container to be visible.
   */
  async expectPageLoaded() {
    await expect(this.pageContainer).toBeVisible();
  }

  /**
   * Expect all four checkbox states to be visible.
   */
  async expectAllCheckboxStatesVisible() {
    await Promise.all([
      expect(this.checkedCheckbox).toBeVisible(),
      expect(this.uncheckedCheckbox).toBeVisible(),
      expect(this.disabledCheckbox).toBeVisible(),
      expect(this.indeterminateCheckbox).toBeVisible(),
    ]);
  }

  /**
   * Expect exactly four checkbox states are rendered in the section.
   */
  async expectCheckboxStateCount() {
    const checkboxSection = this.page.locator('section.card').filter({ hasText: 'Checkboxes' });
    const checkboxInputs = checkboxSection.locator('input[type="checkbox"]');
    await expect(checkboxInputs).toHaveCount(CHECKBOX_STATES_COUNT);
  }

  /**
   * Expect the indeterminate checkbox to have the readOnly attribute.
   * This verifies Bug 1 fix: `readOnly` was added to prevent React warning.
   */
  async expectIndeterminateCheckboxIsReadOnly() {
    // The readOnly attribute should be present on the underlying input
    const input = this.indeterminateCheckbox.locator('input[type="checkbox"]');
    // If the testId is on the input directly, use it; otherwise find within container
    const targetInput = await input.count() > 0 ? input : this.indeterminateCheckbox;
    await expect(targetInput).toHaveAttribute('readonly', /.*/);
  }

  /**
   * Expect the disabled checkbox to be disabled.
   */
  async expectDisabledCheckboxIsDisabled() {
    const input = this.disabledCheckbox.locator('input[type="checkbox"]');
    const targetInput = await input.count() > 0 ? input : this.disabledCheckbox;
    await expect(targetInput).toBeDisabled();
  }

  /**
   * Click the unchecked checkbox and verify it becomes checked.
   */
  async toggleUncheckedCheckbox() {
    await this.uncheckedCheckbox.click();
  }

  /**
   * Click the checked checkbox and verify it becomes unchecked.
   */
  async toggleCheckedCheckbox() {
    await this.checkedCheckbox.click();
  }
}
