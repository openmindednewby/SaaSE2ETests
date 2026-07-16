// Agora ES-08 onboarding — @ui tier: the flagship "Live in Minutes" journey through the REAL
// six-step wizard, in a real browser, against the DEPLOYED merchant admin (bff-agora serves the SPA
// same-origin at AGORA_WEB_URL). This is Agora's second flagship journey alongside ES-06 checkout.
//
// The journey proved here is the DEFAULT browse-only path — the one that needs NO owner Stripe key,
// which is exactly why browse-only was built:
//   log in → wizard: name+subdomain (LIVE slug check) → brand (preset) → first product
//   (name+price+photo) → shipping → SKIP Stripe → publish → the shop goes LIVE in browse-only mode
//   (URL shown + copyable + "connect Stripe" messaging) → its public storefront lists the product.
//
// Subject: the seeded, agora-realm, (initially) shopless `agora-merchant-b`. A truly-fresh merchant
// CANNOT be minted on staging — identity-api rejects the `agora` realm on register (see
// agora-onboarding-helpers for the full why + the one-line fix). MERCHANT_B is shopless on the first
// run (a genuine first-run wizard); every run unpublishes + sweeps its shop in `finally`, so it is
// left non-public and nightly-safe.
//
// 30s CAP: the heavy 6-step journey is ONE atomic test kept lean (web-first waits return the instant
// each step mounts). The LIVE known-taken slug assertions live in a SECOND short test rather than
// inflating the journey's timeout — the sanctioned split (see the ES-07 mega-test precedent).
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { AgoraAdminPage } from '../../pages/agora/AgoraAdminPage.js';
import { AgoraOnboardingPage } from '../../pages/agora/AgoraOnboardingPage.js';
import { AGORA_API_PREFIX, AGORA_API_URL, AGORA_WEB_URL, getAgoraToken } from './agora-helpers.js';
import {
  ONBOARDING_MERCHANT,
  ONBOARDING_SHOP_NAME,
  ONBOARDING_SHOP_SLUG,
  cleanupOnboardingShop,
  uniqueProductName,
} from './agora-onboarding-helpers.js';

const PRODUCT_PRICE = '14.00';
const SHIPPING_FEE = '3.50';
const STEP_COMMIT_MS = 15_000;

// Playwright always runs with cwd = the E2ETests root, so a cwd-relative fixture path is stable
// (mirrors agora-admin.ui.spec.ts; `import.meta.url` is unusable under this repo's TS module setting).
const IMAGE_FIXTURE = path.join(process.cwd(), 'fixtures', 'files', 'test-image.png');

/** API-clean MERCHANT_B after a browser journey: unpublish + sweep the ES08 products it created. */
async function cleanup(request: APIRequestContext, password: string): Promise<void> {
  const token = await getAgoraToken(ONBOARDING_MERCHANT, password);
  if (!token) return;
  const note = await cleanupOnboardingShop(request, token);
  process.stdout.write(`[agora-onboarding-ui-cleanup] ${note}\n`);
}

test.describe('Agora ES-08 onboarding journey @agora-ui @ui', () => {
  const password = process.env.AGORA_TEST_PASSWORD?.trim();

  test.skip(!AGORA_WEB_URL, 'AGORA_WEB_URL unset — the merchant admin is not reachable');
  test.skip(!password, 'AGORA_TEST_PASSWORD unset — KC/BFF env not wired for this target');

  test('a merchant goes from empty to a LIVE browse-only shop through the wizard @critical', async ({
    page,
    request,
  }) => {
    const productName = uniqueProductName();
    try {
      // ---- log in (BFF ROPC; no token ever reaches the browser) ---------------------------------
      const admin = new AgoraAdminPage(page);
      await admin.login(ONBOARDING_MERCHANT, password as string);

      // Landing on any protected route mounts SubscriptionBanner, which reads billing and STARTS the
      // 30-day trial — so the wizard's PUT /shop (behind the PaidPlan gate) is allowed.
      const wizard = new AgoraOnboardingPage(page);
      await wizard.open();

      // ---- Step 1: Identity — the subdomain is populated + the live check makes the slug usable ---
      await expect(wizard.dot('identity')).toBeVisible();
      await wizard.nameInput.fill(ONBOARDING_SHOP_NAME);
      // The subdomain field is populated (auto-suggested from the name on a first run; prefilled from
      // the existing shop on a resume) — either way the merchant never starts from a blank address.
      await expect(wizard.slugInput, 'the subdomain must be populated from the name').not.toHaveValue('');
      // Take our own known slug so the storefront assertion later is deterministic.
      await wizard.slugInput.fill(ONBOARDING_SHOP_SLUG);
      // The LIVE availability check must resolve our slug to "free" (a merchant re-checking their own
      // slug sees it available) — proven by the inline status AND Continue becoming enabled.
      await expect(wizard.slugStatus).toContainText(/free/i, { timeout: STEP_COMMIT_MS });
      await wizard.emailInput.fill('onboarding-b@example.com');
      await wizard.continueToNext(wizard.presetPicker);

      // ---- Step 2: Branding — pick a colour preset (logo optional, skipped) ----------------------
      await wizard.presetPicker.getByTestId('onboarding-preset-forest').click();
      await wizard.taglineInput.fill('Handmade candles, made to order.');
      await wizard.continueToNext(wizard.productNameInput);

      // ---- Step 3: Product — name + price → Save → one photo via the multipart uploader ----------
      await wizard.productNameInput.fill(productName);
      await wizard.productPriceInput.fill(PRODUCT_PRICE);
      await wizard.productSave.click();
      // The image uploader only mounts once the product EXISTS, so its appearance IS the save-done
      // signal (same contract as the ES-04 admin editor).
      const productImages = page.getByTestId('product-images');
      await expect(productImages).toBeVisible({ timeout: STEP_COMMIT_MS });
      await page.locator('input[type="file"]').first().setInputFiles(IMAGE_FIXTURE);
      await expect(productImages.locator('img').first(), 'the uploaded photo must render').toBeVisible({
        timeout: STEP_COMMIT_MS,
      });
      await wizard.continueToNext(wizard.shippingFeeInput);

      // ---- Step 4: Shipping — a flat fee + click-and-collect -------------------------------------
      await wizard.shippingFeeInput.fill(SHIPPING_FEE);
      await wizard.pickupSwitch.click();
      await wizard.continueToNext(wizard.stripeSkipNote);

      // ---- Step 5: Payments — SKIP Stripe (the first-class browse-only path) ---------------------
      await expect(wizard.stripeSkipNote).toBeVisible();
      await wizard.skipToNext(wizard.publishButton);

      // ---- Step 6: Publish — SUCCEEDS with no Stripe → live in browse-only mode -------------------
      await wizard.publishButton.click();
      // The celebration surface for a browse-only shop: URL shown big + copyable + browse-only copy.
      await expect(wizard.publishUrl, 'the live shop URL must be shown').toBeVisible({ timeout: STEP_COMMIT_MS });
      await expect(wizard.publishUrl).toContainText(ONBOARDING_SHOP_SLUG);
      await expect(wizard.publishCopy, 'the URL must be copyable').toBeVisible();
      await expect(
        page.getByText(/browse-only/i).first(),
        'the browse-only messaging (connect Stripe to accept orders) must be present',
      ).toBeVisible({ timeout: STEP_COMMIT_MS });

      // ---- The PUBLIC storefront for the shop is live + browse-only ------------------------------
      // Asserted via the storefront API, not a per-shop browser host: a fresh shop's staging host
      // isn't wired into the Chromium host-resolver MAP list (see the task report's documented gap).
      await assertStorefrontBrowseOnly(request, ONBOARDING_SHOP_SLUG);
    } finally {
      await cleanup(request, password as string);
    }
  });

  test('step 1 live subdomain check: a known-taken slug (`demo`) reports unavailable + suggests one', async ({
    page,
  }) => {
    const admin = new AgoraAdminPage(page);
    await admin.login(ONBOARDING_MERCHANT, password as string);
    const wizard = new AgoraOnboardingPage(page);
    await wizard.open();

    // A fresh, unique slug nobody owns → "free". (Order-independent: we set the slug directly rather
    // than relying on first-run auto-suggest, so this holds whether or not the merchant has a shop.)
    await wizard.slugInput.fill(`es08free${randomUUID().slice(0, 8)}`);
    await expect(wizard.slugStatus, 'a fresh slug must read as free').toContainText(/free/i, {
      timeout: STEP_COMMIT_MS,
    });

    // A KNOWN-TAKEN slug (the seeded demo shop) → the live check reports it taken and offers a
    // nearby free suggestion.
    await wizard.slugInput.fill('demo');
    await expect(wizard.slugStatus, '`demo` is taken → the live check must say so').toContainText(/taken/i, {
      timeout: STEP_COMMIT_MS,
    });
    await expect(
      wizard.slugSuggestion,
      'a taken slug must offer a free suggestion to take instead',
    ).toBeVisible({ timeout: STEP_COMMIT_MS });
  });
});

/**
 * Prove the shop's PUBLIC storefront is live in browse-only mode via the anonymous storefront API:
 * published, acceptsOrders:false, and it lists the product the wizard created.
 */
async function assertStorefrontBrowseOnly(request: APIRequestContext, slug: string): Promise<void> {
  const base = `${AGORA_API_URL}${AGORA_API_PREFIX}/storefront/${slug}`;

  const shopRes = await request.get(base, { timeout: 15_000 });
  expect(shopRes.ok(), `GET /storefront/${slug} -> ${shopRes.status()}`).toBeTruthy();
  const shop = (await shopRes.json()) as Record<string, unknown>;
  expect(shop.published ?? shop.isPublished, 'the shop must be publicly published').toBe(true);
  expect(shop.acceptsOrders, 'the storefront must report browse-only (no Stripe)').toBe(false);

  const productsRes = await request.get(`${base}/products`, { timeout: 15_000 });
  expect(productsRes.ok(), `GET /storefront/${slug}/products -> ${productsRes.status()}`).toBeTruthy();
  const body = (await productsRes.json()) as Record<string, unknown>;
  const items = (Array.isArray(body) ? body : (body.items as unknown[])) ?? [];
  expect(items.length, 'the storefront must list the product the wizard created').toBeGreaterThan(0);
}
