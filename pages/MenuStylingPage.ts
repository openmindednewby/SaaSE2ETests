import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for Menu Styling functionality.
 * Handles interactions with the styling tabs and editors in the menu editor.
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

  // Box Style Editor
  readonly boxStyleEditor: Locator;
  readonly boxStylePreview: Locator;
  readonly boxStyleShadowToggle: Locator;

  // Header Editor
  readonly headerEditor: Locator;
  readonly headerEditorPreview: Locator;
  readonly showLogoToggle: Locator;
  readonly showMenuNameToggle: Locator;
  readonly showMenuDescriptionToggle: Locator;

  // Media Position Editor
  readonly mediaPositionEditor: Locator;
  readonly mediaPreview: Locator;
  readonly mediaShowToggle: Locator;

  // Spacing Editor
  readonly spacingEditor: Locator;

  // Category Styling
  readonly categoryStylingSection: Locator;
  readonly categoryStylingToggle: Locator;
  readonly categoryStylingContent: Locator;
  readonly categoryStylingBoxEditor: Locator;
  readonly categoryStylingMediaEditor: Locator;

  // Item Styling
  readonly itemStylingSection: Locator;
  readonly itemStylingContent: Locator;

  // Live Preview
  readonly livePreviewPanel: Locator;
  readonly menuContentView: Locator;
  readonly menuContentViewTitle: Locator;
  readonly menuContentViewCategories: Locator;

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

    // Box Style Editor
    this.boxStyleEditor = page.locator(testIdSelector(TestIds.BOX_STYLE_EDITOR));
    this.boxStylePreview = page.locator(testIdSelector(TestIds.BOX_STYLE_PREVIEW));
    this.boxStyleShadowToggle = page.locator(testIdSelector(TestIds.BOX_STYLE_SHADOW_TOGGLE));

    // Header Editor
    this.headerEditor = page.locator(testIdSelector(TestIds.HEADER_EDITOR));
    this.headerEditorPreview = page.locator(testIdSelector(TestIds.HEADER_EDITOR_PREVIEW));
    this.showLogoToggle = page.locator(testIdSelector(TestIds.HEADER_EDITOR_SHOW_LOGO_TOGGLE));
    this.showMenuNameToggle = page.locator(testIdSelector(TestIds.HEADER_EDITOR_SHOW_MENU_NAME_TOGGLE));
    this.showMenuDescriptionToggle = page.locator(testIdSelector(TestIds.HEADER_EDITOR_SHOW_MENU_DESCRIPTION_TOGGLE));

    // Media Position Editor
    this.mediaPositionEditor = page.locator(testIdSelector(TestIds.MEDIA_POSITION_EDITOR));
    this.mediaPreview = page.locator(testIdSelector(TestIds.MEDIA_PREVIEW));
    this.mediaShowToggle = page.locator(testIdSelector(TestIds.MEDIA_SHOW_TOGGLE));

    // Spacing Editor
    this.spacingEditor = page.locator(testIdSelector(TestIds.SPACING_EDITOR));

    // Category Styling
    this.categoryStylingSection = page.locator(testIdSelector(TestIds.CATEGORY_STYLING_SECTION));
    this.categoryStylingToggle = page.locator(testIdSelector(TestIds.CATEGORY_STYLING_TOGGLE));
    this.categoryStylingContent = page.locator(testIdSelector(TestIds.CATEGORY_STYLING_CONTENT));
    this.categoryStylingBoxEditor = page.locator(testIdSelector(TestIds.CATEGORY_STYLING_BOX_EDITOR));
    this.categoryStylingMediaEditor = page.locator(testIdSelector(TestIds.CATEGORY_STYLING_MEDIA_EDITOR));

    // Item Styling
    this.itemStylingSection = page.locator(testIdSelector(TestIds.ITEM_STYLING_SECTION));
    this.itemStylingContent = page.locator(testIdSelector(TestIds.ITEM_STYLING_CONTENT));

    // Live Preview
    this.livePreviewPanel = page.locator(testIdSelector(TestIds.LIVE_PREVIEW_PANEL));
    this.menuContentView = page.locator(testIdSelector(TestIds.MENU_CONTENT_VIEW));
    this.menuContentViewTitle = page.locator(testIdSelector(TestIds.MENU_CONTENT_VIEW_TITLE));
    this.menuContentViewCategories = page.locator(testIdSelector(TestIds.MENU_CONTENT_VIEW_CATEGORIES));
  }

  // ==================== NAVIGATION METHODS ====================

  /**
   * Switch to the Styling tab in the menu editor.
   */
  async switchToStylingTab() {
    const stylingTab = this.menuEditor.getByRole('tab', { name: /styling|style|design/i });
    await stylingTab.click();
    await expect(this.globalStylingTab.or(this.layoutTab).first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Switch to the Layout sub-tab within styling.
   */
  async switchToLayoutTab() {
    await this.layoutTab.click();
    await this.waitForLoading();
  }

  /**
   * Switch to the Colors sub-tab within styling.
   */
  async switchToColorsTab() {
    await this.colorsTab.click();
    await expect(this.colorSchemeEditor).toBeVisible({ timeout: 5000 });
  }

  /**
   * Switch to the Typography sub-tab within styling.
   */
  async switchToTypographyTab() {
    await this.typographyTab.click();
    await expect(this.typographyEditor).toBeVisible({ timeout: 5000 });
  }

  /**
   * Switch to the Media sub-tab within styling.
   */
  async switchToMediaTab() {
    await this.mediaTab.click();
    await expect(this.mediaPositionEditor).toBeVisible({ timeout: 5000 });
  }

  /**
   * Switch to the Header sub-tab within styling.
   */
  async switchToHeaderTab() {
    await this.headerTab.click();
    await expect(this.headerEditor).toBeVisible({ timeout: 5000 });
  }

  /**
   * Switch to the Spacing sub-tab within styling.
   */
  async switchToSpacingTab() {
    await this.spacingTab.click();
    await expect(this.spacingEditor).toBeVisible({ timeout: 5000 });
  }

  // ==================== COLOR SCHEME METHODS ====================

  /**
   * Get a color input by its label/name.
   */
  getColorInput(colorName: string): Locator {
    return this.colorSchemeEditor.locator(testIdSelector(TestIds.COLOR_SCHEME_INPUT_ROW)).filter({
      hasText: new RegExp(colorName, 'i'),
    }).locator(testIdSelector(TestIds.COLOR_SCHEME_INPUT));
  }

  /**
   * Get a color swatch by its label/name.
   */
  getColorSwatch(colorName: string): Locator {
    return this.colorSchemeEditor.locator(testIdSelector(TestIds.COLOR_SCHEME_INPUT_ROW)).filter({
      hasText: new RegExp(colorName, 'i'),
    }).locator(testIdSelector(TestIds.COLOR_SCHEME_SWATCH));
  }

  /**
   * Set a color value by typing in the input field.
   */
  async setColor(colorName: string, hexValue: string) {
    const input = this.getColorInput(colorName);
    await input.clear();
    await input.fill(hexValue);
    // Blur to trigger change
    await input.blur();
    await this.waitForLoading();
  }

  /**
   * Get the current color value from an input.
   */
  async getColorValue(colorName: string): Promise<string> {
    const input = this.getColorInput(colorName);
    return await input.inputValue();
  }

  /**
   * Click a color scheme preset button.
   */
  async selectColorPreset(presetIndex: number) {
    const presets = this.page.locator(testIdSelector(TestIds.COLOR_SCHEME_PRESET));
    await presets.nth(presetIndex).click();
    await this.waitForLoading();
  }

  /**
   * Get the count of available color presets.
   */
  async getColorPresetCount(): Promise<number> {
    const presets = this.page.locator(testIdSelector(TestIds.COLOR_SCHEME_PRESET));
    return await presets.count();
  }

  /**
   * Reset colors to default.
   */
  async resetColors() {
    await this.colorSchemeResetButton.click();
    await this.waitForLoading();
  }

  // ==================== TYPOGRAPHY METHODS ====================

  /**
   * Get the typography section for a specific text type.
   */
  getTypographySection(sectionName: string): Locator {
    return this.typographyEditor.locator(testIdSelector(TestIds.TYPOGRAPHY_SECTION)).filter({
      hasText: new RegExp(sectionName, 'i'),
    });
  }

  /**
   * Select a font from the font picker in a section.
   */
  async selectFont(sectionName: string, fontName: string) {
    const section = this.getTypographySection(sectionName);
    const fontPicker = section.locator(testIdSelector(TestIds.TYPOGRAPHY_FONT_PICKER));
    await fontPicker.click();
    // Select font from dropdown
    await this.page.getByRole('option', { name: new RegExp(fontName, 'i') }).click();
    await this.waitForLoading();
  }

  /**
   * Set font size in a typography section.
   */
  async setFontSize(sectionName: string, size: string) {
    const section = this.getTypographySection(sectionName);
    const sizeInput = section.locator(testIdSelector(TestIds.TYPOGRAPHY_SIZE_INPUT));
    await sizeInput.clear();
    await sizeInput.fill(size);
    await sizeInput.blur();
    await this.waitForLoading();
  }

  /**
   * Get current font size from a typography section.
   */
  async getFontSize(sectionName: string): Promise<string> {
    const section = this.getTypographySection(sectionName);
    const sizeInput = section.locator(testIdSelector(TestIds.TYPOGRAPHY_SIZE_INPUT));
    return await sizeInput.inputValue();
  }

  /**
   * Select font weight in a typography section.
   */
  async selectFontWeight(sectionName: string, weight: string) {
    const section = this.getTypographySection(sectionName);
    const weightPicker = section.locator(testIdSelector(TestIds.TYPOGRAPHY_WEIGHT_PICKER));
    await weightPicker.click();
    await this.page.getByRole('option', { name: new RegExp(weight, 'i') }).click();
    await this.waitForLoading();
  }

  /**
   * Reset typography to default.
   */
  async resetTypography() {
    await this.typographyResetButton.click();
    await this.waitForLoading();
  }

  // ==================== BOX STYLE METHODS ====================

  /**
   * Set background color in box style editor.
   */
  async setBoxBackgroundColor(hexValue: string) {
    const input = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BACKGROUND_COLOR_INPUT));
    await input.clear();
    await input.fill(hexValue);
    await input.blur();
    await this.waitForLoading();
  }

  /**
   * Get current background color from box style editor.
   */
  async getBoxBackgroundColor(): Promise<string> {
    const input = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BACKGROUND_COLOR_INPUT));
    return await input.inputValue();
  }

  /**
   * Set border color in box style editor.
   */
  async setBoxBorderColor(hexValue: string) {
    const input = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_COLOR_INPUT));
    await input.clear();
    await input.fill(hexValue);
    await input.blur();
    await this.waitForLoading();
  }

  /**
   * Increase border width using the increase button.
   */
  async increaseBorderWidth(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_WIDTH_INCREASE));
    for (let i = 0; i < clicks; i++) {
      await button.click();
    }
    await this.waitForLoading();
  }

  /**
   * Decrease border width using the decrease button.
   */
  async decreaseBorderWidth(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_WIDTH_DECREASE));
    for (let i = 0; i < clicks; i++) {
      await button.click();
    }
    await this.waitForLoading();
  }

  /**
   * Increase border radius using the increase button.
   */
  async increaseBorderRadius(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_RADIUS_INCREASE));
    for (let i = 0; i < clicks; i++) {
      await button.click();
    }
    await this.waitForLoading();
  }

  /**
   * Increase padding using the increase button.
   */
  async increasePadding(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_PADDING_INCREASE));
    for (let i = 0; i < clicks; i++) {
      await button.click();
    }
    await this.waitForLoading();
  }

  /**
   * Toggle shadow on/off.
   */
  async toggleShadow() {
    await this.boxStyleShadowToggle.click();
    await this.waitForLoading();
  }

  // ==================== HEADER EDITOR METHODS ====================

  /**
   * Toggle show logo setting.
   */
  async toggleShowLogo() {
    await this.showLogoToggle.click();
    await this.waitForLoading();
  }

  /**
   * Toggle show menu name setting.
   */
  async toggleShowMenuName() {
    await this.showMenuNameToggle.click();
    await this.waitForLoading();
  }

  /**
   * Toggle show menu description setting.
   */
  async toggleShowMenuDescription() {
    await this.showMenuDescriptionToggle.click();
    await this.waitForLoading();
  }

  /**
   * Set logo position (left, center, right).
   */
  async setLogoPosition(position: 'left' | 'center' | 'right') {
    const buttonTestId = {
      left: TestIds.HEADER_EDITOR_LOGO_POSITION_LEFT,
      center: TestIds.HEADER_EDITOR_LOGO_POSITION_CENTER,
      right: TestIds.HEADER_EDITOR_LOGO_POSITION_RIGHT,
    }[position];
    await this.page.locator(testIdSelector(buttonTestId)).click();
    await this.waitForLoading();
  }

  /**
   * Set logo size (small, medium, large).
   */
  async setLogoSize(size: 'small' | 'medium' | 'large') {
    const buttonTestId = {
      small: TestIds.HEADER_EDITOR_LOGO_SIZE_SMALL,
      medium: TestIds.HEADER_EDITOR_LOGO_SIZE_MEDIUM,
      large: TestIds.HEADER_EDITOR_LOGO_SIZE_LARGE,
    }[size];
    await this.page.locator(testIdSelector(buttonTestId)).click();
    await this.waitForLoading();
  }

  /**
   * Set title position (left, center, right).
   */
  async setTitlePosition(position: 'left' | 'center' | 'right') {
    const buttonTestId = {
      left: TestIds.HEADER_EDITOR_TITLE_POSITION_LEFT,
      center: TestIds.HEADER_EDITOR_TITLE_POSITION_CENTER,
      right: TestIds.HEADER_EDITOR_TITLE_POSITION_RIGHT,
    }[position];
    await this.page.locator(testIdSelector(buttonTestId)).click();
    await this.waitForLoading();
  }

  // ==================== MEDIA POSITION METHODS ====================

  /**
   * Select media position (left, right, top, bottom).
   */
  async selectMediaPosition(position: string) {
    const buttons = this.page.locator(testIdSelector(TestIds.MEDIA_POSITION_BUTTON));
    const button = buttons.filter({ hasText: new RegExp(position, 'i') });
    await button.click();
    await this.waitForLoading();
  }

  /**
   * Select media size (small, medium, large, full).
   */
  async selectMediaSize(size: string) {
    const buttons = this.page.locator(testIdSelector(TestIds.MEDIA_SIZE_BUTTON));
    const button = buttons.filter({ hasText: new RegExp(size, 'i') });
    await button.click();
    await this.waitForLoading();
  }

  /**
   * Select media fit (cover, contain, fill).
   */
  async selectMediaFit(fit: string) {
    const buttons = this.page.locator(testIdSelector(TestIds.MEDIA_FIT_BUTTON));
    const button = buttons.filter({ hasText: new RegExp(fit, 'i') });
    await button.click();
    await this.waitForLoading();
  }

  /**
   * Toggle media visibility.
   */
  async toggleMediaVisibility() {
    await this.mediaShowToggle.click();
    await this.waitForLoading();
  }

  // ==================== CATEGORY STYLING METHODS ====================

  /**
   * Expand the category styling section.
   */
  async expandCategoryStyling() {
    const isExpanded = await this.categoryStylingContent.isVisible().catch(() => false);
    if (!isExpanded) {
      await this.categoryStylingToggle.click();
      await expect(this.categoryStylingContent).toBeVisible({ timeout: 5000 });
    }
  }

  /**
   * Collapse the category styling section.
   */
  async collapseCategoryStyling() {
    const isExpanded = await this.categoryStylingContent.isVisible().catch(() => false);
    if (isExpanded) {
      await this.categoryStylingToggle.click();
      await expect(this.categoryStylingContent).not.toBeVisible({ timeout: 5000 });
    }
  }

  /**
   * Check if category styling section is expanded.
   */
  async isCategoryStylingExpanded(): Promise<boolean> {
    return await this.categoryStylingContent.isVisible().catch(() => false);
  }

  // ==================== PREVIEW METHODS ====================

  /**
   * Expect the live preview panel to be visible.
   */
  async expectPreviewVisible() {
    await expect(this.livePreviewPanel.or(this.menuContentView).first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Expect the menu title to be visible in preview.
   */
  async expectPreviewTitleVisible() {
    await expect(this.menuContentViewTitle).toBeVisible({ timeout: 5000 });
  }

  /**
   * Get the menu title text from preview.
   */
  async getPreviewTitleText(): Promise<string> {
    return (await this.menuContentViewTitle.textContent()) || '';
  }

  /**
   * Verify preview updates by checking for specific element visibility.
   */
  async expectPreviewUpdated() {
    await expect(this.menuContentView).toBeVisible({ timeout: 5000 });
  }

  // ==================== SAVE/CANCEL METHODS ====================

  /**
   * Save the menu styling changes.
   */
  async saveStyling() {
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'PUT',
      { timeout: 15000 }
    ).catch(() => null);

    await this.menuEditorSaveButton.click();

    const response = await responsePromise;
    if (response?.ok()) {
      console.log('Menu styling saved successfully');
    }

    await this.waitForLoading();
  }

  /**
   * Cancel styling changes.
   */
  async cancelStyling() {
    await this.menuEditorCancelButton.click();
    await expect(this.menuEditor).not.toBeVisible({ timeout: 5000 });
  }
}
