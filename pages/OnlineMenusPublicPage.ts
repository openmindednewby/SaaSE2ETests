import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for Online Menus public-facing operations.
 * Handles preview modal, QR code modal, and external link functionality.
 *
 * For core menu list operations, use OnlineMenusPage.
 */
export class OnlineMenusPublicPage extends BasePage {
  // Preview Modal
  readonly previewModal: Locator;

  // QR Code Modal
  readonly qrCodeModal: Locator;
  readonly qrCodeDisplay: Locator;
  readonly qrCodeMenuName: Locator;
  readonly qrCodeUrlText: Locator;
  readonly qrCodeFgColorInput: Locator;
  readonly qrCodeBgColorInput: Locator;
  readonly qrCodeDownloadPngButton: Locator;
  readonly qrCodeDownloadSvgButton: Locator;
  readonly qrCodeCopyLinkButton: Locator;
  readonly qrCodeCloseButton: Locator;

  constructor(page: Page) {
    super(page);

    this.previewModal = page.locator(testIdSelector(TestIds.MENU_PREVIEW_MODAL));

    this.qrCodeModal = page.locator(testIdSelector(TestIds.QR_CODE_MODAL));
    this.qrCodeDisplay = page.locator(testIdSelector(TestIds.QR_CODE_DISPLAY));
    this.qrCodeMenuName = page.locator(testIdSelector(TestIds.QR_CODE_MENU_NAME));
    this.qrCodeUrlText = page.locator(testIdSelector(TestIds.QR_CODE_URL_TEXT));
    this.qrCodeFgColorInput = page.locator(testIdSelector(TestIds.QR_CODE_FG_COLOR_INPUT));
    this.qrCodeBgColorInput = page.locator(testIdSelector(TestIds.QR_CODE_BG_COLOR_INPUT));
    this.qrCodeDownloadPngButton = page.locator(testIdSelector(TestIds.QR_CODE_DOWNLOAD_PNG_BUTTON));
    this.qrCodeDownloadSvgButton = page.locator(testIdSelector(TestIds.QR_CODE_DOWNLOAD_SVG_BUTTON));
    this.qrCodeCopyLinkButton = page.locator(testIdSelector(TestIds.QR_CODE_COPY_LINK_BUTTON));
    this.qrCodeCloseButton = page.locator(testIdSelector(TestIds.QR_CODE_CLOSE_BUTTON));
  }

  // ==================== HELPER ====================

  /**
   * Get menu card by exact name (shared logic with OnlineMenusPage)
   */
  private getMenuCard(name: string): Locator {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRegex = new RegExp(`^${escapedName}$`);
    return this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
      has: this.page.locator(testIdSelector(TestIds.MENU_CARD_NAME), { hasText: exactRegex }),
    }).first();
  }

  // ==================== PREVIEW ====================

  async openPreview(name: string) {
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    const previewBtn = card.locator(testIdSelector(TestIds.MENU_CARD_PREVIEW_BUTTON));
    await previewBtn.click();
    await expect(this.previewModal).toBeVisible({ timeout: 5000 });
  }

  async closePreview() {
    const closeButton = this.previewModal.getByRole('button', { name: /close|cancel|x/i }).first();
    if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(this.previewModal).not.toBeVisible({ timeout: 5000 });
  }

  async expectPreviewModalVisible() { await expect(this.previewModal).toBeVisible({ timeout: 5000 }); }
  async expectPreviewModalNotVisible() { await expect(this.previewModal).not.toBeVisible({ timeout: 5000 }); }

  getPreviewButton(name: string): Locator {
    return this.getMenuCard(name).locator(testIdSelector(TestIds.MENU_CARD_PREVIEW_BUTTON));
  }

  // ==================== QR CODE ====================

  getQrCodeButton(name: string): Locator {
    return this.getMenuCard(name).locator(testIdSelector(TestIds.MENU_CARD_QR_CODE_BUTTON));
  }

  async openQrCodeModal(name: string) {
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    await card.locator(testIdSelector(TestIds.MENU_CARD_QR_CODE_BUTTON)).click();
    await expect(this.qrCodeModal).toBeVisible({ timeout: 5000 });
  }

  async closeQrCodeModal() {
    await this.qrCodeCloseButton.click();
    await expect(this.qrCodeModal).not.toBeVisible({ timeout: 5000 });
  }

  async expectQrCodeModalVisible() { await expect(this.qrCodeModal).toBeVisible({ timeout: 5000 }); }
  async expectQrCodeModalNotVisible() { await expect(this.qrCodeModal).not.toBeVisible({ timeout: 5000 }); }
  async expectQrCodeDisplayVisible() { await expect(this.qrCodeDisplay).toBeVisible({ timeout: 5000 }); }
  async expectQrCodeMenuName(name: string) { await expect(this.qrCodeMenuName).toContainText(name, { timeout: 5000 }); }
  async expectQrCodeUrlVisible() { await expect(this.qrCodeUrlText).toBeVisible({ timeout: 5000 }); }
  async getQrCodeFgColor(): Promise<string> { return await this.qrCodeFgColorInput.inputValue(); }
  async getQrCodeBgColor(): Promise<string> { return await this.qrCodeBgColorInput.inputValue(); }
  async setQrCodeFgColor(color: string) { await this.qrCodeFgColorInput.fill(color); }
  async setQrCodeBgColor(color: string) { await this.qrCodeBgColorInput.fill(color); }
  async clickCopyLink() { await this.qrCodeCopyLinkButton.click(); }
  async clickDownloadPng() { await this.qrCodeDownloadPngButton.click(); }
  async clickDownloadSvg() { await this.qrCodeDownloadSvgButton.click(); }

  // ==================== EXTERNAL LINK ====================

  getOpenExternalButton(name: string): Locator {
    return this.getMenuCard(name).locator(testIdSelector(TestIds.MENU_CARD_OPEN_EXTERNAL_BUTTON));
  }

  async isOpenExternalButtonEnabled(name: string): Promise<boolean> {
    return await this.getOpenExternalButton(name).isEnabled({ timeout: 1000 }).catch(() => false);
  }

  async openExternalLink(name: string): Promise<Page | null> {
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    const openExternalBtn = card.locator(testIdSelector(TestIds.MENU_CARD_OPEN_EXTERNAL_BUTTON));
    if (!(await openExternalBtn.isEnabled({ timeout: 1000 }).catch(() => false))) return null;
    const pagePromise = this.page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
    await openExternalBtn.click();
    const newPage = await pagePromise;
    if (newPage) await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return newPage;
  }

  async getMenuExternalId(name: string): Promise<string | null> {
    const card = this.getMenuCard(name);
    const idElement = card.locator(testIdSelector(TestIds.MENU_CARD_ID));
    const idText = await idElement.textContent({ timeout: 1000 }).catch(() => null);
    if (!idText) return null;
    // Extract UUID from text like ".id: 1498e16b-..." or "ID: 1498e16b-..."
    const uuidMatch = idText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuidMatch?.[0] || idText.trim();
  }
}
