import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class TenantsPage extends BasePage {
  readonly pageHeader: Locator;
  readonly addButton: Locator;
  readonly tenantNameInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeader = page.getByText(/tenants/i);
    this.addButton = page.getByText(/\+ Add/i);
    this.tenantNameInput = page.getByPlaceholder(/name/i).first();
    this.saveButton = page.getByRole('button', { name: /save/i });
    this.cancelButton = page.getByRole('button', { name: /cancel/i });
    this.loadingIndicator = page.locator('[role="progressbar"]');
  }

  /**
   * Navigate to tenants page
   */
  async goto() {
    await super.goto('/tenants');
    await this.waitForLoading();
  }

  /**
   * Create a new tenant
   */
  async createTenant(name: string) {
    // Click add button to open modal
    await this.addButton.scrollIntoViewIfNeeded();
    await this.addButton.click();
    
    // Wait for modal to appear
    const modal = this.page.locator('[role="dialog"], [data-testid="modal"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill tenant name in the modal
    const nameInput = modal.getByPlaceholder(/name/i).first();
    await nameInput.fill(name);

    // Click Save button in the modal and wait for API response
    const saveBtn = modal.getByRole('button', { name: /save|create/i });
    const btnCount = await saveBtn.count();
    console.log(`Debug: Found ${btnCount} matching save/create buttons in modal`);
    
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/tenants') && response.request().method() === 'POST',
      { timeout: 15000 }
    );

    if (btnCount > 1) {
      console.log('Using the last one...');
      await saveBtn.last().click();
    } else {
      await saveBtn.click();
    }

    try {
      const response = await responsePromise;
      if (!response.ok()) {
        const body = await response.text();
        console.warn(`Tenant creation API returned status ${response.status()}: ${body}`);
      }
    } catch {
      console.warn('No API call detected for tenant creation');
    }

    await this.waitForLoading();
    // Wait for modal to disappear
    await expect(modal).not.toBeVisible({ timeout: 5000 }).catch(() => console.warn('Modal did not disappear'));
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if a tenant exists in the list
   */
  async tenantExists(name: string): Promise<boolean> {
    await this.waitForLoading();
    // Use a robust check that actually waits
    const regex = new RegExp(name, 'i');
    const tenantByText = this.page.getByText(regex).first();
    
    return await tenantByText.waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Get tenant row by name
   */
  getTenantRow(name: string): Locator {
    return this.page.locator('[data-testid="tenant-list-item"]').filter({ hasText: name }).first();
  }

  /**
   * Delete a tenant by name
   */
  async deleteTenant(name: string) {
    const row = this.getTenantRow(name);
    await row.scrollIntoViewIfNeeded();

    // Handle confirmation dialog if present (set up before click)
    const dialogHandler = async (dialog: any) => {
      await dialog.accept();
    };
    this.page.once('dialog', dialogHandler);

    await row.getByRole('button', { name: /delete/i }).click({ force: true });

    // Handle web-based confirmation dialog if present (fallback)
    const confirmButton = this.page.getByRole('button', { name: /confirm|yes|ok/i }).last();
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click({ force: true });
    }

    await this.waitForLoading();
    await expect(row).not.toBeVisible({ timeout: 10000 });
  }

  /**
   * Get all tenant names
   */
  async getTenantNames(): Promise<string[]> {
    await this.waitForLoading();
    const items = this.page.locator('[data-testid="tenant-list-item"]');
    const count = await items.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text) names.push(text.trim());
    }
    return names;
  }
}
