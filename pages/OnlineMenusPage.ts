import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

export class OnlineMenusPage extends BasePage {
  readonly pageHeader: Locator;
  readonly menuList: Locator;
  readonly createMenuButton: Locator;
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
   * Get menu card by name
   */
  getMenuCard(name: string): Locator {
    return this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
      has: this.page.locator(testIdSelector(TestIds.MENU_CARD_NAME), { hasText: name }),
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
      const activeCards = this.page.locator(testIdSelector(TestIds.MENU_CARD)).filter({
        has: this.page.locator(statusSelector, { hasText: /active/i })
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
}
