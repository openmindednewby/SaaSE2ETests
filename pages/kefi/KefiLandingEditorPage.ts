import { expect, type Locator, type Page } from '@playwright/test';

const SHELL_TIMEOUT_MS = 45_000;
const MENU_OPEN_TIMEOUT_MS = 3_000;
const SAVE_TIMEOUT_MS = 30_000;
const MENU_TRIGGERS = '[aria-haspopup]:visible, [aria-expanded="false"]:visible';

export class KefiLandingEditorPage {
  readonly surface: Locator;
  readonly saveButton: Locator;
  readonly publishButton: Locator;
  readonly shareUrl: Locator;
  readonly backButton: Locator;

  constructor(private readonly page: Page) {
    this.surface = page.getByTestId('landing-editor-surface');
    this.saveButton = page.getByTestId('landing-editor-save');
    this.publishButton = page.getByTestId('landing-editor-publish');
    this.shareUrl = page.getByTestId('landing-share-url');
    this.backButton = page.getByTestId('landing-builder-back');
  }

  async goto(webUrl: string): Promise<void> {
    await this.page.goto(`${webUrl}/organizer/landing`, { waitUntil: 'domcontentloaded' });
    await expect(this.surface, 'the landing editor mounted').toBeAttached({ timeout: SHELL_TIMEOUT_MS });
  }

  async openSection(key: string): Promise<void> {
    if (await this.backButton.isVisible()) await this.backButton.click();
    const row = this.page.getByTestId(`landing-builder-section-${key}`);
    await expect(row, `section row ${key}`).toBeVisible({ timeout: SHELL_TIMEOUT_MS });
    await row.click();
  }

  async fill(testId: string, value: string): Promise<void> {
    const field = this.page.getByTestId(testId);
    await field.scrollIntoViewIfNeeded();
    await field.fill(value);
    await expect(field, `${testId} keeps the typed value`).toHaveValue(value);
  }

  async press(testId: string): Promise<void> {
    const target = this.page.getByTestId(testId);
    await target.scrollIntoViewIfNeeded();
    await target.click();
  }

  async save(): Promise<void> {
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/admin/landing-config') && r.request().method() === 'PUT',
      { timeout: SAVE_TIMEOUT_MS },
    );
    await (await this.reveal(this.saveButton, 'Save')).click();
    const resp = await saved;
    expect(resp.status(), `PUT landing-config: ${(await resp.text()).slice(0, 300)}`).toBeLessThan(300);
  }

  async publish(): Promise<{ tenantSlug?: string; jobName?: string }> {
    const posted = this.page.waitForResponse(
      (r) => r.url().includes('/admin/landing-config/publish') && r.request().method() === 'POST',
      { timeout: SAVE_TIMEOUT_MS },
    );
    await (await this.reveal(this.publishButton, 'Publish')).click();
    const resp = await posted;
    expect(resp.status(), `POST publish: ${(await resp.text()).slice(0, 300)}`).toBeLessThan(300);
    return (await resp.json()) as { tenantSlug?: string; jobName?: string };
  }

  async fillIfPresent(testId: string, value: string): Promise<boolean> {
    const field = this.page.getByTestId(testId);
    if ((await field.count()) === 0) return false;
    await this.fill(testId, value);
    return true;
  }

  private async reveal(target: Locator, what: string): Promise<Locator> {
    await target.or(this.page.locator(MENU_TRIGGERS)).first().waitFor({ timeout: SHELL_TIMEOUT_MS });
    if (await target.isVisible()) return target;
    const triggers = this.page.locator(MENU_TRIGGERS);
    const count = await triggers.count();
    for (let i = 0; i < count; i += 1) {
      await triggers.nth(i).click();
      const opened = await target.waitFor({ state: 'visible', timeout: MENU_OPEN_TIMEOUT_MS }).then(() => true, () => false);
      if (opened) return target;
      await this.page.keyboard.press('Escape');
    }
    await expect(target, `${what} is on screen or behind a menu`).toBeVisible();
    return target;
  }
}
