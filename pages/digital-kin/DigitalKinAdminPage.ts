// Page objects for the Digital Kin admin CMS.
//
// 🔴 EVERY selector here was read off the RUNNING app at
// https://admin.digitalkin.dloizides.com on 2026-07-22, not inferred from
// source. Three of them differ from what the source suggests, because the
// shared themed <Select> renders an extra trigger node:
//   guide-new-category        -> guide-new-category-trigger
//   guide-difficulty-select   -> guide-difficulty-select-trigger
//   subcategory-new-category  -> subcategory-new-category-trigger
// A spec written from the source alone matches nothing, and a `getByTestId`
// that matches nothing inside a `test.skip(...)` guard reports GREEN.
import { expect, type Locator, type Page } from '@playwright/test';

/** Signs in through the real form. Never bypasses the UI — the BFF sets an httpOnly cookie. */
export class DigitalKinLoginPage {
  readonly page: Page;
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.page = page;
    this.username = page.getByTestId('digitalkin-auth-login-username');
    this.password = page.getByTestId('digitalkin-auth-login-password');
    this.submit = page.getByTestId('digitalkin-auth-login-submit');
    this.error = page.getByTestId('digitalkin-auth-login-error');
  }

  async goto(adminUrl: string): Promise<void> {
    await this.page.goto(`${adminUrl}/login`, { waitUntil: 'domcontentloaded' });
    await expect(this.submit, 'the login form never rendered').toBeVisible({ timeout: 30_000 });
  }

  /**
   * Signs in and waits for the guides list.
   *
   * The wait is on the URL, not the button click: on success the app re-reads
   * /bff/me and only then routes. A click-and-continue races that.
   */
  async signIn(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
    await this.page.waitForURL(/\/guides$/, { timeout: 45_000 });
  }
}

/** The persistent shell: nav + sign out. Role-dependent. */
export class DigitalKinShell {
  readonly page: Page;
  readonly navGuides: Locator;
  readonly navTaxonomy: Locator;
  readonly navPages: Locator;
  readonly navResources: Locator;
  readonly navMessages: Locator;
  readonly signOut: Locator;

  constructor(page: Page) {
    this.page = page;
    this.navGuides = page.getByTestId('nav-guides');
    this.navTaxonomy = page.getByTestId('nav-taxonomy');
    this.navPages = page.getByTestId('nav-pages');
    this.navResources = page.getByTestId('nav-resources');
    this.navMessages = page.getByTestId('nav-messages');
    this.signOut = page.getByTestId('digitalkin-sign-out');
  }
}

/**
 * The guides list.
 *
 * ⚠️ expo-router keeps the PREVIOUS screen mounted, so `guides-screen` and its
 * table rows are still in the DOM while the editor is open. Anything here that
 * could also match on the editor route is scoped inside `guides-screen`.
 */
export class DigitalKinGuidesPage {
  readonly page: Page;
  readonly screen: Locator;
  readonly newTitle: Locator;
  readonly createButton: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('guides-screen');
    this.newTitle = this.screen.getByTestId('guide-new-title');
    this.createButton = this.screen.getByTestId('guide-create-button');
    this.table = this.screen.getByTestId('guides-table');
  }

  async goto(adminUrl: string): Promise<void> {
    await this.page.goto(`${adminUrl}/guides`, { waitUntil: 'domcontentloaded' });
    await expect(this.screen).toBeVisible({ timeout: 30_000 });
  }

  /** Creates a draft guide and lands on its editor. Returns the new guide id. */
  async createGuide(title: string): Promise<string> {
    await this.newTitle.fill(title);
    await expect(this.createButton, 'create stayed disabled after typing a title').toBeEnabled();
    await this.createButton.click();
    await this.page.waitForURL(/\/guides\/[0-9a-f-]{36}$/, { timeout: 45_000 });
    return this.page.url().split('/').pop() ?? '';
  }

  row(guideId: string): Locator {
    return this.page.getByTestId(`guides-table-row-${guideId}`);
  }

  statusCell(guideId: string): Locator {
    return this.page.getByTestId(`guides-table-row-${guideId}-status`);
  }

  stepsCell(guideId: string): Locator {
    return this.page.getByTestId(`guides-table-row-${guideId}-steps`);
  }
}

/** The guide editor — steps, reordering, media, publish. */
export class DigitalKinGuideEditorPage {
  readonly page: Page;
  readonly screen: Locator;
  readonly slug: Locator;
  readonly titleInput: Locator;
  readonly introInput: Locator;
  readonly addStep: Locator;
  readonly saveButton: Locator;
  readonly publishPanel: Locator;
  readonly publishButton: Locator;
  readonly publishBlockers: Locator;
  readonly unpublishButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteConfirmYes: Locator;
  readonly unsavedWarning: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('guide-editor-screen');
    this.slug = page.getByTestId('guide-slug');
    this.titleInput = page.getByTestId('guide-title-input');
    this.introInput = page.getByTestId('guide-intro-input');
    this.addStep = page.getByTestId('guide-add-step');
    this.saveButton = page.getByTestId('guide-save-button');
    this.publishPanel = page.getByTestId('guide-publish-panel');
    this.publishButton = page.getByTestId('guide-publish-button');
    this.publishBlockers = page.getByTestId('guide-publish-blockers');
    this.unpublishButton = page.getByTestId('guide-unpublish-button');
    this.deleteButton = page.getByTestId('guide-delete-button');
    this.deleteConfirmYes = page.getByTestId('guide-delete-button-yes');
    this.unsavedWarning = page.getByTestId('guide-unsaved-warning');
  }

  async goto(adminUrl: string, guideId: string): Promise<void> {
    await this.page.goto(`${adminUrl}/guides/${guideId}`, { waitUntil: 'domcontentloaded' });
    await expect(this.screen).toBeVisible({ timeout: 30_000 });
  }

  /** Step controls are 1-BASED and POSITIONAL — after a move the same id holds different text. */
  stepText(n: number): Locator {
    return this.page.getByTestId(`guide-step-text-${n}`);
  }
  stepDown(n: number): Locator {
    return this.page.getByTestId(`guide-step-down-${n}`);
  }
  stepUp(n: number): Locator {
    return this.page.getByTestId(`guide-step-up-${n}`);
  }
  stepRemove(n: number): Locator {
    return this.page.getByTestId(`guide-step-remove-${n}`);
  }
  addImage(n: number): Locator {
    return this.page.getByTestId(`guide-step-add-image-${n}`);
  }
  youTube(n: number): Locator {
    return this.page.getByTestId(`guide-step-youtube-${n}`);
  }
  imagePreview(n: number): Locator {
    return this.page.getByTestId(`guide-step-image-preview-${n}`);
  }
  uploadError(n: number): Locator {
    return this.page.getByTestId(`guide-step-upload-error-${n}`);
  }
  blocker(code: string): Locator {
    return this.page.getByTestId(`guide-blocker-${code}`);
  }

  async appendStep(text: string, index: number): Promise<void> {
    await this.addStep.click();
    await this.stepText(index).fill(text);
  }

  /** The current step texts, in display order. */
  async stepTexts(): Promise<string[]> {
    const inputs = this.page.locator('[data-testid^="guide-step-text-"]');
    return inputs.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLInputElement | HTMLTextAreaElement).value),
    );
  }

  /**
   * Saves. Save is disabled unless the form is dirty, so a caller that saves
   * twice with no edit between would click a dead button and silently pass.
   */
  async save(): Promise<void> {
    await expect(this.saveButton, 'save is disabled — nothing was dirty').toBeEnabled();
    await this.saveButton.click();
    await expect(this.saveButton, 'save never settled back to disabled').toBeDisabled({
      timeout: 30_000,
    });
  }

  async publish(): Promise<void> {
    await expect(this.publishButton, 'publish is disabled on a complete guide').toBeEnabled();
    await this.publishButton.click();
    await expect(this.unpublishButton, 'publish did not flip the panel to unpublish').toBeVisible({
      timeout: 30_000,
    });
  }

  async unpublish(): Promise<void> {
    await expect(this.unpublishButton).toBeEnabled();
    await this.unpublishButton.click();
    await expect(this.publishButton, 'unpublish did not flip the panel back to publish').toBeVisible(
      { timeout: 30_000 },
    );
  }

  /** Deletes the guide through the two-press in-page confirm. */
  async deleteGuide(): Promise<void> {
    await this.deleteButton.click();
    await this.deleteConfirmYes.click();
    await this.page.waitForURL(/\/guides$/, { timeout: 30_000 });
  }

  /** The public path this guide will occupy, e.g. `/odigos/foo`. */
  async publicPath(): Promise<string> {
    return ((await this.slug.textContent()) ?? '').trim();
  }
}

