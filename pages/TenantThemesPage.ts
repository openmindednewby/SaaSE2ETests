import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

const EDITOR_LOAD_TIMEOUT = 15000;

/**
 * Page object for the Tenant Theme Editor page.
 * Handles preset selection, color editing, save/reset, and preview verification.
 */
export class TenantThemesPage extends BasePage {
  readonly pageTitle: Locator;
  readonly editorScreen: Locator;
  readonly primaryColorInput: Locator;
  readonly secondaryColorInput: Locator;
  readonly accentColorInput: Locator;
  readonly saveButton: Locator;
  readonly resetButton: Locator;
  readonly previewCard: Locator;
  readonly typographyScaleInput: Locator;
  readonly confirmButton: Locator;
  readonly successToast: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.getByText('Theme Editor').first();
    this.editorScreen = page.locator(testIdSelector(TestIds.TENANT_THEME_EDITOR_SCREEN));
    this.primaryColorInput = page.locator(testIdSelector(TestIds.TENANT_THEME_COLOR_PRIMARY));
    this.secondaryColorInput = page.locator(testIdSelector(TestIds.TENANT_THEME_COLOR_SECONDARY));
    this.accentColorInput = page.locator(testIdSelector(TestIds.TENANT_THEME_COLOR_ACCENT));
    this.saveButton = page.locator(testIdSelector(TestIds.TENANT_THEME_EDITOR_SAVE));
    this.resetButton = page.locator(testIdSelector(TestIds.TENANT_THEME_EDITOR_RESET));
    this.previewCard = page.locator(testIdSelector(TestIds.TENANT_THEME_PREVIEW));
    this.typographyScaleInput = page.locator(testIdSelector(TestIds.TENANT_THEME_TYPOGRAPHY_SCALE));
    this.confirmButton = page.locator(testIdSelector(TestIds.CONFIRM_BUTTON));
    this.successToast = page.locator(testIdSelector(TestIds.NOTIFICATION_TOAST));
  }

  // ==================== NAVIGATION ====================

  async goto() {
    await super.goto('/tenant-themes');
  }

  async expectPageLoaded() {
    await expect(this.editorScreen).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT });
  }

  // ==================== ACTIONS ====================

  async selectPreset(name: string) {
    const presetCard = this.page.getByRole('button', { name }).first();
    await presetCard.click();
  }

  async setPrimaryColor(hex: string) {
    await this.primaryColorInput.fill(hex);
  }

  async clickSave() {
    await this.saveButton.click();
  }

  async clickReset() {
    await this.resetButton.click();
  }

  async confirmReset() {
    await expect(this.confirmButton).toBeVisible();
    await this.confirmButton.click();
  }

  // ==================== ASSERTIONS ====================

  async expectSaveSuccess() {
    await expect(this.successToast).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT });
  }

  async expectPreviewVisible() {
    await expect(this.previewCard).toBeVisible();
  }

  get presetCards(): Locator {
    return this.page.locator('[data-testid^="theme-preset-"]');
  }
}
