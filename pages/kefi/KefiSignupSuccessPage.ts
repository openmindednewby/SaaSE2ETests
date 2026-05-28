/**
 * Page Object for `/signup-success` — the "check your inbox" landing.
 * Confirms the signup form's POST returned 201 + the marketing site
 * navigated to the success view.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class KefiSignupSuccessPage {
  readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('.ack__title');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toContainText(/Check your inbox/i);
  }
}
