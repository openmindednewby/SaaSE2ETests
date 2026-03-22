import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for advanced Menu Styling operations.
 * Handles box style, header, media position, category styling, and preview methods.
 *
 * For core styling operations (navigation, colors, typography, save/cancel),
 * use MenuStylingPage.
 */
export class MenuStylingAdvancedPage extends BasePage {
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

  // ==================== BOX STYLE METHODS ====================

  async setBoxBackgroundColor(hexValue: string) {
    const input = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BACKGROUND_COLOR_INPUT));
    await input.clear();
    await input.fill(hexValue);
    await input.blur();
    await this.waitForLoading();
  }

  async getBoxBackgroundColor(): Promise<string> {
    const input = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BACKGROUND_COLOR_INPUT));
    return await input.inputValue();
  }

  async setBoxBorderColor(hexValue: string) {
    const input = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_COLOR_INPUT));
    await input.clear();
    await input.fill(hexValue);
    await input.blur();
    await this.waitForLoading();
  }

  async increaseBorderWidth(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_WIDTH_INCREASE));
    for (let i = 0; i < clicks; i++) { await button.click(); }
    await this.waitForLoading();
  }

  async decreaseBorderWidth(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_WIDTH_DECREASE));
    for (let i = 0; i < clicks; i++) { await button.click(); }
    await this.waitForLoading();
  }

  async increaseBorderRadius(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_BORDER_RADIUS_INCREASE));
    for (let i = 0; i < clicks; i++) { await button.click(); }
    await this.waitForLoading();
  }

  async increasePadding(clicks: number = 1) {
    const button = this.page.locator(testIdSelector(TestIds.BOX_STYLE_PADDING_INCREASE));
    for (let i = 0; i < clicks; i++) { await button.click(); }
    await this.waitForLoading();
  }

  async toggleShadow() { await this.boxStyleShadowToggle.click(); await this.waitForLoading(); }

  // ==================== HEADER EDITOR METHODS ====================

  async toggleShowLogo() { await this.showLogoToggle.click(); await this.waitForLoading(); }
  async toggleShowMenuName() { await this.showMenuNameToggle.click(); await this.waitForLoading(); }
  async toggleShowMenuDescription() { await this.showMenuDescriptionToggle.click(); await this.waitForLoading(); }

  async setLogoPosition(position: 'left' | 'center' | 'right') {
    const buttonTestId = {
      left: TestIds.HEADER_EDITOR_LOGO_POSITION_LEFT,
      center: TestIds.HEADER_EDITOR_LOGO_POSITION_CENTER,
      right: TestIds.HEADER_EDITOR_LOGO_POSITION_RIGHT,
    }[position];
    await this.page.locator(testIdSelector(buttonTestId)).click();
    await this.waitForLoading();
  }

  async setLogoSize(size: 'small' | 'medium' | 'large') {
    const buttonTestId = {
      small: TestIds.HEADER_EDITOR_LOGO_SIZE_SMALL,
      medium: TestIds.HEADER_EDITOR_LOGO_SIZE_MEDIUM,
      large: TestIds.HEADER_EDITOR_LOGO_SIZE_LARGE,
    }[size];
    await this.page.locator(testIdSelector(buttonTestId)).click();
    await this.waitForLoading();
  }

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

  async selectMediaPosition(position: string) {
    const buttons = this.page.locator(testIdSelector(TestIds.MEDIA_POSITION_BUTTON));
    await buttons.filter({ hasText: new RegExp(position, 'i') }).click();
    await this.waitForLoading();
  }

  async selectMediaSize(size: string) {
    const buttons = this.page.locator(testIdSelector(TestIds.MEDIA_SIZE_BUTTON));
    await buttons.filter({ hasText: new RegExp(size, 'i') }).click();
    await this.waitForLoading();
  }

  async selectMediaFit(fit: string) {
    const buttons = this.page.locator(testIdSelector(TestIds.MEDIA_FIT_BUTTON));
    await buttons.filter({ hasText: new RegExp(fit, 'i') }).click();
    await this.waitForLoading();
  }

  async toggleMediaVisibility() { await this.mediaShowToggle.click(); await this.waitForLoading(); }

  // ==================== CATEGORY STYLING METHODS ====================

  async expandCategoryStyling() {
    const isExpanded = await this.categoryStylingContent.isVisible().catch(() => false);
    if (!isExpanded) {
      await this.categoryStylingToggle.click();
      await expect(this.categoryStylingContent).toBeVisible({ timeout: 5000 });
    }
  }

  async collapseCategoryStyling() {
    const isExpanded = await this.categoryStylingContent.isVisible().catch(() => false);
    if (isExpanded) {
      await this.categoryStylingToggle.click();
      await expect(this.categoryStylingContent).not.toBeVisible({ timeout: 5000 });
    }
  }

  async isCategoryStylingExpanded(): Promise<boolean> {
    return await this.categoryStylingContent.isVisible().catch(() => false);
  }

  // ==================== PREVIEW METHODS ====================

  async expectPreviewVisible() {
    await expect(this.livePreviewPanel.or(this.menuContentView).first()).toBeVisible({ timeout: 5000 });
  }

  async expectPreviewTitleVisible() { await expect(this.menuContentViewTitle).toBeVisible({ timeout: 5000 }); }

  async getPreviewTitleText(): Promise<string> {
    return (await this.menuContentViewTitle.textContent()) || '';
  }

  async expectPreviewUpdated() { await expect(this.menuContentView).toBeVisible({ timeout: 5000 }); }
}
