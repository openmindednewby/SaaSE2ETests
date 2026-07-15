// Agora ES-07 billing — @ui tier: the real merchant admin in a real browser against the DEPLOYED
// agora-web (bff-agora serves the SPA same-origin at AGORA_WEB_URL).
//
// This tier exists to prove the two things the @api tier cannot SEE: the trial/paused UI state a
// merchant actually looks at, and the read-only lockdown. The Paused → read-only lockdown had ONLY
// ever been code-verified (unit tests over pure billingState helpers) — it had never been rendered
// in a browser. That is exactly the gap this closes; where the environment cannot reach Paused
// (no platform Stripe secret, as on staging) the Paused test SKIPS WITH A CLEAR REASON, never fakes.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraAdminPage } from '../../pages/agora/AgoraAdminPage.js';
import { AgoraBillingPage } from '../../pages/agora/AgoraBillingPage.js';
import { AgoraApi } from './agora-client.js';
import { AGORA_WEB_URL, MERCHANT_A, getAgoraToken, tokenClaim } from './agora-helpers.js';
import {
  NO_PAUSED_LEVER_REASON,
  buildPlatformCheckoutCompletedBody,
  buildPlatformSubscriptionActiveBody,
  buildPlatformSubscriptionDeletedBody,
  canaryCreds,
  newSyntheticRefs,
  platformWebhookSecret,
  postPlatformWebhook,
} from './agora-billing-helpers.js';

/** Wording that would (wrongly) imply data loss — the paused copy must contain NONE of it. */
const DATA_LOSS_WORDING = /deleted|erased|wiped|lost forever|permanently removed|gone for good/i;

test.describe('Agora ES-07 billing @agora-ui @ui', () => {
  test.beforeEach(async () => {
    test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL unset — the merchant admin is not reachable');
    test.skip(!process.env.AGORA_TEST_PASSWORD?.trim(), 'AGORA_TEST_PASSWORD unset');
  });

  // ------------------------------------------------------------------- test 5
  test('a Trialing merchant: status + days-left, no read-only banner, admin fully usable', async ({ page }) => {
    const password = process.env.AGORA_TEST_PASSWORD as string;
    const admin = new AgoraAdminPage(page);
    const billing = new AgoraBillingPage(page);
    await admin.login(MERCHANT_A, password);

    await billing.openBilling();
    await expect(billing.billingSummary).toBeVisible();
    await expect(billing.statusBadge).toBeVisible();

    // merchant-a on staging has no platform Stripe and a fresh trial, so it is Trialing. If it is not
    // (e.g. a future env where it subscribed), the "days left" proof needs a trialing tenant — skip
    // with a reason rather than assert the wrong copy.
    const badge = (await billing.statusBadge.textContent())?.trim() ?? '';
    test.skip(!/trial/i.test(badge), `merchant-a is not Trialing (badge="${badge}") — the Trialing UI proof needs a trialing tenant`);

    // The countdown the trialing merchant sees ("...N days left...").
    await expect(billing.detail).toContainText(/days left/i);
    await expect(billing.detail).toContainText(/free trial/i);

    // A trialing shop is fully live: NO cross-screen read-only/danger banner.
    await expect(billing.subscriptionBanner).toBeHidden();

    // ...and the admin is fully usable — the product editor opens and the Add control is enabled.
    await admin.navProducts.click();
    await expect(admin.productsScreen).toBeVisible();
    await expect(admin.productAddButton).toBeEnabled();
    await admin.productAddButton.click();
    await expect(admin.productEditorScreen).toBeVisible();
  });

  // ------------------------------------------------------- test 6 (flagship UI)
  test('a Paused merchant: danger banner + Reactivate CTA, writes disabled, NO data-loss copy', async ({ page, playwright }) => {
    const secret = platformWebhookSecret();
    const canary = canaryCreds();
    test.skip(!secret || !canary, NO_PAUSED_LEVER_REASON);
    if (!secret || !canary) {
      return;
    }

    // Drive the CANARY tenant to Paused over the API, then render its admin in the browser.
    const ctx: APIRequestContext = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const refs = newSyntheticRefs();
    let restore: (() => Promise<void>) | null = null;
    try {
      const canaryToken = await getAgoraToken(canary.username, canary.password);
      expect(canaryToken, 'canary token must mint').toBeTruthy();
      const tenantCanary = String(tokenClaim(canaryToken as string, 'tenantId') ?? '');
      expect(tenantCanary, 'canary token must carry tenantId').toBeTruthy();

      const link = await postPlatformWebhook(ctx, buildPlatformCheckoutCompletedBody(tenantCanary, refs), secret);
      expect(link.status(), 'signed platform webhook accepted (else the secret does not match)').toBe(200);
      await postPlatformWebhook(ctx, buildPlatformSubscriptionDeletedBody(refs), secret);
      restore = async (): Promise<void> => {
        await postPlatformWebhook(ctx, buildPlatformSubscriptionActiveBody(refs), secret);
      };

      // Confirm Paused via the API before opening the browser (fail fast, clear message).
      const canaryApi = new AgoraApi(ctx, canaryToken as string);
      const snap = (await canaryApi.getBillingSubscription().then((r) => r.json())) as { status: string };
      expect(snap.status, 'canary must be Paused before the browser assertions').toBe('Paused');

      const admin = new AgoraAdminPage(page);
      const billing = new AgoraBillingPage(page);
      await admin.login(canary.username, canary.password);

      // The cross-screen DANGER banner + Reactivate CTA render.
      await expect(billing.subscriptionBanner).toBeVisible();
      await expect(billing.subscriptionBannerCta).toBeVisible();

      // The reassurance the paused copy MUST carry — and MUST NOT imply data loss.
      await expect(billing.subscriptionBanner).toContainText(/nothing is lost/i);
      await expect(billing.subscriptionBanner).not.toContainText(DATA_LOSS_WORDING);

      // The primary WRITE control is visibly disabled (the API would 402 it anyway).
      await admin.navProducts.click();
      await expect(admin.productsScreen).toBeVisible();
      await expect(admin.productAddButton).toBeDisabled();

      // The billing screen itself stays usable and reassures ("Everything is saved").
      await billing.openBilling();
      await expect(billing.detail).toContainText(/everything is saved|nothing is lost/i);
      await expect(billing.billingCta).toBeVisible();
    } finally {
      if (restore) {
        await restore();
      }
      await ctx.dispose();
    }
  });

  // ------------------------------------------------------------------- test 7
  test('Terms + Privacy render from the footer, and the tax/merchant-of-record disclaimer is present', async ({ page }) => {
    const password = process.env.AGORA_TEST_PASSWORD as string;
    const admin = new AgoraAdminPage(page);
    const billing = new AgoraBillingPage(page);
    await admin.login(MERCHANT_A, password);

    // The legal footer is under every back-office screen.
    await expect(billing.legalTermsLink).toBeVisible();
    await expect(billing.legalPrivacyLink).toBeVisible();

    // Terms modal opens and carries the merchant-of-record / tax disclaimer — the productization
    // trust surface the whole billing product leans on.
    await billing.legalTermsLink.click();
    await expect(billing.termsScreen).toBeVisible();
    await expect(billing.termsScreen).toContainText(/merchant of record/i);
    await expect(billing.termsScreen).toContainText(/solely responsible for the taxes/i);
    await billing.termsClose.click();
    await expect(billing.termsScreen).toBeHidden();

    // Privacy modal opens too.
    await billing.legalPrivacyLink.click();
    await expect(billing.privacyScreen).toBeVisible();
    await billing.privacyClose.click();
    await expect(billing.privacyScreen).toBeHidden();
  });
});
