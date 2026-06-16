import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for the erevna-web marketing campaigns screen (/marketing).
 *
 * Covers the two sections on the screen:
 *  - Subscribers: add (email + optional name), list, remove.
 *  - Campaigns: create (name/subject/body), list, send via the in-UI
 *    Send → Confirm flow (NOT a browser dialog).
 *
 * The screen reads/writes the real NotificationService /api/v1/marketing/*
 * endpoints through the erevna BFF, so the page methods await the matching
 * network responses (matched by the stable `/marketing/` URL substring) rather
 * than arbitrary timeouts — the proxied base URL is environment-dependent.
 */
export class MarketingPage extends BasePage {
  readonly screen: Locator;
  readonly loading: Locator;
  readonly error: Locator;

  // Subscribers
  readonly subscriberEmailInput: Locator;
  readonly subscriberNameInput: Locator;
  readonly subscriberAddButton: Locator;
  readonly subscribersList: Locator;
  readonly subscribersEmpty: Locator;

  // Campaigns
  readonly campaignNameInput: Locator;
  readonly campaignSubjectInput: Locator;
  readonly campaignBodyInput: Locator;
  readonly campaignCreateButton: Locator;
  readonly campaignsList: Locator;
  readonly campaignsEmpty: Locator;

  constructor(page: Page) {
    super(page);
    this.screen = page.locator(testIdSelector(TestIds.MARKETING_SCREEN));
    this.loading = page.locator(testIdSelector(TestIds.MARKETING_LOADING));
    this.error = page.locator(testIdSelector(TestIds.MARKETING_ERROR));

    this.subscriberEmailInput = page.locator(testIdSelector(TestIds.MARKETING_SUBSCRIBER_EMAIL_INPUT));
    this.subscriberNameInput = page.locator(testIdSelector(TestIds.MARKETING_SUBSCRIBER_NAME_INPUT));
    this.subscriberAddButton = page.locator(testIdSelector(TestIds.MARKETING_SUBSCRIBER_ADD_BUTTON));
    this.subscribersList = page.locator(testIdSelector(TestIds.MARKETING_SUBSCRIBERS_LIST));
    this.subscribersEmpty = page.locator(testIdSelector(TestIds.MARKETING_SUBSCRIBERS_EMPTY));

    this.campaignNameInput = page.locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_NAME_INPUT));
    this.campaignSubjectInput = page.locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_SUBJECT_INPUT));
    this.campaignBodyInput = page.locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_BODY_INPUT));
    this.campaignCreateButton = page.locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_CREATE_BUTTON));
    this.campaignsList = page.locator(testIdSelector(TestIds.MARKETING_CAMPAIGNS_LIST));
    this.campaignsEmpty = page.locator(testIdSelector(TestIds.MARKETING_CAMPAIGNS_EMPTY));
  }

  private static readonly LOAD_TIMEOUT = 60000;

  async goto() {
    await super.goto('/marketing');

    // Auth-bounce recovery (mirrors the questioner page objects): if the SPA
    // beat the localStorage->sessionStorage init script we land on /login.
    if (this.page.url().includes('/login')) {
      await this.restoreAuth();
      await this.page.goto('/marketing', { waitUntil: 'domcontentloaded', timeout: MarketingPage.LOAD_TIMEOUT });
    }

    // Dismiss the cookie-consent banner up-front so it doesn't repeatedly
    // intercept the subsequent waits (the auto-handler can loop on prod).
    await this.dismissCookieBanner();

    // The screen mounts behind the subscribers/campaigns queries. Wait for a
    // concrete interactive element of the loaded screen (the campaign name
    // input always renders once the queries resolve); surface the error state
    // as the alternative outcome.
    await Promise.race([
      this.campaignNameInput.waitFor({ state: 'visible', timeout: MarketingPage.LOAD_TIMEOUT }),
      this.error.waitFor({ state: 'visible', timeout: MarketingPage.LOAD_TIMEOUT }),
    ]);
  }

  /** Accepts the cookie-consent banner if present (best-effort, non-blocking). */
  private async dismissCookieBanner() {
    const accept = this.page.locator('[data-testid="cookie-consent-accept-all"]');
    if (await accept.count() > 0) {
      await accept.click({ timeout: 5000 }).catch(() => {});
    }
  }

  /** Matches a subscriber row by its email text. */
  subscriberRow(email: string): Locator {
    return this.page
      .locator(testIdSelector(TestIds.MARKETING_SUBSCRIBER_ROW))
      .filter({ hasText: email });
  }

  /** Matches a campaign row (card) by its name text. */
  campaignRow(name: string): Locator {
    return this.page
      .locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_ROW))
      .filter({ hasText: name });
  }

  /** The status badge inside a given campaign row. */
  campaignStatusBadge(name: string): Locator {
    return this.campaignRow(name).locator(`[data-testid="${TestIds.MARKETING_CAMPAIGN_ROW}-status"]`);
  }

  /** Adds a subscriber and waits for the create POST + the list refetch GET. */
  async addSubscriber(email: string, name?: string) {
    await this.subscriberEmailInput.fill(email);
    if (name) await this.subscriberNameInput.fill(name);

    const postPromise = this.waitForMarketingResponse('POST', 'subscribers');
    const getPromise = this.waitForMarketingResponse('GET', 'subscribers');

    await this.subscriberAddButton.click();

    await postPromise;
    await getPromise;
    await expect(this.subscriberRow(email)).toBeVisible({ timeout: 15000 });
  }

  /** Removes a subscriber by email and waits for the DELETE + list refetch GET. */
  async removeSubscriber(email: string) {
    const row = this.subscriberRow(email).first();
    const removeButton = row.locator(testIdSelector(TestIds.MARKETING_SUBSCRIBER_REMOVE_BUTTON));

    const deletePromise = this.waitForMarketingResponse('DELETE', 'subscribers');
    const getPromise = this.waitForMarketingResponse('GET', 'subscribers');

    await removeButton.click();

    await deletePromise;
    await getPromise;
    await expect(this.subscriberRow(email)).toHaveCount(0, { timeout: 15000 });
  }

  /** Creates a draft campaign and waits for the create POST + the list refetch GET. */
  async createCampaign(name: string, subject: string, body: string) {
    await this.campaignNameInput.fill(name);
    await this.campaignSubjectInput.fill(subject);
    await this.campaignBodyInput.fill(body);

    const postPromise = this.waitForMarketingResponse('POST', 'campaigns');
    const getPromise = this.waitForMarketingResponse('GET', 'campaigns');

    await this.campaignCreateButton.click();

    await postPromise;
    await getPromise;
    await expect(this.campaignRow(name)).toBeVisible({ timeout: 15000 });
  }

  /**
   * Drives the in-UI Send → Confirm flow for a campaign and waits for the send
   * POST (.../campaigns/{id}/send) plus the list refetch GET. Returns the
   * parsed send-result body so the caller can assert recipient/sent counts.
   */
  async sendCampaign(name: string): Promise<{ status: string; recipientCount: number; sentCount: number; failedCount: number }> {
    const row = this.campaignRow(name).first();
    await row.locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_SEND_BUTTON)).click();

    const sendResponsePromise = this.page.waitForResponse(
      (response) => response.url().includes('/marketing/campaigns/') &&
        response.url().includes('/send') &&
        response.request().method() === 'POST',
      { timeout: 30000 },
    );
    const getPromise = this.waitForMarketingResponse('GET', 'campaigns');

    await row.locator(testIdSelector(TestIds.MARKETING_CAMPAIGN_SEND_CONFIRM_BUTTON)).click();

    const sendResponse = await sendResponsePromise;
    await getPromise;

    return (await sendResponse.json()) as {
      status: string; recipientCount: number; sentCount: number; failedCount: number;
    };
  }

  /**
   * Waits for a marketing API response matching method + a resource keyword in
   * the URL (`subscribers` or `campaigns`). The send call also contains
   * `campaigns`, so callers awaiting the list GET should rely on the GET method
   * to disambiguate. Non-throwing so a missed refetch doesn't fail the flow.
   */
  private waitForMarketingResponse(method: string, resource: 'subscribers' | 'campaigns') {
    return this.page
      .waitForResponse(
        (response) =>
          response.url().includes(`/marketing/${resource}`) &&
          response.request().method() === method,
        { timeout: 20000 },
      )
      .catch(() => null);
  }
}
