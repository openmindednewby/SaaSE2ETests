import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for core Menu Styling functionality.
 * Handles navigation between styling tabs, color scheme, typography, save/cancel.
 *
 * For box style, header, media, category styling, and preview operations,
 * use MenuStylingAdvancedPage.
 */
export class MenuStylingPage extends BasePage {
  // Menu Editor
  readonly menuEditor: Locator;
  readonly menuEditorSaveButton: Locator;
  readonly menuEditorCancelButton: Locator;

  // Global Styling Tabs
  readonly globalStylingTab: Locator;
  readonly layoutTab: Locator;
  readonly colorsTab: Locator;
  readonly typographyTab: Locator;
  readonly mediaTab: Locator;
  readonly headerTab: Locator;
  readonly spacingTab: Locator;

  // Color Scheme Editor
  readonly colorSchemeEditor: Locator;
  readonly colorSchemeResetButton: Locator;

  // Typography Editor
  readonly typographyEditor: Locator;
  readonly typographyFontPicker: Locator;
  readonly typographySizeInput: Locator;
  readonly typographyWeightPicker: Locator;
  readonly typographyPreview: Locator;
  readonly typographyResetButton: Locator;

  // Spacing Editor
  readonly spacingEditor: Locator;

  constructor(page: Page) {
    super(page);

    // Menu Editor
    this.menuEditor = page.locator(testIdSelector(TestIds.MENU_EDITOR));
    this.menuEditorSaveButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_SAVE_BUTTON));
    this.menuEditorCancelButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_CANCEL_BUTTON));

    // Global Styling Tabs
    this.globalStylingTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB));
    this.layoutTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB_LAYOUT));
    this.colorsTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB_COLORS));
    this.typographyTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB_TYPOGRAPHY));
    this.mediaTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB_MEDIA));
    this.headerTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB_HEADER));
    this.spacingTab = page.locator(testIdSelector(TestIds.GLOBAL_STYLING_TAB_SPACING));

    // Color Scheme Editor
    this.colorSchemeEditor = page.locator(testIdSelector(TestIds.COLOR_SCHEME_EDITOR));
    this.colorSchemeResetButton = page.locator(testIdSelector(TestIds.COLOR_SCHEME_RESET_BUTTON));

    // Typography Editor
    this.typographyEditor = page.locator(testIdSelector(TestIds.TYPOGRAPHY_EDITOR));
    this.typographyFontPicker = page.locator(testIdSelector(TestIds.TYPOGRAPHY_FONT_PICKER));
    this.typographySizeInput = page.locator(testIdSelector(TestIds.TYPOGRAPHY_SIZE_INPUT));
    this.typographyWeightPicker = page.locator(testIdSelector(TestIds.TYPOGRAPHY_WEIGHT_PICKER));
    this.typographyPreview = page.locator(testIdSelector(TestIds.TYPOGRAPHY_PREVIEW));
    this.typographyResetButton = page.locator(testIdSelector(TestIds.TYPOGRAPHY_RESET_BUTTON));

    // Spacing Editor
    this.spacingEditor = page.locator(testIdSelector(TestIds.SPACING_EDITOR));
  }

  // ==================== NAVIGATION METHODS ====================

  async switchToStylingTab() {
    const stylingTab = this.menuEditor.getByRole('tab', { name: /styling|style|design/i });
    await stylingTab.click();
    await expect(this.globalStylingTab.or(this.layoutTab).first()).toBeVisible({ timeout: 5000 });
  }

  async switchToLayoutTab() { await this.layoutTab.click(); await this.waitForLoading(); }

  async switchToColorsTab() {
    await this.colorsTab.click();
    await expect(this.colorSchemeEditor).toBeVisible({ timeout: 5000 });
  }

  async switchToTypographyTab() {
    await this.typographyTab.click();
    await expect(this.typographyEditor).toBeVisible({ timeout: 5000 });
  }

  async switchToMediaTab() {
    await this.mediaTab.click();
    const mediaPositionEditor = this.page.locator(testIdSelector(TestIds.MEDIA_POSITION_EDITOR));
    await expect(mediaPositionEditor).toBeVisible({ timeout: 5000 });
  }

  async switchToHeaderTab() {
    await this.headerTab.click();
    const headerEditor = this.page.locator(testIdSelector(TestIds.HEADER_EDITOR));
    await expect(headerEditor).toBeVisible({ timeout: 5000 });
  }

  async switchToSpacingTab() {
    await this.spacingTab.click();
    await expect(this.spacingEditor).toBeVisible({ timeout: 5000 });
  }

  // ==================== COLOR SCHEME METHODS ====================

  getColorInput(colorName: string): Locator {
    return this.colorSchemeEditor.locator(testIdSelector(TestIds.COLOR_SCHEME_INPUT_ROW)).filter({
      hasText: new RegExp(colorName, 'i'),
    }).locator(testIdSelector(TestIds.COLOR_SCHEME_INPUT));
  }

  getColorSwatch(colorName: string): Locator {
    return this.colorSchemeEditor.locator(testIdSelector(TestIds.COLOR_SCHEME_INPUT_ROW)).filter({
      hasText: new RegExp(colorName, 'i'),
    }).locator(testIdSelector(TestIds.COLOR_SCHEME_SWATCH));
  }

  async setColor(colorName: string, hexValue: string) {
    const input = this.getColorInput(colorName);
    await input.clear();
    await input.fill(hexValue);
    await input.blur();
    await this.waitForLoading();
  }

  async getColorValue(colorName: string): Promise<string> {
    return await this.getColorInput(colorName).inputValue();
  }

  async selectColorPreset(presetIndex: number) {
    const presets = this.page.locator(testIdSelector(TestIds.COLOR_SCHEME_PRESET));
    await presets.nth(presetIndex).click();
    await this.waitForLoading();
  }

  async getColorPresetCount(): Promise<number> {
    return await this.page.locator(testIdSelector(TestIds.COLOR_SCHEME_PRESET)).count();
  }

  async resetColors() { await this.colorSchemeResetButton.click(); await this.waitForLoading(); }

  // ==================== TYPOGRAPHY METHODS ====================

  getTypographySection(sectionName: string): Locator {
    return this.typographyEditor.locator(testIdSelector(TestIds.TYPOGRAPHY_SECTION)).filter({
      hasText: new RegExp(sectionName, 'i'),
    });
  }

  async selectFont(sectionName: string, fontName: string) {
    const section = this.getTypographySection(sectionName);
    const fontPicker = section.locator(testIdSelector(TestIds.TYPOGRAPHY_FONT_PICKER));
    await fontPicker.click();
    await this.page.getByRole('option', { name: new RegExp(fontName, 'i') }).click();
    await this.waitForLoading();
  }

  async setFontSize(sectionName: string, size: string) {
    const section = this.getTypographySection(sectionName);
    const sizeInput = section.locator(testIdSelector(TestIds.TYPOGRAPHY_SIZE_INPUT));
    await sizeInput.clear();
    await sizeInput.fill(size);
    await sizeInput.blur();
    await this.waitForLoading();
  }

  async getFontSize(sectionName: string): Promise<string> {
    const section = this.getTypographySection(sectionName);
    return await section.locator(testIdSelector(TestIds.TYPOGRAPHY_SIZE_INPUT)).inputValue();
  }

  async selectFontWeight(sectionName: string, weight: string) {
    const section = this.getTypographySection(sectionName);
    const weightPicker = section.locator(testIdSelector(TestIds.TYPOGRAPHY_WEIGHT_PICKER));
    await weightPicker.click();
    await this.page.getByRole('option', { name: new RegExp(weight, 'i') }).click();
    await this.waitForLoading();
  }

  async resetTypography() { await this.typographyResetButton.click(); await this.waitForLoading(); }

  // ==================== SAVE/CANCEL METHODS ====================

  async saveStyling() {
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'PUT',
      { timeout: 15000 }
    ).catch(() => null);
    await this.menuEditorSaveButton.click();
    await responsePromise;
    await this.waitForLoading();
  }

  async cancelStyling() {
    await this.menuEditorCancelButton.click();
    await expect(this.menuEditor).not.toBeVisible({ timeout: 5000 });
  }
}
