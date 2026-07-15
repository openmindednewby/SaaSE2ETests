import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Agora ES-07 billing surface (agora-web): the Billing screen, the cross-screen
 * subscription banner mounted in the protected shell, and the legal footer (Terms + Privacy) that
 * opens the shared `@dloizides/legal-ui` modals.
 *
 * Ids mirror agora-web/src/shared/testIds.ts (BILLING_*, SUBSCRIPTION_BANNER*, LEGAL_*) plus the
 * legal-ui modal ids (`terms-of-service-screen` / `privacy-policy-screen`). Kept as raw strings to
 * match the rest of the Agora page objects, which are deliberately decoupled from the legacy shared
 * testIds barrel. The parity record lives in E2ETests/shared/testIds.ts (AGORA_* keys).
 */
export class AgoraBillingPage {
  readonly page: Page;

  // Nav + Billing screen
  readonly navBilling: Locator;
  readonly billingScreen: Locator;
  readonly billingSummary: Locator;
  readonly statusBadge: Locator;
  readonly detail: Locator;
  readonly billingCta: Locator;
  readonly noManage: Locator;

  // Cross-screen banner (Paused = danger, Grace = warning)
  readonly subscriptionBanner: Locator;
  readonly subscriptionBannerCta: Locator;

  // Legal footer + shared modals
  readonly legalTermsLink: Locator;
  readonly legalPrivacyLink: Locator;
  readonly termsScreen: Locator;
  readonly termsClose: Locator;
  readonly privacyScreen: Locator;
  readonly privacyClose: Locator;

  constructor(page: Page) {
    this.page = page;

    this.navBilling = page.getByTestId('nav-billing');
    this.billingScreen = page.getByTestId('agora-billing-screen');
    this.billingSummary = page.getByTestId('billing-summary');
    this.statusBadge = page.getByTestId('billing-status-badge');
    this.detail = page.getByTestId('billing-detail');
    this.billingCta = page.getByTestId('billing-cta');
    this.noManage = page.getByTestId('billing-no-manage');

    this.subscriptionBanner = page.getByTestId('subscription-banner');
    this.subscriptionBannerCta = page.getByTestId('subscription-banner-cta');

    this.legalTermsLink = page.getByTestId('legal-terms-link');
    this.legalPrivacyLink = page.getByTestId('legal-privacy-link');
    this.termsScreen = page.getByTestId('terms-of-service-screen');
    this.termsClose = page.getByTestId('terms-of-service-close');
    this.privacyScreen = page.getByTestId('privacy-policy-screen');
    this.privacyClose = page.getByTestId('privacy-policy-close');
  }

  /**
   * Navigate to the Billing screen via the sidebar and wait for its CONTENT to render.
   *
   * The screen shell (`agora-billing-screen`) mounts instantly, but the summary card is gated on
   * the subscription query behind an AsyncSurface loading state. On a cold pod/BFF that query can
   * take well over the 5s default assertion window, so we wait for the summary itself (the real
   * "screen is ready" signal) with a generous timeout rather than race the async fetch.
   */
  async openBilling(): Promise<void> {
    await this.navBilling.click();
    await this.billingScreen.waitFor({ state: 'visible', timeout: 30_000 });
    await this.billingSummary.waitFor({ state: 'visible', timeout: 30_000 });
  }
}

export default AgoraBillingPage;
