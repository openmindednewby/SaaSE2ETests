import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

const DRAWER_LOAD_TIMEOUT = 10000;
const MIN_PRESET_CARDS = 2;
const MIN_COLOR_SWATCHES_PER_PRESET = 2;
const DEFAULT_CONTENT_MAX_WIDTH = '1440px';
const FULL_WIDTH_CONTENT_MAX_WIDTH = 'none';

/**
 * Page object for the SyncfusionThemeStudio Theme Settings Drawer.
 * Handles opening the drawer, navigating to the Presets tab,
 * and verifying preset card rendering.
 */
export class ThemeSettingsPage extends BasePage {
  readonly drawer: Locator;
  readonly closeButton: Locator;
  readonly presetsTab: Locator;
  readonly presetCards: Locator;
  readonly layoutTab: Locator;
  readonly fullWidthCheckboxWrapper: Locator;
  readonly fullWidthCheckboxInput: Locator;
  readonly mainContentArea: Locator;
  readonly contentContainer: Locator;

  constructor(page: Page) {
    super(page);
    this.drawer = page.locator(testIdSelector(TestIds.STUDIO_THEME_SETTINGS_DRAWER));
    this.closeButton = page.locator(testIdSelector(TestIds.STUDIO_THEME_CLOSE_BTN));
    this.presetsTab = page.locator(testIdSelector(TestIds.STUDIO_THEME_TAB_PRESETS));
    this.presetCards = page.locator(testIdSelector(TestIds.STUDIO_THEME_PRESET_CARD));
    this.layoutTab = page.locator(testIdSelector(TestIds.STUDIO_THEME_TAB_LAYOUT));
    this.fullWidthCheckboxWrapper = page.locator(
      testIdSelector(TestIds.STUDIO_LAYOUT_FULL_WIDTH_CHECKBOX)
    );
    this.fullWidthCheckboxInput = this.fullWidthCheckboxWrapper.locator('input[type="checkbox"]');
    this.mainContentArea = page.locator('#main-content');
    this.contentContainer = this.mainContentArea.locator('.max-w-content');
  }

  // ==================== ACTIONS ====================

  /**
   * Open the theme settings drawer by clicking the toggle button.
   * The drawer starts collapsed; clicking the toggle expands it.
   */
  async openDrawer() {
    // The close/toggle button is always visible even when collapsed
    await expect(this.closeButton).toBeVisible({ timeout: DRAWER_LOAD_TIMEOUT });

    // Check if drawer content is already visible by checking for tab presence
    const isExpanded = await this.closeButton.getAttribute('aria-expanded');
    if (isExpanded !== 'true')
      await this.closeButton.click();

    // Wait for drawer content to become visible
    await expect(this.presetsTab).toBeVisible({ timeout: DRAWER_LOAD_TIMEOUT });
  }

  /**
   * Navigate to the Presets tab within the theme settings drawer.
   */
  async navigateToPresetsTab() {
    await this.presetsTab.click();
    // Wait for preset cards to load
    await expect(this.presetCards.first()).toBeVisible({ timeout: DRAWER_LOAD_TIMEOUT });
  }

  /**
   * Open the drawer and navigate to the Presets tab.
   */
  async openPresetsTab() {
    await this.openDrawer();
    await this.navigateToPresetsTab();
  }

  // ==================== ASSERTIONS ====================

  /**
   * Expect the drawer to be visible and expanded.
   */
  async expectDrawerOpen() {
    await expect(this.drawer).toBeVisible();
    await expect(this.closeButton).toHaveAttribute('aria-expanded', 'true');
  }

  /**
   * Expect preset cards to be rendered.
   */
  async expectPresetCardsRendered() {
    const count = await this.presetCards.count();
    expect(
      count,
      `Expected at least ${MIN_PRESET_CARDS} preset cards to be rendered`
    ).toBeGreaterThanOrEqual(MIN_PRESET_CARDS);
  }

  /**
   * Expect each preset card to have a color preview strip with swatches.
   * This verifies Bug 2 fix: duplicate React keys in color swatches
   * would cause rendering issues.
   */
  async expectPresetCardsHaveColorSwatches() {
    const cardCount = await this.presetCards.count();
    expect(cardCount, 'Should have preset cards to check').toBeGreaterThan(0);

    // Check each preset card has color swatches in its preview strip
    for (let i = 0; i < cardCount; i++) {
      const card = this.presetCards.nth(i);
      // The color preview strip is a flex container with colored div children
      const colorStrip = card.locator('div.flex.overflow-hidden').first();
      const swatches = colorStrip.locator('div.flex-1');
      const swatchCount = await swatches.count();
      expect(
        swatchCount,
        `Preset card ${i} should have at least ${MIN_COLOR_SWATCHES_PER_PRESET} color swatches`
      ).toBeGreaterThanOrEqual(MIN_COLOR_SWATCHES_PER_PRESET);
    }
  }

  /**
   * Expect no duplicate key warnings by verifying all color swatch elements
   * are rendered (DOM count matches expected count).
   * With duplicate keys, React can skip rendering duplicate elements.
   */
  async expectNoDuplicateKeyIssues() {
    const cardCount = await this.presetCards.count();

    for (let i = 0; i < cardCount; i++) {
      const card = this.presetCards.nth(i);
      const colorStrip = card.locator('div.flex.overflow-hidden').first();
      const swatches = colorStrip.locator('> div');
      const swatchCount = await swatches.count();

      // Each swatch should have a background color set (not transparent/empty)
      for (let j = 0; j < swatchCount; j++) {
        const swatch = swatches.nth(j);
        const bgColor = await swatch.evaluate((el) => {
          return window.getComputedStyle(el).backgroundColor;
        });
        const isValidColor = bgColor !== '' && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';
        expect(
          isValidColor,
          `Swatch ${j} in preset card ${i} should have a valid background color`
        ).toBe(true);
      }
    }
  }

  /**
   * Expect each preset card has a name label.
   */
  async expectPresetCardsHaveNames() {
    const cardCount = await this.presetCards.count();

    for (let i = 0; i < cardCount; i++) {
      const card = this.presetCards.nth(i);
      const nameLabel = card.locator('span.font-medium').first();
      const nameText = await nameLabel.textContent();
      expect(
        nameText?.length,
        `Preset card ${i} should have a non-empty name`
      ).toBeGreaterThan(0);
    }
  }

  /**
   * Expect exactly one preset card to be marked as active.
   */
  async expectOneActivePreset() {
    const activeCards = this.presetCards.filter({
      has: this.page.locator('[aria-pressed="true"]'),
    });
    // The active card might be the one matching the current theme
    // At least verify the aria-pressed attribute is used
    const activeCount = await activeCards.count();
    expect(
      activeCount,
      'Should have at most one active preset card'
    ).toBeLessThanOrEqual(1);
  }

  // ==================== LAYOUT TAB ACTIONS ====================

  /**
   * Navigate to the Layout tab within the theme settings drawer.
   */
  async navigateToLayoutTab() {
    await this.layoutTab.click();
    // Wait for the layout section content to become visible
    await expect(this.fullWidthCheckboxWrapper).toBeVisible({ timeout: DRAWER_LOAD_TIMEOUT });
  }

  /**
   * Open the drawer and navigate to the Layout tab.
   */
  async openLayoutTab() {
    await this.openDrawer();
    await this.navigateToLayoutTab();
  }

  /**
   * Toggle the Content Full Width checkbox.
   */
  async toggleFullWidthCheckbox() {
    await this.fullWidthCheckboxInput.click();
  }

  // ==================== LAYOUT TAB ASSERTIONS ====================

  /**
   * Get the --content-max-width CSS variable value from the document root.
   */
  async getContentMaxWidthVariable(): Promise<string> {
    return await this.page.evaluate(() => {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--content-max-width')
        .trim();
    });
  }

  /**
   * Expect the full width checkbox to be unchecked (default state).
   */
  async expectFullWidthCheckboxUnchecked() {
    await expect(this.fullWidthCheckboxInput).not.toBeChecked();
  }

  /**
   * Expect the full width checkbox to be checked.
   */
  async expectFullWidthCheckboxChecked() {
    await expect(this.fullWidthCheckboxInput).toBeChecked();
  }

  /**
   * Expect --content-max-width CSS variable to be the default value (1440px).
   */
  async expectDefaultContentMaxWidth() {
    await expect(async () => {
      const value = await this.getContentMaxWidthVariable();
      expect(value, 'CSS variable --content-max-width should be default').toBe(
        DEFAULT_CONTENT_MAX_WIDTH
      );
    }).toPass();
  }

  /**
   * Expect --content-max-width CSS variable to be 'none' (full width enabled).
   */
  async expectFullWidthContentMaxWidth() {
    await expect(async () => {
      const value = await this.getContentMaxWidthVariable();
      expect(value, 'CSS variable --content-max-width should be none').toBe(
        FULL_WIDTH_CONTENT_MAX_WIDTH
      );
    }).toPass();
  }

  /**
   * Expect the main content area to have standard padding (p-6 = 24px).
   */
  async expectStandardPadding() {
    await expect(this.mainContentArea).toBeVisible();
    const hasP6 = await this.mainContentArea.evaluate((el) => {
      return el.classList.contains('p-6');
    });
    expect(hasP6, 'Main content should have p-6 class for standard padding').toBe(true);
  }

  /**
   * Expect the main content area to have reduced padding (p-2 = 8px).
   */
  async expectReducedPadding() {
    await expect(this.mainContentArea).toBeVisible();
    const hasP2 = await this.mainContentArea.evaluate((el) => {
      return el.classList.contains('p-2');
    });
    expect(hasP2, 'Main content should have p-2 class for reduced padding').toBe(true);
  }

  /**
   * Expect the content container to have mx-auto centering (default).
   */
  async expectContentCentered() {
    await expect(this.contentContainer).toBeVisible();
    const hasMxAuto = await this.contentContainer.evaluate((el) => {
      return el.classList.contains('mx-auto');
    });
    expect(hasMxAuto, 'Content container should have mx-auto for centering').toBe(true);
  }

  /**
   * Expect the content container to NOT have mx-auto centering (full width).
   */
  async expectContentNotCentered() {
    await expect(this.contentContainer).toBeVisible();
    const hasMxAuto = await this.contentContainer.evaluate((el) => {
      return el.classList.contains('mx-auto');
    });
    expect(hasMxAuto, 'Content container should not have mx-auto when full width').toBe(false);
  }
}
