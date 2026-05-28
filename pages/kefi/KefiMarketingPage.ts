/**
 * Page Object for the Kefi marketing site signup form (`/signup`). Wraps
 * the three input fields + ToS checkbox + submit button. Assertions
 * belong in the spec; this PO only exposes locators + thin actions.
 */

import { type Locator, type Page, expect } from '@playwright/test';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';

export class KefiMarketingPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly tenantNameInput: Locator;
  readonly tosCheckbox: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('#signup-email');
    this.passwordInput = page.locator('#signup-password');
    this.tenantNameInput = page.locator('#signup-tenant-name');
    this.tosCheckbox = page.locator('#signup-tos');
    this.submitButton = page.locator('#signup-submit');
    this.errorMessage = page.locator('#signup-error');
  }

  async goto(): Promise<void> {
    const { marketingUrl } = getKefiUrls();
    await this.page.goto(`${marketingUrl}/signup`);
    await expect(this.emailInput).toBeVisible();
  }

  async fillSignupForm(input: {
    email: string;
    password: string;
    tenantName: string;
  }): Promise<void> {
    await this.emailInput.fill(input.email);
    await this.passwordInput.fill(input.password);
    await this.tenantNameInput.fill(input.tenantName);
    await this.tosCheckbox.check();
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async signupAndExpectSuccess(input: {
    email: string;
    password: string;
    tenantName: string;
  }): Promise<void> {
    await this.fillSignupForm(input);
    await Promise.all([
      this.page.waitForURL(/\/signup-success\/?$/),
      this.submit(),
    ]);
  }
}
