import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';
import { OnlineMenusContentPage } from './OnlineMenusContentPage.js';
import { OnlineMenusEditorPage } from './OnlineMenusEditorPage.js';

/**
 * Page object for core Online Menus list operations.
 * Handles navigation, menu CRUD, activation/deactivation, and status queries.
 *
 * For editor operations (categories, items), use OnlineMenusEditorPage.
 * For content upload operations, use OnlineMenusContentPage.
 * For preview, QR code, and external link, use OnlineMenusPublicPage.
 */
export class OnlineMenusPage extends BasePage {
  readonly pageHeader: Locator;
  readonly menuList: Locator;
  readonly createMenuButton: Locator;
  readonly refreshButton: Locator;
  readonly loadingIndicator: Locator;
  readonly confirmDialog: Locator;
  readonly confirmButton: Locator;
  readonly cancelConfirmButton: Locator;

  // Menu Editor
  readonly menuEditor: Locator;
  readonly menuNameInput: Locator;
  readonly menuDescriptionInput: Locator;
  readonly menuEditorSaveButton: Locator;
  readonly menuEditorCancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeader = page.getByText(/menus/i);
    this.menuList = page.locator(testIdSelector(TestIds.MENU_LIST));
    this.createMenuButton = page.locator(testIdSelector(TestIds.MENU_LIST_CREATE_BUTTON));
    this.refreshButton = page.locator(testIdSelector(TestIds.MENU_LIST_REFRESH_BUTTON));
    this.loadingIndicator = page.locator('[role="progressbar"]');
    this.confirmDialog = page.locator(testIdSelector(TestIds.CONFIRM_DIALOG));
    this.confirmButton = page.locator(testIdSelector(TestIds.CONFIRM_BUTTON));
    this.cancelConfirmButton = page.locator(testIdSelector(TestIds.CANCEL_CONFIRM_BUTTON));

    this.menuEditor = page.getByRole('dialog');
    this.menuNameInput = page.locator(testIdSelector(TestIds.MENU_EDITOR_NAME_INPUT));
    this.menuDescriptionInput = page.locator(testIdSelector(TestIds.MENU_EDITOR_DESCRIPTION_INPUT));
    this.menuEditorSaveButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_SAVE_BUTTON));
    this.menuEditorCancelButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_CANCEL_BUTTON));
  }

  async goto() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await super.goto('/menus');
      await this.waitForLoading();
      await expect(this.createMenuButton).toBeVisible({ timeout: 15000 });
      const errorText = this.page.getByText(/failed to load/i);
      const hasError = await errorText.isVisible({ timeout: 1000 }).catch(() => false);
      if (!hasError) return;
      if (attempt < 3) {
        await this.page.getByRole('button', { name: /refresh/i }).click().catch(() => {});
        await this.waitForLoading();
      }
    }
  }

  async refetchMenusList() {
    const listFetch = this.page.waitForResponse(
      (r) => r.url().includes('/TenantMenus') && r.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);
    await this.goto();
    await listFetch;
  }

  async refresh() {
    await this.waitForLoading();
    const listFetch = this.page.waitForResponse(
      (r) => r.url().includes('/TenantMenus') && r.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);
    await this.refreshButton.click();
    await this.waitForLoading();
    await listFetch;
  }

  async createMenu(name: string, description: string = '') {
    await expect(this.createMenuButton).toBeVisible({ timeout: 15000 });
    await this.createMenuButton.click({ timeout: 15000 });
    await this.menuEditor.waitFor({ state: 'visible', timeout: 15000 });
    await this.menuNameInput.fill(name);
    if (description) await this.menuDescriptionInput.fill(description);

    const postPromise = this.page.waitForResponse(
      r => r.url().includes('/TenantMenus') && r.request().method() === 'POST', { timeout: 15000 }
    );
    const refetchPromise = this.page.waitForResponse(
      r => r.url().includes('/TenantMenus') && r.request().method() === 'GET' && r.ok(), { timeout: 15000 }
    ).catch(() => null);

    await this.menuEditorSaveButton.click();
    const postResponse = await postPromise;
    if (!postResponse.ok()) throw new Error(`Menu creation failed with status ${postResponse.status()}`);
    await refetchPromise;
    await this.waitForLoading();
    await expect(this.menuEditor).not.toBeVisible({ timeout: 10000 });
  }

  getMenuCard(name: string): Locator {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
      has: this.page.locator(testIdSelector(TestIds.MENU_CARD_NAME), { hasText: new RegExp(`^${escaped}$`) }),
    }).first();
  }

  async menuExists(name: string): Promise<boolean> {
    await this.waitForLoading();
    return await this.getMenuCard(name).waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  }

  async expectMenuInList(name: string) {
    const menu = this.getMenuCard(name);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await expect(menu).toBeVisible({ timeout: 15000 }); return; }
      catch (e) { if (attempt >= 3) throw e; await this.refetchMenusList(); }
    }
  }

  async expectMenuNotInList(name: string) {
    const menus = this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
      has: this.page.locator(testIdSelector(TestIds.MENU_CARD_NAME), { hasText: name }),
    });
    await expect(menus).toHaveCount(0, { timeout: 10000 });
  }

  async editMenu(name: string) {
    await this.waitForLoading();
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    const editBtn = card.locator(testIdSelector(TestIds.MENU_CARD_EDIT_BUTTON));
    try { await editBtn.click({ timeout: 5000 }); } catch { await editBtn.click({ force: true }); }
    await this.menuEditor.waitFor({ state: 'visible', timeout: 15000 });
  }

  async deleteMenu(name: string, throwOnError: boolean = true) {
    await this.waitForLoading();
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    const deletePromise = this.page.waitForResponse(
      r => r.url().includes('/TenantMenus') && r.request().method() === 'DELETE', { timeout: 15000 }
    ).catch(() => null);
    const deleteBtn = card.locator(testIdSelector(TestIds.MENU_CARD_DELETE_BUTTON));
    try { await deleteBtn.click({ timeout: 5000 }); } catch { await deleteBtn.click({ force: true }); }
    const dialog = this.page.locator('[role="dialog"]');
    if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      const confirm = dialog.getByRole('button', { name: /confirm|ok|yes|delete/i }).last();
      if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click({ timeout: 5000 }).catch(() => {});
    }
    const response = await deletePromise;
    if (response && response.status() !== 404 && !response.ok() && throwOnError)
      throw new Error(`Menu deletion API returned status ${response.status()}`);
    await this.waitForLoading();
    await this.page.waitForResponse(
      r => r.url().includes('/TenantMenus') && r.request().method() === 'GET', { timeout: 10000 }
    ).catch(() => null);
    try { await this.expectMenuNotInList(name); } catch { if (throwOnError) throw new Error(`Menu "${name}" still visible after deletion`); }
  }

  async activateMenu(name: string): Promise<boolean> {
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
    const activateBtn = card.locator(testIdSelector(TestIds.MENU_CARD_ACTIVATE_BUTTON));
    try { await expect(activateBtn).toBeVisible({ timeout: 10000 }); } catch { return false; }
    const apiPromise = this.page.waitForResponse(
      r => r.url().includes('/TenantMenus') && r.url().includes('/activate') && r.request().method() === 'PATCH', { timeout: 15000 }
    ).catch(() => null);
    try { await activateBtn.click({ timeout: 5000 }); } catch { await activateBtn.click({ force: true }); }
    const apiSuccess = (await apiPromise)?.ok() ?? false;
    await this.waitForLoading();
    if (apiSuccess) await expect(statusBadge).toHaveText(/active/i, { timeout: 5000 }).catch(() => {});
    return true;
  }

  async deactivateMenu(name: string): Promise<boolean> {
    const card = this.getMenuCard(name);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
    const deactivateBtn = card.locator(testIdSelector(TestIds.MENU_CARD_DEACTIVATE_BUTTON));
    try { await expect(deactivateBtn).toBeVisible({ timeout: 10000 }); } catch { return false; }
    const apiPromise = this.page.waitForResponse(
      r => r.url().includes('/TenantMenus') && r.url().includes('/deactivate') && r.request().method() === 'PATCH', { timeout: 15000 }
    ).catch(() => null);
    try { await deactivateBtn.click({ timeout: 5000 }); } catch { await deactivateBtn.click({ force: true }); }
    const apiSuccess = (await apiPromise)?.ok() ?? false;
    await this.waitForLoading();
    if (apiSuccess) await expect(statusBadge).toHaveText(/inactive/i, { timeout: 5000 }).catch(() => {});
    return apiSuccess;
  }

  async isMenuActive(name: string): Promise<boolean> {
    const text = (await this.getMenuCard(name).locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE)).textContent().catch(() => '')) || '';
    return text.toLowerCase().trim() === 'active';
  }

  async expectMenuActive(name: string, active: boolean = true) {
    const expected = active ? /active/i : /inactive/i;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.waitForLoading();
      const badge = this.getMenuCard(name).locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
      try { await expect(badge).toHaveText(expected, { timeout: 10000 }); return; }
      catch (e) { if (attempt >= 3) throw e; await this.refetchMenusList(); }
    }
  }

  async getMenuStatus(name: string): Promise<string> {
    return (await this.getMenuCard(name).locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE)).textContent().catch(() => '')) || '';
  }

  async getMenuNames(): Promise<string[]> {
    await this.waitForLoading();
    const cards = this.page.locator(testIdSelector(TestIds.MENU_CARD));
    await cards.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const count = await cards.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).locator(testIdSelector(TestIds.MENU_CARD_NAME)).textContent({ timeout: 1000 }).catch(() => null);
      if (text) names.push(text.trim());
    }
    return names;
  }

  async deactivateAllMenus() {
    await this.goto();
    const statusSel = testIdSelector(TestIds.MENU_CARD_STATUS_BADGE);
    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      const active = this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
        has: this.page.locator(statusSel, { hasText: /^Active$/i })
      });
      if (await active.count() === 0) break;
      const card = active.first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      const api = this.page.waitForResponse(
        r => r.url().includes('/TenantMenus') && r.url().includes('/deactivate') && r.request().method() === 'PATCH', { timeout: 10000 }
      ).catch(() => null);
      const btn = card.locator(testIdSelector(TestIds.MENU_CARD_DEACTIVATE_BUTTON));
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) await btn.click();
      else { await this.goto(); continue; }
      await api;
      await this.waitForLoading();
    }
  }

  // ==================== EDITOR DELEGATION ====================
  // Delegate to OnlineMenusEditorPage so existing tests using
  // menusPage.addCategory() etc. continue to work.

  private get _editor(): OnlineMenusEditorPage { return new OnlineMenusEditorPage(this.page); }

  async switchToContentTab() { return this._editor.switchToContentTab(); }
  async addCategory() { return this._editor.addCategory(); }
  async expandCategory(categoryIndex: number) { return this._editor.expandCategory(categoryIndex); }
  async collapseCategory(categoryIndex: number) { return this._editor.collapseCategory(categoryIndex); }
  async updateCategoryName(categoryIndex: number, name: string) { return this._editor.updateCategoryName(categoryIndex, name); }
  async addMenuItem(categoryIndex: number) { return this._editor.addMenuItem(categoryIndex); }
  async deleteCategory(categoryIndex: number) { return this._editor.deleteCategory(categoryIndex); }
  async deleteMenuItem(categoryIndex: number, itemIndex: number) { return this._editor.deleteMenuItem(categoryIndex, itemIndex); }
  async getCategoryCount() { return this._editor.getCategoryCount(); }
  async getItemCount(categoryIndex: number) { return this._editor.getItemCount(categoryIndex); }
  async getCategoryNameValue(categoryIndex: number) { return this._editor.getCategoryNameValue(categoryIndex); }
  async getMenuItemNameValue(categoryIndex: number, itemIndex: number) { return this._editor.getMenuItemNameValue(categoryIndex, itemIndex); }
  async getMenuItemPriceValue(categoryIndex: number, itemIndex: number) { return this._editor.getMenuItemPriceValue(categoryIndex, itemIndex); }
  async updateMenuItemName(categoryIndex: number, itemIndex: number, name: string) { return this._editor.updateMenuItemName(categoryIndex, itemIndex, name); }
  async updateMenuItemPrice(categoryIndex: number, itemIndex: number, price: string) { return this._editor.updateMenuItemPrice(categoryIndex, itemIndex, price); }
  async saveMenuEditor() { return this._editor.saveMenuEditor(); }
  async cancelMenuEditor() { return this._editor.cancelMenuEditor(); }

  // ==================== CONTENT DELEGATION ====================
  // Delegate to OnlineMenusContentPage so existing tests using
  // menusPage.uploadImageToMenuItem() etc. continue to work.

  private get _content(): OnlineMenusContentPage { return new OnlineMenusContentPage(this.page); }

  async uploadImageToMenuItem(categoryIndex: number, itemIndex: number, filePath: string) { return this._content.uploadImageToMenuItem(categoryIndex, itemIndex, filePath); }
  async uploadImageToCategory(categoryIndex: number, filePath: string) { return this._content.uploadImageToCategory(categoryIndex, filePath); }
  async expectMenuItemImageVisible(categoryIndex: number, itemIndex: number) { return this._content.expectMenuItemImageVisible(categoryIndex, itemIndex); }
  async expectCategoryImageVisible(categoryIndex: number) { return this._content.expectCategoryImageVisible(categoryIndex); }
  async deleteMenuItemImage(categoryIndex: number, itemIndex: number) { return this._content.deleteMenuItemImage(categoryIndex, itemIndex); }
  async expectImageLoaded(categoryIndex: number, itemIndex: number) { return this._content.expectImageLoaded(categoryIndex, itemIndex); }
  async expectPreviewImagesLoaded() { return this._content.expectPreviewImagesLoaded(); }
}
