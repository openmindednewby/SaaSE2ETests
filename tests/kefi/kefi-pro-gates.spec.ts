/**
 * Kefi freemium-gate E2E (KEFI-2) — the missing NEGATIVE-path coverage.
 *
 * Proves the Pro-only feature gates that shipped to prod kefi-api (2026-06-29):
 * a FREE tenant is BLOCKED with HTTP 403 on the Pro features, while a Pro tenant
 * is not — i.e. the gate is plan-driven, not a blanket block.
 *
 * The three gated tenant-owner endpoints (backend refs in Kefi.UseCases.TenantAdmin):
 *   - POST /api/v1/admin/events            → 403 once a Free tenant already owns its
 *     one auto-created event ("Creating additional events requires the Pro plan.").
 *   - PUT  /api/v1/admin/custom-domain     → 403 ("Custom domains require the Pro plan.").
 *   - PUT  /api/v1/admin/stripe-credentials (store) → 403 ("Attendee payments require
 *     the Pro plan."). The CLEAR intent is ALLOWED on Free so a downgraded tenant
 *     can remove stored creds.
 *
 * Flow (signup/wizard rig as the kefi siblings, then pure-API):
 *   1. signup → IMAP verify → fast-path wizard on the DEFAULT (Free) plan — NO
 *      forceOnboardingPlan('pro'). The wizard auto-creates the tenant's 1 event.
 *   2. As the tenant owner: a 2nd event, a (valid) custom domain, and a stripe
 *      credentials STORE are each 403; a stripe credentials CLEAR is 2xx.
 *   3. Positive control: grant Pro via PUT /platform/tenants/{id}/subscription
 *      (platform-admin), then the SAME three calls all succeed (2xx). Tenant.IsPro
 *      is plan-code-driven, so the cached owner bearer needs no refresh.
 *   4. Canary-cleanup sweeps the e2c-{canaryId}- tenant + its KC user.
 *
 * Runs on staging + prod via E2E_TARGET; local is skipped (no kefi dev stack +
 * platform-admin creds live only in .env.{staging,prod}.secrets).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiBackofficeClient } from '../../helpers/kefi/kefiBackofficeClient.js';
import { KefiCustomDomainClient } from '../../helpers/kefi/kefiCustomDomainClient.js';
import {
  KefiProGatesClient,
  type OwnerCreds,
  type UpdateStripeCredentialsBody,
} from '../../helpers/kefi/kefiProGatesClient.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext, type KefiCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import { dummySecretKey, generateWebhookSecret } from '../../helpers/kefi/kefiStripeSign.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';
import type { Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_DAYS_AHEAD = 60;
const HTTP_FORBIDDEN = 403;
/** A far-future paid period — well clear of any validator window (mirrors the back-office spec). */
const GRANTED_PERIOD_END_UTC = '2027-12-31T00:00:00Z';

function dateAhead(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Bundle of clients + creds threaded through the gate-assertion helpers. */
interface GateDeps {
  ctx: KefiCanaryContext;
  owner: OwnerCreds;
  progates: KefiProGatesClient;
  cd: KefiCustomDomainClient;
}

test.describe('Kefi KEFI-2 — freemium gates (Free blocked, Pro allowed)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi freemium-gate E2E targets staging+prod; local stack + platform-admin creds not in .env.local',
  );

  test('a Free tenant is 403 on Pro features; a Pro grant unblocks the same calls', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const backoffice = new KefiBackofficeClient(admin);
    const deps: GateDeps = {
      ctx,
      owner: { ownerEmail: ctx.email, ownerPassword: ctx.password },
      progates: new KefiProGatesClient(admin),
      cd: new KefiCustomDomainClient(admin),
    };
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    let verifyUid: number | null = null;
    try {
      // ── 1. signup → IMAP verify → wizard on the FREE plan (auto-creates 1 event) ──
      verifyUid = await signUpVerifyAndCompleteFreeWizard(page, ctx);

      // ── 2. Free tenant is BLOCKED on every Pro feature (clear is allowed) ──
      await expectFreePlanGatesBlocked(deps);

      // ── 3. Positive control: grant Pro, then the SAME three calls succeed ──
      await grantProPlan(backoffice, ctx);
      await expectProPlanGatesAllowed(deps);
    } finally {
      if (verifyUid !== null) {
        await new KefiMailbox(loadKefiMailboxConfig()).expungeMessages([verifyUid]).catch(() => undefined);
      }
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

/**
 * Drive the shared signup→verify→wizard rig to a verified canary tenant on the
 * DEFAULT (Free) plan — deliberately no forceOnboardingPlan('pro'). The wizard
 * Finish auto-creates the tenant's one event. Returns the verify mail's UID for
 * mailbox hygiene.
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

/** A shape-valid store body (sk_/whsec_ pass the handler's shape validator). */
function storeCredsBody(ctx: KefiCanaryContext): UpdateStripeCredentialsBody {
  return {
    stripeSecretKey: dummySecretKey(ctx.canaryId),
    stripeWebhookSecret: generateWebhookSecret(),
    stripePaymentsEnabled: true,
  };
}

/**
 * Free tenant: a 2nd event, a (valid) custom domain, and a stripe-credentials
 * STORE are each 403; a stripe-credentials CLEAR is 2xx (the downgrade path).
 * The custom domain is a valid subdomain so the gate — not domain validation —
 * is what rejects it (the handler validates the domain BEFORE the IsPro check).
 */
async function expectFreePlanGatesBlocked(deps: GateDeps): Promise<void> {
  const secondEvent = await deps.progates.createEvent(deps.owner, {
    name: `${deps.ctx.slugPrefix}second event`,
    dateIso: dateAhead(EVENT_DAYS_AHEAD),
  });
  expect(secondEvent.status, 'Free 2nd event → 403 (Creating additional events requires the Pro plan)')
    .toBe(HTTP_FORBIDDEN);

  const domain = await deps.cd.set(deps.owner, `gate-${deps.ctx.canaryId}.example.com`);
  expect(domain.status, 'Free custom domain → 403 (Custom domains require the Pro plan)')
    .toBe(HTTP_FORBIDDEN);

  const store = await deps.progates.updateStripeCredentials(deps.owner, storeCredsBody(deps.ctx));
  expect(store.status, 'Free stripe-credentials store → 403 (Attendee payments require the Pro plan)')
    .toBe(HTTP_FORBIDDEN);

  const clear = await deps.progates.updateStripeCredentials(deps.owner, {
    stripePaymentsEnabled: false,
    clear: true,
  });
  expect(clear.status, 'Free stripe-credentials CLEAR is allowed (downgrade path)')
    .toBeGreaterThanOrEqual(200);
  expect(clear.status, 'Free stripe-credentials CLEAR is 2xx').toBeLessThan(300);
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
 * Pro tenant: the SAME three previously-blocked calls now succeed (2xx) —
 * proving the gate is plan-driven, not a blanket block. Distinct domain from
 * the Free attempt to keep the assertion clean.
 */
async function expectProPlanGatesAllowed(deps: GateDeps): Promise<void> {
  const secondEvent = await deps.progates.createEvent(deps.owner, {
    name: `${deps.ctx.slugPrefix}pro event`,
    dateIso: dateAhead(EVENT_DAYS_AHEAD),
  });
  expect(secondEvent.status, 'Pro 2nd event → 201').toBe(201);

  const domain = await deps.cd.set(deps.owner, `pro-${deps.ctx.canaryId}.example.com`);
  expect(domain.status, 'Pro custom domain → 200').toBe(200);
  expect(domain.body.status, 'Pro custom domain stored PendingDns').toBe('PendingDns');

  const store = await deps.progates.updateStripeCredentials(deps.owner, storeCredsBody(deps.ctx));
  expect(store.status, 'Pro stripe-credentials store is 2xx').toBeGreaterThanOrEqual(200);
  expect(store.status, 'Pro stripe-credentials store is 2xx').toBeLessThan(300);
}
