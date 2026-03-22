import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector, indexedTestIdSelector, testIdStartsWithSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for the Online Menus Editor functionality.
 * Handles category CRUD, menu item CRUD, and editor save/cancel operations.
 */
export class OnlineMenusEditorPage extends BasePage {
  // Menu Editor
  readonly menuEditor: Locator;
  readonly menuEditorSaveButton: Locator;
  readonly menuEditorCancelButton: Locator;

  // Category Management
  readonly categoryAddButton: Locator;
  readonly categoryList: Locator;

  constructor(page: Page) {
    super(page);

    this.menuEditor = page.getByRole('dialog');
    this.menuEditorSaveButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_SAVE_BUTTON));
    this.menuEditorCancelButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_CANCEL_BUTTON));

    this.categoryAddButton = page.locator(testIdSelector(TestIds.CATEGORY_ADD_BUTTON));
    this.categoryList = page.locator(testIdSelector(TestIds.CATEGORY_LIST));
  }

  /**
   * Switch to the Content tab in the menu editor (FullMenuEditor).
   */
  async switchToContentTab() {
    const contentTab = this.menuEditor.getByRole('tab', { name: /content/i });
    await contentTab.click();
    await expect(this.categoryAddButton).toBeVisible({ timeout: 5000 });
  }

  /**
   * Add a new category to the menu
   */
  async addCategory() {
    const isContentTabActive = await this.categoryAddButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isContentTabActive) {
      await this.switchToContentTab();
    }
    await this.categoryAddButton.click();
    await this.waitForLoading();
  }

  /**
   * Get a category item by index
   */
  getCategoryItem(categoryIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_ITEM, categoryIndex));
  }

  /**
   * Expand a category to show its items
   */
  async expandCategory(categoryIndex: number) {
    const isContentTabActive = await this.categoryAddButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isContentTabActive) {
      await this.switchToContentTab();
    }

    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_NAME_FULL_INPUT, categoryIndex));
    if (await nameInput.count() === 0) {
      const toggleButton = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_TOGGLE_BUTTON, categoryIndex));
      await toggleButton.click();
    }
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  }

  /**
   * Collapse a category by clicking on its header
   */
  async collapseCategory(categoryIndex: number) {
    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_NAME_FULL_INPUT, categoryIndex));
    if (await nameInput.count() > 0) {
      const toggleButton = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_TOGGLE_BUTTON, categoryIndex));
      await toggleButton.click();
    }
    await expect(nameInput).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Update category name
   */
  async updateCategoryName(categoryIndex: number, name: string) {
    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_NAME_FULL_INPUT, categoryIndex));
    await nameInput.fill(name);
  }

  /**
   * Add a menu item to a category
   */
  async addMenuItem(categoryIndex: number) {
    const addItemButton = this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_ADD_BUTTON, categoryIndex));
    await addItemButton.click();
    await this.waitForLoading();
  }

  /**
   * Delete a category by index.
   */
  async deleteCategory(categoryIndex: number) {
    const overflowButton = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_OVERFLOW_BUTTON, categoryIndex));
    await overflowButton.scrollIntoViewIfNeeded();
    await overflowButton.click();

    const overflowMenu = this.page.locator(testIdSelector(TestIds.CATEGORY_OVERFLOW_MENU));
    await expect(overflowMenu).toBeVisible({ timeout: 5000 });

    const deleteButton = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_DELETE_BUTTON, categoryIndex));
    await deleteButton.click();
    await this.waitForLoading();
  }

  /**
   * Delete a menu item by category and item index
   */
  async deleteMenuItem(categoryIndex: number, itemIndex: number) {
    const deleteButton = this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_DELETE_BUTTON, categoryIndex, itemIndex));
    await deleteButton.click();
    await this.waitForLoading();
  }

  /**
   * Get the category name input field
   */
  getCategoryNameInput(categoryIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_NAME_FULL_INPUT, categoryIndex));
  }

  /**
   * Get the menu item name input field
   */
  getMenuItemNameInput(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_NAME_FULL_INPUT, categoryIndex, itemIndex));
  }

  /**
   * Get the menu item description input field
   */
  getMenuItemDescriptionInput(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_DESCRIPTION_INPUT, categoryIndex, itemIndex));
  }

  /**
   * Get the menu item price input field
   */
  getMenuItemPriceInput(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_PRICE_INPUT, categoryIndex, itemIndex));
  }

  /**
   * Count the number of categories in the editor
   */
  async getCategoryCount(): Promise<number> {
    const isContentTabActive = await this.categoryAddButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isContentTabActive) {
      await this.switchToContentTab();
    }
    const categories = this.page.locator(testIdStartsWithSelector(TestIds.CATEGORY_ITEM));
    return await categories.count();
  }

  /**
   * Count the number of items in a category
   */
  async getItemCount(categoryIndex: number): Promise<number> {
    const items = this.page.locator(`[data-testid^="${TestIds.MENU_ITEM}-${categoryIndex}-"]`);
    return await items.count();
  }

  /**
   * Get the value of the category name input
   */
  async getCategoryNameValue(categoryIndex: number): Promise<string> {
    const nameInput = this.getCategoryNameInput(categoryIndex);
    return await nameInput.inputValue();
  }

  /**
   * Get the value of the menu item name input
   */
  async getMenuItemNameValue(categoryIndex: number, itemIndex: number): Promise<string> {
    const nameInput = this.getMenuItemNameInput(categoryIndex, itemIndex);
    return await nameInput.inputValue();
  }

  /**
   * Get the value of the menu item price input
   */
  async getMenuItemPriceValue(categoryIndex: number, itemIndex: number): Promise<string> {
    const priceInput = this.getMenuItemPriceInput(categoryIndex, itemIndex);
    return await priceInput.inputValue();
  }

  /**
   * Get a menu item by category and item index
   */
  getMenuItem(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM, categoryIndex, itemIndex));
  }

  /**
   * Update menu item name
   */
  async updateMenuItemName(categoryIndex: number, itemIndex: number, name: string) {
    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_NAME_FULL_INPUT, categoryIndex, itemIndex));
    await nameInput.fill(name);
  }

  /**
   * Update menu item price
   */
  async updateMenuItemPrice(categoryIndex: number, itemIndex: number, price: string) {
    const priceInput = this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_PRICE_INPUT, categoryIndex, itemIndex));
    await priceInput.fill(price);
  }

  /**
   * Save the menu after editing content
   */
  async saveMenuEditor() {
    const savePromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'PUT',
      { timeout: 15000 }
    ).catch(() => null);

    await this.menuEditorSaveButton.click();
    await savePromise;
    await this.waitForLoading();
  }

  /**
   * Cancel the menu editor without saving
   */
  async cancelMenuEditor() {
    await this.waitForLoading();

    try {
      await expect(this.menuEditorCancelButton).toBeEnabled({ timeout: 5000 });
      await this.menuEditorCancelButton.click();
    } catch {
      await this.page.keyboard.press('Escape');
    }

    await expect(this.menuEditor).not.toBeVisible({ timeout: 5000 });
  }
}
