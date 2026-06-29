/**
 * Kefi freemium gates — FULL UI tier (KEFI-2). Tag: `@ui`.
 *
 * This is the FULL (real-browser) tier of the SAME capability the fast API spec
 * (`kefi-pro-gates-api.spec.ts`, `@api`) asserts at the HTTP-contract level.
 * Where the API tier proves the 403/2xx gate contract in seconds, this tier
 * proves the LOCK UX a Free organizer actually sees:
 *
 *   1. A canary tenant signs up → IMAP verify → FREE wizard (the onboarded Free
 *      tenant; no `forceOnboardingPlan('pro')`). This is the wizard rig the
 *      kefi siblings share, so the wall-clock is dominated by signup + IMAP.
 *   2. `/organizer/landing` renders three `ProGateCard` locks for a Free tenant
 *      — custom domain, attendee payments, and the "remove Kefi branding" toggle
 *      — each with a visible upgrade CTA. `/organizer/events` renders the
 *      multi-event lock (the wizard auto-created the 1 allowed event).
 *   3. The custom-domain upgrade CTA routes to `/organizer/pricing`.
 *   4. Positive control: a platform-admin Pro grant + reload swaps the locks for
 *      the real custom-domain / payment forms.
 *
 * The wall-clock is annotated so the API/UI speed gap is visible.
 *
 * testIDs (from `ProGateCard.tsx` + its callers): `custom-domain-pro-gate`,
 * `payment-options-pro-gate`, `landing-form-branding-hidebrand-gate`,
 * `events-multi-pro-gate` (each with a `-upgrade` suffix on the CTA); the real
 * forms are `custom-domain-card` / `payment-options-card`.
 *
 * Runs on staging + prod via E2E_TARGET; local is skipped (no kefi dev stack +
 * platform-admin creds live only in .env.{staging,prod}.secrets).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiBackofficeClient } from '../../helpers/kefi/kefiBackofficeClient.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext, type KefiCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_DAYS_AHEAD = 60;
const VISIBLE_TIMEOUT_MS = 30_000;
/** A far-future paid period — well clear of any validator window (mirrors the siblings). */
const GRANTED_PERIOD_END_UTC = '2027-12-31T00:00:00Z';

function dateAhead(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

test.describe('Kefi KEFI-2 — freemium gate UX @ui (FULL, real browser)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi freemium-gate E2E targets staging+prod; local stack + platform-admin creds not in .env.local',
  );

  test('@ui Free organizer sees Pro locks + upgrade CTA; a Pro grant reveals the real forms', async ({ page }) => {
    const startedAt = Date.now();
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const backoffice = new KefiBackofficeClient(admin);
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    let verifyUid: number | null = null;
    try {
      // ── 1. Onboarded FREE tenant (signup → IMAP verify → FREE wizard) ──────
      verifyUid = await signUpVerifyAndCompleteFreeWizard(page, ctx);

      // ── 2. The landing editor renders the three Free-plan locks ────────────
      await expectFreePlanLocksRender(page);

      // ── 3. The multi-event lock renders on the events surface ──────────────
      await expectMultiEventLockRenders(page);

      // ── 4. The upgrade CTA routes to the pricing page ──────────────────────
      await expectUpgradeCtaRoutesToPricing(page);

      // ── 5. Positive control: a Pro grant swaps the locks for the real forms ─
      await grantProPlan(backoffice, ctx);
      await expectProFormsRenderAfterGrant(page);
    } finally {
      const elapsedMs = Date.now() - startedAt;
      test.info().annotations.push({ type: 'wall-clock-ms', description: String(elapsedMs) });
      process.stdout.write(`\n[kefi-pro-gates @ui] wall-clock: ${(elapsedMs / 1000).toFixed(1)}s\n`);
      if (verifyUid !== null) {
        await new KefiMailbox(loadKefiMailboxConfig()).expungeMessages([verifyUid]).catch(() => undefined);
      }
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

/**
 * Drive the shared signup → verify → wizard rig to a verified canary tenant on
 * the DEFAULT (Free) plan — deliberately no forceOnboardingPlan('pro'). The
 * wizard Finish auto-creates the tenant's one event and marks onboarding
 * complete (so `/organizer/*` no longer bounces to the wizard). Returns the
 * verify mail's UID for mailbox hygiene.
 */
async function signUpVerifyAndCompleteFreeWizard(
  page: Page,
  ctx: KefiCanaryContext,
): Promise<number> {
  const marketing = new KefiMarketingPage(page);
  await marketing.goto();
  await marketing.signupAndExpectSuccess({
    email: ctx.email,
    password: ctx.password,
    tenantName: ctx.tenantName,
  });
  await new KefiSignupSuccessPage(page).expectLoaded();

  const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 60_000, pollIntervalMs: 2_000 });
  const captured = await mailbox.waitForMessageTo(ctx.email);
  const verifyUrl = extractVerifyUrl(captured);
  expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();
  await page.goto(verifyUrl!);

  const wizard = new KefiOnboardingWizardPage(page);
  await wizard.expectLoaded();
  await wizard.fillFastPath({ canaryPrefix: ctx.slugPrefix, eventDateIso: dateAhead(EVENT_DAYS_AHEAD) });
  await wizard.finishFromReview();

  return captured.uid;
}

/** Navigate to the landing editor and wait for it to render. */
async function gotoLandingEditor(page: Page): Promise<void> {
  const { webUrl } = getKefiUrls();
  await page.goto(`${webUrl}/organizer/landing`);
  await expect(page.getByTestId('landing-editor-surface')).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
}

/**
 * The landing editor shows three `ProGateCard` locks for a Free tenant — custom
 * domain, attendee payments, and the remove-Kefi-branding toggle — each with a
 * visible upgrade CTA, and NONE of the real forms.
 */
async function expectFreePlanLocksRender(page: Page): Promise<void> {
  await gotoLandingEditor(page);

  await expect(page.getByTestId('custom-domain-pro-gate')).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
  await expect(page.getByTestId('custom-domain-pro-gate-upgrade')).toBeVisible();
  await expect(page.getByTestId('payment-options-pro-gate')).toBeVisible();
  await expect(page.getByTestId('payment-options-pro-gate-upgrade')).toBeVisible();
  await expect(
    page.getByTestId('landing-form-branding-hidebrand-gate'),
    'remove-Kefi-branding toggle is locked for Free',
  ).toBeVisible();
  await expect(page.getByTestId('landing-form-branding-hidebrand-gate-upgrade')).toBeVisible();

  // The real Pro-only forms must NOT be present while locked.
  await expect(page.getByTestId('custom-domain-card')).toHaveCount(0);
  await expect(page.getByTestId('payment-options-card')).toHaveCount(0);
}

/** The events surface shows the multi-event lock (Free tenant already owns its 1 event). */
async function expectMultiEventLockRenders(page: Page): Promise<void> {
  const { webUrl } = getKefiUrls();
  await page.goto(`${webUrl}/organizer/events`);
  await expect(page.getByTestId('events-multi-pro-gate')).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
  await expect(page.getByTestId('events-multi-pro-gate-upgrade')).toBeVisible();
}

/** Clicking a lock's upgrade CTA navigates to /organizer/pricing. */
async function expectUpgradeCtaRoutesToPricing(page: Page): Promise<void> {
  await gotoLandingEditor(page);
  await page.getByTestId('custom-domain-pro-gate-upgrade').click();
  await page.waitForURL(/\/organizer\/pricing\/?(\?.*)?$/, { timeout: VISIBLE_TIMEOUT_MS });
}

/** Grant the canary tenant Pro/Active via the platform-admin subscription endpoint. */
async function grantProPlan(backoffice: KefiBackofficeClient, ctx: KefiCanaryContext): Promise<void> {
  const tenant = await backoffice.findTenantBySlugPrefix(ctx.slugPrefix);
  expect(tenant, `canary tenant resolvable by slug prefix ${ctx.slugPrefix}`).not.toBeNull();
  const granted = await backoffice.setSubscription(tenant!.tenantId, {
    planCode: 'pro',
    status: 'Active',
    currentPeriodEndUtc: GRANTED_PERIOD_END_UTC,
  });
  expect(granted.status, 'Pro grant → 200').toBe(200);
  expect(granted.data.subscriptionPlanCode, 'granted plan code').toBe('pro');
}

/**
 * After the Pro grant, a fresh load of the landing editor swaps the locks for
 * the real custom-domain + payment forms — proving the gate is plan-driven UX,
 * not a permanent block.
 */
async function expectProFormsRenderAfterGrant(page: Page): Promise<void> {
  await gotoLandingEditor(page);
  await expect(
    page.getByTestId('custom-domain-card'),
    'real custom-domain form renders once Pro is granted',
  ).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
  await expect(
    page.getByTestId('payment-options-card'),
    'real payment form renders once Pro is granted',
  ).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
  await expect(page.getByTestId('custom-domain-pro-gate')).toHaveCount(0);
  await expect(page.getByTestId('payment-options-pro-gate')).toHaveCount(0);
}
