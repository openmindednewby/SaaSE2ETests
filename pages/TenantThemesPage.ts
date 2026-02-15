import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class TenantThemesPage extends BasePage {
  readonly pageTitle: Locator;
  readonly placeholderText: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.getByText('Theme Editor').first();
    this.placeholderText = page.getByText('Tenant theme management coming soon.');
  }

  async goto() {
    await super.goto('/tenant-themes');
  }

  async expectPageLoaded() {
    await expect(this.pageTitle).toBeVisible({ timeout: 15000 });
  }

  async expectPlaceholderVisible() {
    await expect(this.placeholderText).toBeVisible();
  }
}
