import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector, indexedTestIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

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

  // Preview Modal
  readonly previewModal: Locator;

  // Category Management
  readonly categoryAddButton: Locator;
  readonly categoryList: Locator;

  // Content Upload
  readonly contentUploader: Locator;
  readonly contentUploaderButton: Locator;
  readonly contentPreview: Locator;
  readonly contentPreviewImage: Locator;
  readonly uploadProgressContainer: Locator;

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

    // Menu Editor
    this.menuEditor = page.locator(testIdSelector(TestIds.MENU_EDITOR));
    this.menuNameInput = page.locator(testIdSelector(TestIds.MENU_EDITOR_NAME_INPUT));
    this.menuDescriptionInput = page.locator(testIdSelector(TestIds.MENU_EDITOR_DESCRIPTION_INPUT));
    this.menuEditorSaveButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_SAVE_BUTTON));
    this.menuEditorCancelButton = page.locator(testIdSelector(TestIds.MENU_EDITOR_CANCEL_BUTTON));

    // Preview Modal
    this.previewModal = page.locator(testIdSelector(TestIds.MENU_PREVIEW_MODAL));

    // Category Management
    this.categoryAddButton = page.locator(testIdSelector(TestIds.CATEGORY_ADD_BUTTON));
    this.categoryList = page.locator(testIdSelector(TestIds.CATEGORY_LIST));

    // Content Upload
    this.contentUploader = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER));
    this.contentUploaderButton = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    this.contentPreview = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    this.contentPreviewImage = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    this.uploadProgressContainer = page.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_CONTAINER));
  }

  /**
   * Navigate to online menus page
   */
  async goto() {
    await super.goto('/menus');
    await this.waitForLoading();
  }

  /**
   * Force a fresh fetch of the menus list (helps when React Query cache is stale).
   */
  async refetchMenusList() {
    await this.waitForLoading();

    const listFetch = this.page.waitForResponse(
      (response) => response.url().includes('/TenantMenus') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    await this.page.reload({ waitUntil: 'commit' });
    await this.waitForLoading();
    await listFetch;
  }

  /**
   * Click the refresh button to reload the menus list.
   * Uses the new refresh button in the page header for a more targeted refresh
   * without a full page reload.
   */
  async refresh() {
    await this.waitForLoading();

    // Set up listener for the API call
    const listFetch = this.page.waitForResponse(
      (response) => response.url().includes('/TenantMenus') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    // Click the refresh button
    await this.refreshButton.click();

    // Wait for loading indicator to appear and disappear
    await this.waitForLoading();

    // Wait for the API response
    await listFetch;
  }

  /**
   * Create a new menu (optimized - no redundant waits)
   */
  async createMenu(name: string, description: string = '') {
    // Click create button
    await this.createMenuButton.click();

    // Wait for editor to appear
    await this.menuEditor.waitFor({ state: 'visible', timeout: 5000 });

    // Fill name
    await this.menuNameInput.fill(name);

    if (description) {
      await this.menuDescriptionInput.fill(description);
    }

    // Click Save button and wait for API response
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'POST',
      { timeout: 15000 }
    ).catch(() => null);

    await this.menuEditorSaveButton.click();

    const response = await responsePromise;
    if (response) {
      if (response.ok()) {
        console.log(`Menu "${name}" created successfully.`);
      } else {
        console.warn(`Menu creation API returned status ${response.status()}`);
      }
    } else {
      console.warn('No POST /TenantMenus API call detected for menu creation');
    }

    // React Query auto-invalidates - just wait for loading indicator to clear
    await this.waitForLoading();
  }

  /**
   * Get menu card by exact name match
   * Uses regex with ^ and $ anchors to ensure exact match
   */
  getMenuCard(name: string): Locator {
    // Escape special regex characters in the menu name
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use regex with anchors for exact match to avoid "Active Menu" matching "Inactive Menu"
    const exactRegex = new RegExp(`^${escapedName}$`);
    return this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
      has: this.page.locator(testIdSelector(TestIds.MENU_CARD_NAME), { hasText: exactRegex }),
    }).first();
  }

  /**
   * Check if a menu exists in the list
   */
  async menuExists(name: string): Promise<boolean> {
    await this.waitForLoading();
    const menu = this.getMenuCard(name);
    return await menu.waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Expect menu to be visible in the list
   */
  async expectMenuInList(name: string) {
    const menu = this.getMenuCard(name);
    await expect(menu).toBeVisible({ timeout: 10000 });
  }

  /**
   * Expect menu to not be in the list
   */
  async expectMenuNotInList(name: string) {
    const menus = this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
      has: this.page.locator(testIdSelector(TestIds.MENU_CARD_NAME), { hasText: name }),
    });
    await expect(menus).toHaveCount(0, { timeout: 10000 });
  }

  /**
   * Click edit button for a menu
   */
  async editMenu(name: string) {
    const card = this.getMenuCard(name);
    await card.scrollIntoViewIfNeeded();

    const editBtn = card.locator(testIdSelector(TestIds.MENU_CARD_EDIT_BUTTON));
    await editBtn.click();

    // Wait for editor to appear
    await this.menuEditor.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Click delete button for a menu
   * @param throwOnError - If false, won't throw on API errors (useful for cleanup)
   */
  async deleteMenu(name: string, throwOnError: boolean = true) {
    const card = this.getMenuCard(name);
    await card.scrollIntoViewIfNeeded();

    // Set up response listener for delete API call
    const deletePromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'DELETE',
      { timeout: 15000 }
    ).catch(() => null);

    const deleteBtn = card.locator(testIdSelector(TestIds.MENU_CARD_DELETE_BUTTON));
    await deleteBtn.click();

    // Handle confirmation dialog if present
    const dialog = this.page.locator('[role="dialog"]');
    if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      const dialogConfirm = dialog.getByRole('button', { name: /confirm|ok|yes|delete/i }).last();
      if (await dialogConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialogConfirm.click({ timeout: 5000 }).catch(() => {});
      }
    }

    // Wait for the delete API call to complete
    const response = await deletePromise;
    if (response) {
      if (response.status() === 404) {
        console.warn(`Menu deletion API returned 404 for "${name}" (already removed?).`);
      } else if (!response.ok()) {
        const errorMsg = `Menu deletion API returned status ${response.status()}`;
        if (throwOnError) {
          throw new Error(errorMsg);
        } else {
          console.warn(errorMsg);
        }
      } else {
        console.log(`Menu "${name}" deleted successfully.`);
      }
    } else {
      console.warn('No DELETE /TenantMenus API call detected, but continuing check...');
    }

    // Wait for UI to update
    await this.waitForLoading();

    // Wait for the list to refetch
    await this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'GET',
      { timeout: 10000 }
    ).catch(() => null);

    // Wait for the item to disappear using expect with retry
    try {
      await this.expectMenuNotInList(name);
    } catch {
      if (throwOnError) {
        throw new Error(`Menu "${name}" still visible after deletion`);
      }
      console.warn(`Menu "${name}" still visible after deletion attempt`);
    }
  }

  /**
   * Click activate button for a menu
   */
  async activateMenu(name: string): Promise<boolean> {
    const card = this.getMenuCard(name);
    await card.scrollIntoViewIfNeeded();

    // Get current status before clicking
    const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
    const statusBefore = (await statusBadge.textContent().catch(() => '')) || '';
    const wasActive = statusBefore.toLowerCase() === 'active';
    console.log(`Menu "${name}" status before: "${statusBefore}" (wasActive: ${wasActive})`);

    // Listen for console errors
    const consoleErrors: string[] = [];
    const errorListener = (msg: any) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    };
    this.page.on('console', errorListener);

    // Set up response listener for activate endpoint
    const apiPromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.url().includes('/activate') && response.request().method() === 'PATCH',
      { timeout: 15000 }
    ).catch(() => null);

    const activateBtn = card.locator(testIdSelector(TestIds.MENU_CARD_ACTIVATE_BUTTON));

    // Verify button is visible before clicking
    const isVisible = await activateBtn.isVisible().catch(() => false);
    console.log(`Activate button visible: ${isVisible}`);
    if (!isVisible) {
      console.warn(`Activate button not visible for menu "${name}"`);
      this.page.off('console', errorListener);
      return false;
    }

    await activateBtn.click();
    console.log(`Clicked activate button for menu "${name}"`);

    // Wait for the API call to complete
    const response = await apiPromise;
    let apiSuccess = false;

    this.page.off('console', errorListener);

    if (consoleErrors.length > 0) {
      console.warn(`Console errors detected after clicking activate: ${consoleErrors.join(', ')}`);
    }

    if (response) {
      if (response.ok()) {
        console.log(`Menu "${name}" activated successfully.`);
        apiSuccess = true;
      } else {
        const responseBody = await response.text().catch(() => '');
        console.warn(`Menu activation API returned status ${response.status()}: ${responseBody}`);
      }
    } else {
      console.warn('No PATCH /TenantMenus/{id}/activate API call detected');
    }

    // React Query auto-invalidates - just wait for loading indicator to clear
    await this.waitForLoading();

    // Wait for status to change using web-first assertion (auto-retries for 5s)
    if (apiSuccess) {
      await expect(statusBadge).toHaveText(/active/i, { timeout: 5000 }).catch(() => {
        console.log(`Menu "${name}" status did not change to active`);
      });
    }

    return apiSuccess;
  }

  /**
   * Click deactivate button for a menu
   */
  async deactivateMenu(name: string): Promise<boolean> {
    const card = this.getMenuCard(name);
    await card.scrollIntoViewIfNeeded();

    // Get current status before clicking
    const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
    const statusBefore = (await statusBadge.textContent().catch(() => '')) || '';
    const wasActive = statusBefore.toLowerCase() === 'active';
    console.log(`Menu "${name}" status before: "${statusBefore}" (wasActive: ${wasActive})`);

    // Set up response listener for deactivate endpoint
    const apiPromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.url().includes('/deactivate') && response.request().method() === 'PATCH',
      { timeout: 15000 }
    ).catch(() => null);

    const deactivateBtn = card.locator(testIdSelector(TestIds.MENU_CARD_DEACTIVATE_BUTTON));

    // Verify button is visible before clicking
    const isVisible = await deactivateBtn.isVisible().catch(() => false);
    console.log(`Deactivate button visible: ${isVisible}`);
    if (!isVisible) {
      console.warn(`Deactivate button not visible for menu "${name}"`);
      return false;
    }

    await deactivateBtn.click();
    console.log(`Clicked deactivate button for menu "${name}"`);

    // Wait for the API call to complete
    const response = await apiPromise;
    let apiSuccess = false;

    if (response) {
      if (response.ok()) {
        console.log(`Menu "${name}" deactivated successfully.`);
        apiSuccess = true;
      } else {
        const responseBody = await response.text().catch(() => '');
        console.warn(`Menu deactivation API returned status ${response.status()}: ${responseBody}`);
      }
    } else {
      console.warn('No PATCH /TenantMenus/{id}/deactivate API call detected');
    }

    // React Query auto-invalidates - just wait for loading indicator to clear
    await this.waitForLoading();

    // Wait for status to change using web-first assertion (auto-retries for 5s)
    if (apiSuccess) {
      await expect(statusBadge).toHaveText(/inactive/i, { timeout: 5000 }).catch(() => {
        console.log(`Menu "${name}" status did not change to inactive`);
      });
    }

    return apiSuccess;
  }

  /**
   * Check if menu is active
   */
  async isMenuActive(name: string): Promise<boolean> {
    const card = this.getMenuCard(name);
    const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
    const statusText = (await statusBadge.textContent().catch(() => '')) || '';

    const normalized = statusText.toLowerCase().trim();
    return normalized === 'active';
  }

  /**
   * Expect menu to have specific active status
   */
  async expectMenuActive(name: string, active: boolean = true) {
    const expected = active ? /active/i : /inactive/i;

    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.waitForLoading();
      const card = this.getMenuCard(name);
      const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));

      try {
        await expect(statusBadge).toHaveText(expected, { timeout: 10000 });
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        console.log(`expectMenuActive: "${name}" not "${active ? 'active' : 'inactive'}" yet, refetching list (attempt ${attempt})...`);
        await this.refetchMenusList();
      }
    }
  }

  /**
   * Get status text for a menu
   */
  async getMenuStatus(name: string): Promise<string> {
    const card = this.getMenuCard(name);
    const statusBadge = card.locator(testIdSelector(TestIds.MENU_CARD_STATUS_BADGE));
    return (await statusBadge.textContent().catch(() => '')) || '';
  }

  /**
   * Get all menu names
   */
  async getMenuNames(): Promise<string[]> {
    await this.waitForLoading();
    const cards = this.page.locator(testIdSelector(TestIds.MENU_CARD));
    await cards.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});

    const count = await cards.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const nameElement = card.locator(testIdSelector(TestIds.MENU_CARD_NAME));
      const text = await nameElement.textContent({ timeout: 1000 }).catch(() => null);
      if (text) {
        names.push(text.trim());
      }
    }
    return names;
  }

  /**
   * Deactivate all menus that are currently active.
   * Useful when a test needs to start from a clean state with no active menus.
   */
  async deactivateAllMenus() {
    await this.page.reload({ waitUntil: 'commit' });
    await this.waitForLoading();

    const statusSelector = testIdSelector(TestIds.MENU_CARD_STATUS_BADGE);
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;
      // Use exact match for "Active" to avoid matching "Inactive"
      const activeCards = this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
        has: this.page.locator(statusSelector, { hasText: /^Active$/i })
      });

      const count = await activeCards.count();
      console.log(`deactivateAllMenus: Found ${count} active menus (attempt ${attempts})`);

      if (count === 0) {
        break;
      }

      const card = activeCards.first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      const menuName = await card.locator(testIdSelector(TestIds.MENU_CARD_NAME)).textContent().catch(() => 'unknown');
      console.log(`Deactivating menu: ${menuName}`);

      // Set up response listener
      const apiPromise = this.page.waitForResponse(
        response => response.url().includes('/TenantMenus') && response.url().includes('/deactivate') && response.request().method() === 'PATCH',
        { timeout: 10000 }
      ).catch(() => null);

      const deactivateButton = card.locator(testIdSelector(TestIds.MENU_CARD_DEACTIVATE_BUTTON));

      if (await deactivateButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await deactivateButton.click();
      } else {
        console.warn('Active menu detected but deactivate button is not visible, refreshing...');
        await this.page.reload({ waitUntil: 'commit' });
        await this.waitForLoading();
        continue;
      }

      // Wait for API response
      const response = await apiPromise;
      if (response?.ok()) {
        console.log(`Deactivated menu: ${menuName}`);
      } else {
        console.warn(`Failed to deactivate menu: ${menuName}, status: ${response?.status()}`);
      }

      // Just wait for loading - React Query auto-invalidates
      await this.waitForLoading();
    }

    if (attempts >= maxAttempts) {
      console.warn(`deactivateAllMenus: Reached max attempts (${maxAttempts}), some menus may still be active`);
    }
  }

  /**
   * Click preview button for a menu to open the preview modal
   */
  async openPreview(name: string) {
    const card = this.getMenuCard(name);
    await card.scrollIntoViewIfNeeded();

    const previewBtn = card.locator(testIdSelector(TestIds.MENU_CARD_PREVIEW_BUTTON));
    await previewBtn.click();

    // Wait for preview modal to appear
    await expect(this.previewModal).toBeVisible({ timeout: 5000 });
  }

  /**
   * Close the preview modal
   */
  async closePreview() {
    // Look for close button within the modal (could be X button or Close text)
    const closeButton = this.previewModal.getByRole('button', { name: /close|cancel|x/i }).first();

    // Check if there's a visible close button
    if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeButton.click();
    } else {
      // Try clicking outside the modal or pressing Escape
      await this.page.keyboard.press('Escape');
    }

    // Wait for modal to disappear
    await expect(this.previewModal).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Expect the preview modal to be visible
   */
  async expectPreviewModalVisible() {
    await expect(this.previewModal).toBeVisible({ timeout: 5000 });
  }

  /**
   * Expect the preview modal to not be visible
   */
  async expectPreviewModalNotVisible() {
    await expect(this.previewModal).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Get the preview button for a menu
   */
  getPreviewButton(name: string): Locator {
    const card = this.getMenuCard(name);
    return card.locator(testIdSelector(TestIds.MENU_CARD_PREVIEW_BUTTON));
  }

  /**
   * Get the open external link button for a menu
   */
  getOpenExternalButton(name: string): Locator {
    const card = this.getMenuCard(name);
    return card.locator(testIdSelector(TestIds.MENU_CARD_OPEN_EXTERNAL_BUTTON));
  }

  /**
   * Check if the open external button is enabled/clickable for a menu
   */
  async isOpenExternalButtonEnabled(name: string): Promise<boolean> {
    const openExternalBtn = this.getOpenExternalButton(name);

    // Check if button exists and is enabled
    const isEnabled = await openExternalBtn.isEnabled({ timeout: 1000 }).catch(() => false);
    return isEnabled;
  }

  /**
   * Click open external button for a menu and return the new page that opens
   * Returns the new page/tab if successful, null if it didn't open
   */
  async openExternalLink(name: string): Promise<Page | null> {
    const card = this.getMenuCard(name);
    await card.scrollIntoViewIfNeeded();

    const openExternalBtn = card.locator(testIdSelector(TestIds.MENU_CARD_OPEN_EXTERNAL_BUTTON));

    // Check if button is enabled
    const isEnabled = await openExternalBtn.isEnabled({ timeout: 1000 }).catch(() => false);
    if (!isEnabled) {
      console.log(`Open external button is disabled for menu "${name}"`);
      return null;
    }

    // Listen for new page/tab to open
    const pagePromise = this.page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);

    await openExternalBtn.click();

    const newPage = await pagePromise;

    if (newPage) {
      // Wait for the new page to load
      await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      console.log(`New tab opened with URL: ${newPage.url()}`);
    } else {
      console.warn(`No new tab opened when clicking open external for menu "${name}"`);
    }

    return newPage;
  }

  /**
   * Get the external ID of a menu from its card (if available)
   */
  async getMenuExternalId(name: string): Promise<string | null> {
    const card = this.getMenuCard(name);
    const idElement = card.locator(testIdSelector(TestIds.MENU_CARD_ID));

    // Try to get the ID from the card
    const idText = await idElement.textContent({ timeout: 1000 }).catch(() => null);
    return idText?.trim() || null;
  }

  // ==================== MENU CONTENT EDITOR METHODS ====================

  /**
   * Switch to the Content tab in the menu editor (FullMenuEditor).
   * The editor opens on the "Details" tab by default, so we need to click
   * the "Content" tab to access categories and items.
   */
  async switchToContentTab() {
    // Find the Content tab button by its text
    const contentTab = this.menuEditor.getByRole('tab', { name: /content/i });
    await contentTab.click();
    // Wait for the category add button to be visible (indicates we're on the Content tab)
    await expect(this.categoryAddButton).toBeVisible({ timeout: 5000 });
  }

  /**
   * Add a new category to the menu
   */
  async addCategory() {
    // Ensure we're on the Content tab first
    const isContentTabActive = await this.categoryAddButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isContentTabActive) {
      await this.switchToContentTab();
    }
    await this.categoryAddButton.click();
    // Wait for the category to appear in the list
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
    // Ensure we're on the Content tab first
    const isContentTabActive = await this.categoryAddButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isContentTabActive) {
      await this.switchToContentTab();
    }

    const category = this.getCategoryItem(categoryIndex);
    // Click on the category header to expand it
    const categoryHeader = category.locator('text=/Category|Item/i').first();
    // Check if already expanded by looking for input fields
    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_NAME_INPUT, categoryIndex));
    if (await nameInput.count() === 0) {
      await categoryHeader.click();
    }
    // Wait for the expansion animation
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  }

  /**
   * Update category name
   */
  async updateCategoryName(categoryIndex: number, name: string) {
    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_NAME_INPUT, categoryIndex));
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
   * Get a menu item by category and item index
   */
  getMenuItem(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM, categoryIndex, itemIndex));
  }

  /**
   * Update menu item name
   */
  async updateMenuItemName(categoryIndex: number, itemIndex: number, name: string) {
    const nameInput = this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_NAME_INPUT, categoryIndex, itemIndex));
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
   * Get the image picker wrapper for a menu item
   */
  getMenuItemImagePicker(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_IMAGE_PICKER, categoryIndex, itemIndex));
  }

  /**
   * Get the video picker wrapper for a menu item
   */
  getMenuItemVideoPicker(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_VIDEO_PICKER, categoryIndex, itemIndex));
  }

  /**
   * Get the document picker wrapper for a menu item
   */
  getMenuItemDocumentPicker(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_DOCUMENT_PICKER, categoryIndex, itemIndex));
  }

  /**
   * Get the image picker wrapper for a category
   */
  getCategoryImagePicker(categoryIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_IMAGE_PICKER, categoryIndex));
  }

  /**
   * Upload an image to a menu item
   * Uses file chooser to handle the native file picker
   */
  async uploadImageToMenuItem(categoryIndex: number, itemIndex: number, filePath: string) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);

    // Find the upload button within the image picker wrapper
    const uploadButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    await expect(uploadButton).toBeVisible({ timeout: 5000 });

    // Set up the file chooser promise before clicking
    const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 10000 });

    // Click the upload button
    await uploadButton.click();

    // Handle the file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    // Wait for upload to complete (progress bar disappears and preview appears)
    const progressBar = imagePicker.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_CONTAINER));

    // Wait for progress bar to disappear (if it appeared)
    if (await progressBar.count() > 0) {
      await expect(progressBar).not.toBeVisible({ timeout: 30000 });
    }

    // Wait for the content preview to appear
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 10000 });
  }

  /**
   * Upload an image to a category
   */
  async uploadImageToCategory(categoryIndex: number, filePath: string) {
    const imagePicker = this.getCategoryImagePicker(categoryIndex);

    // Find the upload button within the image picker wrapper
    const uploadButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));

    // Set up the file chooser promise before clicking
    const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 10000 });

    // Click the upload button
    await uploadButton.click();

    // Handle the file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    // Wait for upload to complete
    const progressBar = imagePicker.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_CONTAINER));

    if (await progressBar.count() > 0) {
      await expect(progressBar).not.toBeVisible({ timeout: 30000 });
    }

    // Wait for the content preview to appear
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify that an image preview is visible for a menu item
   */
  async expectMenuItemImageVisible(categoryIndex: number, itemIndex: number) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 10000 });

    // Also verify the image element is present
    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    await expect(imageElement).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify that an image preview is visible for a category
   */
  async expectCategoryImageVisible(categoryIndex: number) {
    const imagePicker = this.getCategoryImagePicker(categoryIndex);
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 10000 });

    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    await expect(imageElement).toBeVisible({ timeout: 10000 });
  }

  /**
   * Delete an uploaded image from a menu item
   */
  async deleteMenuItemImage(categoryIndex: number, itemIndex: number) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const deleteButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_DELETE_BUTTON));
    await deleteButton.click();

    // Wait for preview to disappear and upload button to appear
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).not.toBeVisible({ timeout: 5000 });

    const uploadButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    await expect(uploadButton).toBeVisible({ timeout: 5000 });
  }

  /**
   * Save the menu after editing content
   */
  async saveMenuEditor() {
    // Set up listener for the PUT API call
    const savePromise = this.page.waitForResponse(
      response => response.url().includes('/TenantMenus') && response.request().method() === 'PUT',
      { timeout: 15000 }
    ).catch(() => null);

    await this.menuEditorSaveButton.click();

    const response = await savePromise;
    if (response) {
      if (response.ok()) {
        console.log('Menu saved successfully');
      } else {
        console.warn(`Menu save API returned status ${response.status()}`);
      }
    }

    await this.waitForLoading();
  }

  /**
   * Cancel the menu editor without saving
   */
  async cancelMenuEditor() {
    await this.menuEditorCancelButton.click();
    await expect(this.menuEditor).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Get the image URL from a menu item's content preview
   * Useful for verifying CORS by checking if the image loaded
   */
  async getMenuItemImageUrl(categoryIndex: number, itemIndex: number): Promise<string | null> {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));

    if (await imageElement.count() === 0) {
      return null;
    }

    // Get the src attribute from the image
    const src = await imageElement.getAttribute('src');
    return src;
  }

  /**
   * Verify image loads successfully (no CORS errors)
   * This checks if the image's naturalWidth is > 0, which indicates it loaded
   */
  async expectImageLoaded(categoryIndex: number, itemIndex: number) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));

    await expect(imageElement).toBeVisible({ timeout: 10000 });

    // Check that the image actually loaded by verifying naturalWidth > 0
    // A CORS error would result in naturalWidth being 0
    await expect(async () => {
      const naturalWidth = await imageElement.evaluate((img: HTMLImageElement) => img.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
  }

  /**
   * Verify images load in the preview modal (catches CORS issues)
   */
  async expectPreviewImagesLoaded() {
    await expect(this.previewModal).toBeVisible({ timeout: 5000 });

    // Find all images in the preview modal
    const images = this.previewModal.locator('img');
    const count = await images.count();

    // If there are images, verify they loaded
    for (let i = 0; i < count; i++) {
      const image = images.nth(i);
      await expect(async () => {
        const naturalWidth = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
        expect(naturalWidth).toBeGreaterThan(0);
      }).toPass({ timeout: 10000 });
    }
  }
}
