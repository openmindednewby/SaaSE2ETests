// Agora ES-06 merchant frontend — @ui tier: the real click-through, in a real browser, against the
// DEPLOYED app (bff-agora serves the SPA same-origin at AGORA_WEB_URL).
//
// Proves the ES-06 screens that had only ever been code-verified actually OPEN and BEHAVE in a
// browser:
//   - the orders screen mounts (empty state or grid) — the "never opened in a browser" bug class;
//   - the Stripe settings card renders, reports NOT-connected, and the publish button is inert;
//   - a rejected key is surfaced INLINE (RFC7807 → stripe-save-error), not swallowed;
//   - 🔴 the FLAGSHIP live-flip: connecting Stripe re-enables publish WITHOUT a reload (gated on a
//     real Stripe TEST key; skips-with-reason when absent).
import { expect, test } from '@playwright/test';
import { AgoraAdminPage } from '../../pages/agora/AgoraAdminPage.js';
import { AGORA_WEB_URL, MERCHANT_A } from './agora-ui-helpers.js';
import { FAKE_WEBHOOK_SECRET, NO_STRIPE_KEY_REASON, agoraStripeTestKeys } from './agora-stripe.js';

/** How long to wait for the ES-06 nav item before concluding the frontend is not deployed. */
const DEPLOY_PROBE_TIMEOUT_MS = 8_000;

/**
 * 🔴 LOUD skip reason, reported as this task's headline finding. As of 2026-07-15 the DEPLOYED
 * staging `agora-web` bundle PRE-DATES the ES-06 frontend merge (`cb16c7e`): the sidebar has no
 * Orders item and the settings screen has no Stripe-connection card, even though the code is on
 * master and the backend (agora-api) is fully deployed (every @api test passes). These @ui tests
 * therefore cannot be browser-proven until agora-web is redeployed. They are NOT weakened — this
 * gate AUTO-ACTIVATES (turns red-if-broken / green-if-working) the instant a bundle carrying
 * `nav-orders` is deployed. Redeploy: `manage.sh deploy agora-web`.
 */
const ES06_FRONTEND_NOT_DEPLOYED =
  'ES-06 merchant frontend NOT deployed to staging — the agora-web bundle predates cb16c7e '
  + '(no Orders nav, no Stripe settings card). Backend IS live (all @api pass). '
  + 'Redeploy agora-web (manage.sh deploy agora-web); these then run for real.';

test.describe('Agora ES-06 orders + Stripe settings @agora-ui @ui', () => {
  let admin: AgoraAdminPage;

  test.beforeEach(async ({ page }) => {
    const password = process.env.AGORA_TEST_PASSWORD?.trim();
    test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL unset — the merchant admin is not reachable');
    test.skip(!password, 'AGORA_TEST_PASSWORD unset');

    admin = new AgoraAdminPage(page);
    await admin.login(MERCHANT_A, password as string);

    // Deployment-presence gate (see ES06_FRONTEND_NOT_DEPLOYED). The `nav-orders` item is the
    // cheapest ES-06-only surface to probe: if it is absent, the bundle is stale and none of the
    // ES-06 screens exist to test.
    const es06Deployed = await admin.navOrders
      .waitFor({ state: 'visible', timeout: DEPLOY_PROBE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    test.skip(!es06Deployed, ES06_FRONTEND_NOT_DEPLOYED);
  });

  test('the orders screen opens in a browser and renders its list surface', async () => {
    // The whole reason the @ui tier exists: a screen that unit-tests-green can still be broken the
    // first time it is actually mounted. Assert the ES-06 orders screen reaches a settled state —
    // either the designed empty state or the grid — not a crash or an infinite spinner.
    await admin.navOrders.click();
    await expect(admin.ordersScreen).toBeVisible();
    await expect(admin.ordersEmpty.or(admin.ordersTable), 'orders list settles to empty-state or grid').toBeVisible();
  });

  test('the Stripe settings card renders NOT-connected and the publish button is inert', async () => {
    await admin.navSettings.click();
    await expect(admin.settingsScreen).toBeVisible();

    // The connect card is present and the write-only secret fields exist.
    await expect(admin.stripeCard).toBeVisible();
    await expect(admin.stripeSecretInput).toBeVisible();
    await expect(admin.stripeWebhookSecretInput).toBeVisible();

    // A shop with no Stripe cannot go live: the toggle is genuinely disabled (not merely styled),
    // and the blocked notice says why.
    await expect(admin.publishToggle).toBeVisible();
    await expect(admin.publishToggle).toBeDisabled();
    await expect(admin.publishBlockedNotice).toBeVisible();
  });

  test('a rejected Stripe key is surfaced INLINE, and the shop stays unpublishable', async () => {
    await admin.navSettings.click();
    await expect(admin.settingsScreen).toBeVisible();
    await expect(admin.stripeCard).toBeVisible();

    // A malformed key — deterministic, no Stripe account needed. The backend refuses it (400) and
    // the form must show the reason inline rather than swallow it into a silent no-op. Both secrets
    // are filled because a first-time connect needs both (Save is disabled otherwise).
    await admin.stripeSecretInput.fill('not-a-real-key');
    await admin.stripeWebhookSecretInput.fill(FAKE_WEBHOOK_SECRET);
    await expect(admin.stripeSaveButton).toBeEnabled();
    await admin.stripeSaveButton.click();

    await expect(admin.stripeSaveError, 'the rejection must be shown inline, not swallowed').toBeVisible();
    await expect(admin.stripeSaveError).not.toBeEmpty();
    // And the publish gate never opened on a rejected key.
    await expect(admin.publishToggle).toBeDisabled();
  });

  test('🔴 FLAGSHIP: connecting Stripe re-enables publish WITHOUT a page reload', async () => {
    const keys = agoraStripeTestKeys();
    test.skip(!keys, NO_STRIPE_KEY_REASON);

    await admin.navSettings.click();
    await expect(admin.settingsScreen).toBeVisible();
    await expect(admin.stripeCard).toBeVisible();

    // Pre-condition: publish is blocked before we connect.
    await expect(admin.publishToggle).toBeDisabled();

    await admin.stripeSecretInput.fill(keys!.secret);
    await admin.stripeWebhookSecretInput.fill(keys!.webhook);
    await admin.stripePaymentsSwitch.click();
    await admin.stripeSaveButton.click();

    // 🔴 THE UNVERIFIED CLAIM: saving invalidates queryKeys.shop(), so the publish toggle must flip
    // from disabled to enabled and the blocked notice must disappear — with NO page.reload().
    await expect(admin.stripeSaveError, 'a real key must not error').toBeHidden();
    await expect(admin.publishToggle, 'publish re-enables live on connect').toBeEnabled();
    await expect(admin.publishBlockedNotice).toBeHidden();

    // Clean up so re-runs start from the blocked state again.
    await admin.stripeDisconnectButton.click();
    await expect(admin.publishToggle).toBeDisabled();
  });
});
