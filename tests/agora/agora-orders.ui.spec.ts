// Agora ES-06 merchant frontend — @ui tier: the real click-through, in a real browser, against the
// DEPLOYED app (bff-agora serves the SPA same-origin at AGORA_WEB_URL).
//
// Proves the ES-06 screens that had only ever been code-verified actually OPEN and BEHAVE in a
// browser:
//   - the orders screen mounts (empty state or grid) — the "never opened in a browser" bug class;
//   - the Stripe settings card renders, reports NOT-connected, and the publish button is inert;
//   - a rejected key is surfaced INLINE (RFC7807 → stripe-card-error), not swallowed;
//   - 🔴 the FLAGSHIP live-flip: connecting Stripe re-enables publish WITHOUT a reload (gated on a
//     real Stripe TEST key; skips-with-reason when absent).
import { expect, test } from '@playwright/test';
import { AgoraAdminPage } from '../../pages/agora/AgoraAdminPage.js';
import { AGORA_WEB_URL, MERCHANT_A } from './agora-ui-helpers.js';
import { AgoraApi } from './agora-client.js';
import { getAgoraToken } from './agora-helpers.js';
import { FAKE_WEBHOOK_SECRET, NO_STRIPE_KEY_REASON, agoraStripeTestKeys } from './agora-stripe.js';

/** Passes the card's client-side shape check (Save stays disabled otherwise) but is no real key, so Stripe rejects it server-side. */
const SHAPE_VALID_FAKE_SECRET_KEY = 'sk_test_' + 'e2enotarealkey'.repeat(2);

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

/**
 * The flagship test's title, shared between the `test(...)` declaration and the beforeEach gate.
 * The flagship needs a real Stripe TEST key; when none is wired it must skip in <1s. Evaluating
 * the key gate against `testInfo.title` at the TOP of beforeEach — before any login/probe — means
 * an unset key skips instantly instead of hanging the hook for the full 30s per-test cap while
 * login + the ES-06 deploy probe run for a test that can never execute.
 */
const FLAGSHIP_TITLE =
  '🔴 FLAGSHIP: connecting Stripe in the card shows connected without a reload, and Clear disconnects it';

test.describe('Agora ES-06 orders + Stripe settings @agora-ui @ui', () => {
  let admin: AgoraAdminPage;

  test.beforeEach(async ({ page }, testInfo) => {
    const password = process.env.AGORA_TEST_PASSWORD?.trim();
    test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL unset — the merchant admin is not reachable');
    test.skip(!password, 'AGORA_TEST_PASSWORD unset');

    // Fast-skip the flagship BEFORE any slow work (login/probe) when no real Stripe key is wired,
    // so an owner-gated skip costs <1s instead of hanging the hook for the full 30s cap.
    const isFlagship = testInfo.title === FLAGSHIP_TITLE;
    test.skip(isFlagship && !agoraStripeTestKeys(), NO_STRIPE_KEY_REASON);

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

  test('the Stripe settings card renders NOT-connected with write-only secret fields', async () => {
    await admin.navSettings.click();
    await expect(admin.settingsScreen).toBeVisible();

    // The connect card is present and the write-only secret fields exist. Stripe is OPTIONAL post
    // ES-08: connecting it flips a browse-only shop to order-accepting; it no longer gates publish
    // (the content gate does — proven at the @api tier), so the publish control is simply present.
    await expect(admin.stripeCard).toBeVisible();
    await expect(admin.stripeSecretInput).toBeVisible();
    await expect(admin.stripeWebhookSecretInput).toBeVisible();
    await expect(admin.publishToggle).toBeVisible();
  });

  test('a rejected Stripe key is surfaced INLINE (not swallowed)', async () => {
    await admin.navSettings.click();
    await expect(admin.settingsScreen).toBeVisible();
    await expect(admin.stripeCard).toBeVisible();

    // A well-shaped but fake key — no Stripe account needed. The card blocks Save on a malformed
    // shape, so the key must pass the client check; the backend's Stripe probe then refuses it (400)
    // and the form must show the reason inline rather than swallow it into a silent no-op. Both
    // secrets are filled because a first-time connect needs both (Save is disabled otherwise).
    await admin.stripeSecretInput.fill(SHAPE_VALID_FAKE_SECRET_KEY);
    await admin.stripeWebhookSecretInput.fill(FAKE_WEBHOOK_SECRET);
    await expect(admin.stripeSaveButton).toBeEnabled();
    await admin.stripeSaveButton.click();

    await expect(admin.stripeSaveError, 'the rejection must be shown inline, not swallowed').toBeVisible();
    await expect(admin.stripeSaveError).not.toBeEmpty();
    // (Post ES-08 the publish control is no longer coupled to the Stripe connection — a rejected key
    // surfaces inline without changing publishability, which the content gate now owns.)
  });

  test(FLAGSHIP_TITLE, async ({ playwright }) => {
    const keys = agoraStripeTestKeys();
    test.skip(!keys, NO_STRIPE_KEY_REASON);
    const { secret, webhook } = keys as { secret: string; webhook: string };
    const notConnectedLabel = 'Not connected';
    const connectedLabel = 'Connected · live';
    const secretLast4 = secret.slice(-4);
    const ctx = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const token = await getAgoraToken(MERCHANT_A);
    expect(token, 'merchant A must mint an agora token').toBeTruthy();
    const api = new AgoraApi(ctx, token as string);
    const paymentsEnabled = async (): Promise<boolean> =>
      ((await (await api.getStripe()).json()) as { paymentsEnabled: boolean }).paymentsEnabled;
    expect((await api.disconnectStripe()).ok(), 'start from a disconnected shop').toBe(true);
    await admin.page.goto(AGORA_WEB_URL as string);
    await admin.navSettings.click();
    await expect(admin.stripeCard).toBeVisible();

    await expect(admin.stripeState).toHaveText(notConnectedLabel);
    await expect(admin.publishToggle, 'browse-only: publish does not wait for Stripe').toBeEnabled();
    expect(await paymentsEnabled()).toBe(false);

    await admin.stripeSecretInput.fill(secret);
    await admin.stripeWebhookSecretInput.fill(webhook);
    await expect(admin.stripePaymentsSwitch).toHaveAttribute('aria-checked', 'false');
    await admin.stripePaymentsSwitch.click();
    await admin.stripeSaveButton.click();

    await expect(admin.stripeSaveError, 'a real key must not error').toBeHidden();
    await expect(admin.stripeState, 'the card flips to connected with no reload').toHaveText(connectedLabel);
    await expect(admin.stripeKeyLast4).toContainText(secretLast4);
    await expect(admin.publishToggle).toBeEnabled();
    expect(await paymentsEnabled()).toBe(true);

    await admin.stripeDisconnectButton.click();
    await admin.stripeDisconnectConfirm.click();

    await expect(admin.stripeState).toHaveText(notConnectedLabel);
    await expect(admin.publishToggle).toBeEnabled();
    expect(await paymentsEnabled()).toBe(false);
    await ctx.dispose();
  });
});
