import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

const PAGE_LOAD_TIMEOUT = 15000;
const TOAST_TIMEOUT = 10000;

/**
 * Page object for the BaseClient Theme Settings page (/settings/theme).
 * Handles preset selection, color swatch verification, mode toggling,
 * reset flow, and theme preview assertions.
 */
export class ThemeSettingsAppPage extends BasePage {
  readonly screen: Locator;
  readonly loadingIndicator: Locator;
  readonly swatchPrimary: Locator;
  readonly swatchSecondary: Locator;
  readonly swatchAccent: Locator;
  readonly logoPreview: Locator;
  readonly modeLightButton: Locator;
  readonly modeDarkButton: Locator;
  readonly customizeButton: Locator;
  readonly resetButton: Locator;
  readonly livePreview: Locator;
  readonly confirmButton: Locator;
  readonly cancelConfirmButton: Locator;
  readonly confirmDialog: Locator;
  readonly successToast: Locator;

  constructor(page: Page) {
    super(page);
    this.screen = page.locator(testIdSelector(TestIds.THEME_SETTINGS_SCREEN));
    this.loadingIndicator = page.locator(testIdSelector(TestIds.THEME_SETTINGS_LOADING));
    this.swatchPrimary = page.locator(testIdSelector(TestIds.THEME_SWATCH_PRIMARY));
    this.swatchSecondary = page.locator(testIdSelector(TestIds.THEME_SWATCH_SECONDARY));
    this.swatchAccent = page.locator(testIdSelector(TestIds.THEME_SWATCH_ACCENT));
    this.logoPreview = page.locator(testIdSelector(TestIds.THEME_LOGO_PREVIEW));
    this.modeLightButton = page.locator(testIdSelector(TestIds.THEME_MODE_LIGHT));
    this.modeDarkButton = page.locator(testIdSelector(TestIds.THEME_MODE_DARK));
    this.customizeButton = page.locator(testIdSelector(TestIds.THEME_CUSTOMIZE_BUTTON));
    this.resetButton = page.locator(testIdSelector(TestIds.THEME_RESET_BUTTON));
    this.livePreview = page.locator(testIdSelector(TestIds.THEME_LIVE_PREVIEW));
    this.confirmButton = page.locator(testIdSelector(TestIds.CONFIRM_BUTTON));
    this.cancelConfirmButton = page.locator(testIdSelector(TestIds.CANCEL_CONFIRM_BUTTON));
    this.confirmDialog = page.locator(testIdSelector(TestIds.CONFIRM_DIALOG));
    this.successToast = page.locator(testIdSelector(TestIds.NOTIFICATION_TOAST));
  }

  // ==================== NAVIGATION ====================

  async goto() {
    await super.goto('/settings/theme');
  }

  async expectPageLoaded() {
    await expect(this.screen).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  }

  async expectLoadingVisible() {
    await expect(this.loadingIndicator).toBeVisible();
  }

  // ==================== ACTIONS ====================

  async selectPreset(presetId: string) {
    const presetCard = this.page.locator(`[data-testid="theme-preset-${presetId}"]`);
    await presetCard.click();
  }

  async clickLightMode() {
    await this.modeLightButton.click();
  }

  async clickDarkMode() {
    await this.modeDarkButton.click();
  }

  async clickCustomize() {
    await this.customizeButton.click();
  }

  async clickReset() {
    await this.resetButton.click();
  }

  async confirmReset() {
    await expect(this.confirmButton).toBeVisible();
    await this.confirmButton.click();
  }

  async cancelReset() {
    await expect(this.cancelConfirmButton).toBeVisible();
    await this.cancelConfirmButton.click();
  }

  // ==================== ASSERTIONS ====================

  async expectColorSwatchesVisible() {
    await Promise.all([
      expect(this.swatchPrimary).toBeVisible(),
      expect(this.swatchSecondary).toBeVisible(),
      expect(this.swatchAccent).toBeVisible(),
    ]);
  }

  async expectLivePreviewVisible() {
    await expect(this.livePreview).toBeVisible();
  }

  async expectResetDialogVisible() {
    await expect(this.confirmDialog).toBeVisible();
  }

  async expectResetDialogNotVisible() {
    await expect(this.confirmDialog).not.toBeVisible();
  }

  async expectSaveSuccess() {
    await expect(this.successToast).toBeVisible({ timeout: TOAST_TIMEOUT });
  }

  async expectModeLightActive() {
    await expect(this.modeLightButton).toBeVisible();
  }

  async expectModeDarkActive() {
    await expect(this.modeDarkButton).toBeVisible();
  }

  /**
   * Get the background color of a specific swatch element.
   */
  async getSwatchColor(swatch: Locator): Promise<string> {
    return await swatch.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
  }

  /**
   * Get the preset cards available on the page.
   */
  get presetCards(): Locator {
    return this.page.locator('[data-testid^="theme-preset-"]');
  }

  /**
   * Get count of preset cards rendered.
   */
  async getPresetCardCount(): Promise<number> {
    return await this.presetCards.count();
  }

  /**
   * Check if a specific preset card is selected (has selected state).
   */
  async isPresetSelected(presetId: string): Promise<boolean> {
    const presetCard = this.page.locator(`[data-testid="theme-preset-${presetId}"]`);
    const accessibilityState = await presetCard.getAttribute('aria-selected');
    return accessibilityState === 'true';
  }

  /**
   * Expect admin controls to be visible (preset grid, customize, reset buttons).
   */
  async expectAdminControlsVisible() {
    await Promise.all([
      expect(this.resetButton).toBeVisible(),
      expect(this.customizeButton).toBeVisible(),
      expect(this.presetCards.first()).toBeVisible(),
    ]);
  }

  /**
   * Expect admin controls to NOT be visible (for non-admin users).
   */
  async expectAdminControlsNotVisible() {
    await Promise.all([
      expect(this.resetButton).not.toBeVisible(),
      expect(this.customizeButton).not.toBeVisible(),
    ]);
  }
}
