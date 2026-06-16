import { test, expect } from '../../../fixtures/index.js';
import type { BrowserContext, Page } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { MarketingPage } from '../../../pages/MarketingPage.js';
import { loginAsTenantAdminBrowser } from '../../../helpers/realm-browser-auth.js';

/**
 * Marketing campaigns lifecycle (erevna-web /marketing + NotificationService
 * /api/v1/marketing/*).
 *
 * Mirrors the manual live demo: sign in as the seeded tenant-admin → open the
 * Campaigns screen → add a subscriber → create a draft campaign → send it →
 * assert it flips to Sent with recipientCount >= 1.
 *
 * EMAIL SAFETY: sending dispatches via Maddy SMTP. We only ever subscribe a
 * synthetic, unique `example.com` address per run — the assertion target is the
 * campaign lifecycle through the UI + API (Draft → Send → status Sent,
 * recipientCount >= 1), NOT actual inbox receipt. No real inbox is involved.
 */
const RUN_ID = Date.now();
const SUBSCRIBER_EMAIL = `e2e-marketing+${RUN_ID}@example.com`;
const SUBSCRIBER_NAME = 'E2E Marketing Subscriber';
const CAMPAIGN_NAME = `E2E Campaign ${RUN_ID}`;
const CAMPAIGN_SUBJECT = `E2E Subject ${RUN_ID}`;
const CAMPAIGN_BODY = 'Hello from the E2E marketing campaign test. This is synthetic test content.';

const SENT_STATUS = 'Sent';
const MIN_RECIPIENTS = 1;

test.describe.serial('Marketing campaigns @questioner @marketing', () => {
  let context: BrowserContext;
  let page: Page;
  let marketingPage: MarketingPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(90000);
    testInfo.setTimeout(120000);
    const { admin: adminUser } = getProjectUsers(testInfo.project.name);

    context = await browser.newContext();
    page = await context.newPage();

    // Restore auth from localStorage to sessionStorage on every page load so the
    // session survives navigations (same pattern as the questioner specs), and
    // pre-seed cookie consent so the GDPR banner never renders to intercept
    // our locator waits (legal-ui reads `COOKIE_CONSENT` from localStorage).
    await page.addInitScript(() => {
      try {
        const persistAuth = localStorage.getItem('persist:auth');
        if (persistAuth && !sessionStorage.getItem('persist:auth')) {
          sessionStorage.setItem('persist:auth', persistAuth);
        }
        if (!localStorage.getItem('COOKIE_CONSENT')) {
          localStorage.setItem(
            'COOKIE_CONSENT',
            JSON.stringify({
              necessary: true,
              analytics: false,
              marketing: false,
              consentedAt: new Date().toISOString(),
              version: '1',
            }),
          );
        }
      } catch {
        // ignore
      }
    });

    // BFF login against the questioner realm (erevna-web baseURL).
    await loginAsTenantAdminBrowser(page, adminUser);

    marketingPage = new MarketingPage(page);
  });

  test.beforeEach(() => {
    // The screen mounts behind two React Query fetches via the BFF; allow
    // generous headroom over the 30s default (matches the questioner specs).
    test.setTimeout(90000);
  });

  test.afterAll(async () => {
    // Self-clean the synthetic subscriber so reruns stay tidy. Best-effort.
    try {
      await marketingPage.goto();
      if (await marketingPage.subscriberRow(SUBSCRIBER_EMAIL).count() > 0) {
        await marketingPage.removeSubscriber(SUBSCRIBER_EMAIL);
      }
    } catch {
      // Ignore cleanup errors — the campaign is uniquely named, harmless to leave.
    }
    await context?.close();
  });

  test('should load the marketing campaigns screen', async () => {
    await marketingPage.goto();
    await expect(marketingPage.screen).toBeVisible();
    await expect(marketingPage.subscribersList).toBeVisible();
    await expect(marketingPage.campaignsList).toBeVisible();
  });

  test('should add a synthetic subscriber', async () => {
    await marketingPage.goto();
    await marketingPage.addSubscriber(SUBSCRIBER_EMAIL, SUBSCRIBER_NAME);
    await expect(marketingPage.subscriberRow(SUBSCRIBER_EMAIL)).toBeVisible();
  });

  test('should create a draft campaign', async () => {
    await marketingPage.goto();
    await marketingPage.createCampaign(CAMPAIGN_NAME, CAMPAIGN_SUBJECT, CAMPAIGN_BODY);

    const row = marketingPage.campaignRow(CAMPAIGN_NAME);
    await expect(row).toBeVisible();
    // A fresh campaign is Draft → the Send button is available.
    await expect(row.locator('[data-testid="marketing-campaign-send-button"]')).toBeVisible();
  });

  test('should send the campaign and flip it to Sent @critical', async () => {
    await marketingPage.goto();
    await expect(marketingPage.campaignRow(CAMPAIGN_NAME)).toBeVisible();

    const result = await marketingPage.sendCampaign(CAMPAIGN_NAME);

    // API contract: send returns the campaign's final status + counts.
    expect(result.status).toBe(SENT_STATUS);
    expect(result.recipientCount).toBeGreaterThanOrEqual(MIN_RECIPIENTS);
    expect(result.sentCount + result.failedCount).toBe(result.recipientCount);

    // UI reflects the sent state: the status badge reads "Sent" and the Send
    // button is gone (a sent campaign is no longer sendable).
    await expect(marketingPage.campaignStatusBadge(CAMPAIGN_NAME)).toHaveText(SENT_STATUS);
    await expect(
      marketingPage.campaignRow(CAMPAIGN_NAME).locator('[data-testid="marketing-campaign-send-button"]'),
    ).toHaveCount(0);
  });
});
