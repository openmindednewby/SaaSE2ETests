import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class UsersPage extends BasePage {
  readonly pageHeader: Locator;
  readonly addButton: Locator;
  readonly usernameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeader = page.getByText(/user management/i);
    this.addButton = page.getByText(/\+ Add User/i);
    this.usernameInput = page.getByPlaceholder(/enter username/i);
    this.emailInput = page.getByPlaceholder(/user@example.com/i);
    this.passwordInput = page.getByPlaceholder(/enter password/i);
    this.saveButton = page.getByRole('button', { name: /create/i });
    this.cancelButton = page.getByRole('button', { name: /cancel/i });
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to users page
   */
  async goto() {
    await super.goto('/users');
    await this.waitForLoading();
  }

  /**
   * Select a tenant from the tenant selector
   */
  async selectTenant(tenantName: string) {
    const tenantButton = this.page.getByRole('button', { name: tenantName });
    if (await tenantButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tenantButton.click();
      await this.waitForLoading();
    } else {
      // Try clicking on text directly
      const tenantText = this.page.getByText(tenantName, { exact: true });
      if (await tenantText.isVisible()) {
        await tenantText.click();
        await this.waitForLoading();
      }
    }
  }

  /**
   * Create a new user with the specified parameters
   */
  async createUser(options: {
    username: string;
    email?: string;
    password: string;
    firstName?: string;
    lastName?: string;
    tenantName: string;
    roles: string[];
  }) {
    // Click add button to open modal
    await this.addButton.click();

    // Wait for modal to appear
    const modal = this.page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Select tenant in the form
    const tenantButton = modal.getByText(options.tenantName, { exact: true });
    if (await tenantButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tenantButton.click();
    }

    // Fill username
    const usernameInput = modal.getByPlaceholder(/enter username/i);
    await usernameInput.fill(options.username);

    // Fill email if provided
    if (options.email) {
      const emailInput = modal.getByPlaceholder(/user@example.com/i);
      await emailInput.fill(options.email);
    }

    // Fill password
    const passwordInput = modal.getByPlaceholder(/enter password/i);
    await passwordInput.fill(options.password);

    // Fill first name if provided
    if (options.firstName) {
      const firstNameInput = modal.getByPlaceholder(/john/i);
      await firstNameInput.fill(options.firstName);
    }

    // Fill last name if provided
    if (options.lastName) {
      const lastNameInput = modal.getByPlaceholder(/doe/i);
      await lastNameInput.fill(options.lastName);
    }

    // Select roles
    for (const role of options.roles) {
      const roleButton = modal.getByText(role, { exact: true });
      if (await roleButton.isVisible()) {
        await roleButton.click();
      }
    }

    // Click Create button and wait for API response
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/users') && response.request().method() === 'POST',
      { timeout: 15000 }
    ).catch(() => null);

    // Try multiple ways to find the create button - be more specific to avoid clicking other text
    const createButton = modal.getByRole('button', { name: /create/i });
    if (await createButton.isVisible()) {
      await createButton.click();
    } else {
      // Fallback to text click if role button not found (React Native Web sometimes doesn't map roles perfectly)
      await modal.locator('text=/^Create$/i').first().click();
    }

    const response = await responsePromise;
    if (response) {
      if (!response.ok()) {
        const errorText = await response.text();
        console.warn(`User creation API returned status ${response.status()}: ${errorText}`);
      }
    } else {
      console.warn('No API call detected for user creation within timeout');
    }

    // Wait for modal to disappear (this is crucial)
    await expect(modal).not.toBeVisible({ timeout: 10000 }).catch(async () => {
      console.warn('Modal did not disappear after clicking Create. checking for error messages...');
      const errorMsg = this.page.locator('[data-testid="error-message"], .error-text, text=/error|failed/i').first();
      if (await errorMsg.isVisible()) {
        const text = await errorMsg.textContent();
        throw new Error(`User creation failed with error: ${text}`);
      }
      // If no error message but modal still there, try clicking outside or cancel? 
      // Better to throw so we know it's stuck.
      throw new Error('User creation modal did not disappear and no error message found.');
    });

    await this.waitForLoading();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if a user exists in the list
   */
  async userExists(username: string): Promise<boolean> {
    await this.waitForLoading();
    // Use a more robust check that actually waits
    const user = this.page.getByText(`@${username}`, { exact: false });
    return await user.waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Get user row by username
   */
  getUserRow(username: string): Locator {
    return this.page.locator('[data-testid="user-item"]').filter({ hasText: username }).first();
  }

  /**
   * Delete a user by username
   */
  async deleteUser(username: string) {
    const row = this.getUserRow(username);
    await row.scrollIntoViewIfNeeded();

    // Handle confirmation dialog if present
    // The app uses window.confirm for delete confirmation
    // MUST set up before click
    this.page.once('dialog', async dialog => {
      try {
        await dialog.accept();
      } catch {
        // Can happen if another handler already accepted the dialog
      }
    });

    const deletePromise = this.page.waitForResponse(
      resp => resp.request().method() === 'DELETE' && /\/api\/users\b/i.test(resp.url()),
      { timeout: 15000 }
    ).catch(() => null);

    await row.getByRole('button', { name: /delete/i }).click({ force: true });

    const response = await deletePromise;
    if (response && !response.ok()) {
      console.warn(`User deletion API returned status ${response.status()}`);
    }

    await this.waitForLoading();

    // Sometimes the list doesn't re-render immediately; retry once after a refresh.
    const hidden = await row.isVisible({ timeout: 5000 }).then(v => !v).catch(() => false);
    if (!hidden) {
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await this.waitForLoading();
    }
    await expect(row).not.toBeVisible({ timeout: 15000 });
  }

  /**
   * Get all user usernames visible in the list
   */
  async getUsernames(): Promise<string[]> {
    await this.waitForLoading();
    // Wait for at least one item to be sure they are loaded
    const items = this.page.locator('[data-testid="user-item"]');
    await items.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    
    const count = await items.count();
    const usernames: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text) {
        // Extract username from "@username" format
        const match = text.match(/@(\S+)/);
        if (match) {
          usernames.push(match[1]);
        } else {
          usernames.push(text.trim());
        }
      }
    }
    return usernames;
  }
}
