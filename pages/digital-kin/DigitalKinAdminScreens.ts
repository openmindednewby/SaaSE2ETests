// Page objects for the Digital Kin admin CMS: taxonomy and the contact inbox.
//
// Split out of DigitalKinAdminPage.ts to stay under the 300-line file cap.
// Selectors verified against the running app on 2026-07-22.
import { expect, type Locator, type Page } from '@playwright/test';

/** Taxonomy — master-only writes. */
export class DigitalKinTaxonomyPage {
  readonly page: Page;
  readonly screen: Locator;
  readonly forbidden: Locator;
  readonly newName: Locator;
  readonly createButton: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('taxonomy-screen');
    this.forbidden = page.getByTestId('taxonomy-forbidden');
    this.newName = page.getByTestId('subcategory-new-name');
    this.createButton = page.getByTestId('subcategory-create-button');
    this.table = page.getByTestId('subcategories-table');
  }

  async goto(adminUrl: string): Promise<void> {
    await this.page.goto(`${adminUrl}/taxonomy`, { waitUntil: 'domcontentloaded' });
  }

  deleteButton(subCategoryId: string): Locator {
    return this.page.getByTestId(`subcategory-delete-${subCategoryId}`);
  }
}

/** The contact inbox. */
export class DigitalKinMessagesPage {
  readonly page: Page;
  readonly screen: Locator;
  readonly unhandledFilter: Locator;
  readonly awaitingEmailBanner: Locator;
  readonly empty: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('messages-screen');
    this.unhandledFilter = page.getByTestId('messages-unhandled-filter');
    this.awaitingEmailBanner = page.getByTestId('messages-awaiting-email-banner');
    this.empty = page.getByTestId('messages-empty');
  }

  async goto(adminUrl: string): Promise<void> {
    await this.page.goto(`${adminUrl}/messages`, { waitUntil: 'domcontentloaded' });
    await expect(this.screen).toBeVisible({ timeout: 30_000 });
  }

  card(id: string): Locator {
    return this.page.getByTestId(`message-card-${id}`);
  }
  handledBadge(id: string): Locator {
    return this.page.getByTestId(`message-handled-badge-${id}`);
  }
  awaitingEmail(id: string): Locator {
    return this.page.getByTestId(`message-awaiting-email-${id}`);
  }
  emailed(id: string): Locator {
    return this.page.getByTestId(`message-emailed-${id}`);
  }
  toggle(id: string): Locator {
    return this.page.getByTestId(`message-toggle-${id}`);
  }
}
