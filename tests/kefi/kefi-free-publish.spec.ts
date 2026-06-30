/**
 * Kefi Phase F — free-tier dynamic page rendering E2E (#159).
 *
 * Proves the headline self-serve promise: a brand-new FREE tenant can go live
 * with a branded page rendered entirely from its config — no hand-authored data
 * file, no Pro plan.
 *
 *   1. Marketing /signup creates a verified tenant via IMAP loopback.
 *   2. Verification magic-link auto-logs-in the owner → onboarding wizard.
 *   3. The 4-step fast-path wizard is completed on the DEFAULT (Free) plan —
 *      deliberately NO `forceOnboardingPlan('pro')`, unlike the lifecycle spec.
 *   4. The owner publishes. Pre-Phase-F this returned 402 (Pro-gated); now it
 *      MUST return 202 — the ungating proof. Poll until the Job succeeds.
 *   5. Probe the canary's OWN page at `${KEFI_WEB_URL}/t/<slug>/`. It must render
 *      200 with the "Made with Kefi" badge (emitted ONLY by the dynamic
 *      config→TenantSite mapper) and the tenant slug — proving the page was
 *      built from config, not hand-authored.
 *   6. Canary-cleanup sweeps the tenant + KC user + per-tenant K8s residue.
 *
 * Runs on staging + prod via E2E_TARGET. Local is skipped (no kefi dev stack).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { probeDynamicLandingRender } from '../../helpers/kefi/kefiDynamicLandingProbe.js';
import {
  expectTenantRootServes200,
  sweepSiblingTenantRoots,
} from '../../helpers/kefi/kefiTenantRootProbe.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Serial — shares the single bot mailbox + the single kefi-landings Deployment
// (rapid successive publishes would have rollouts step on each other).
test.describe.configure({ mode: 'serial' });

const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

test.describe('Kefi Phase F — free-tier dynamic publish', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi Phase F E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('a Free tenant signs up, publishes, and its page renders from config', async ({ page }) => {
    const ctx = newCanaryContext();
    const adminClient = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    try {
      // ── 1. UI: signup via the marketing form ─────────────────────────
      const marketing = new KefiMarketingPage(page);
      const success = new KefiSignupSuccessPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await success.expectLoaded();

      // ── 2. IMAP: verification email → magic-link auto-login → wizard ──
      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), {
        timeoutMs: 60_000,
        pollIntervalMs: 2_000,
      });
      const captured = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();
      await page.goto(verifyUrl!);

      // ── 3. UI: complete the 4-step fast-path wizard ON THE FREE PLAN ──
      // No forceOnboardingPlan('pro') — the whole point of Phase F is that Free
      // can publish. Wizard finish flips OnboardingCompleted=true and seeds a
      // landing config on the auto-created event, which is what GET /api/v1/t
      // discovers and the renderer turns into a page.
      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      const eventDateIso = toIsoDate(new Date(Date.now() + CANARY_EVENT_DAYS_AHEAD * MS_PER_DAY));
      await wizard.fillFastPath({ canaryPrefix: ctx.slugPrefix, eventDateIso });
      await wizard.finishFromReview();

      // ── 4. API: publish on Free — MUST be 202 (the ungating proof) ────
      const publishResult = await adminClient.publishLanding({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
      });
      expect(publishResult.status, 'Free-tier publish enqueued (no Pro gate)').toBe('Enqueued');
      expect(publishResult.tenantSlug.length, 'publish tenantSlug').toBeGreaterThan(0);

      const terminal = await adminClient.pollPublishStatus({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
        jobName: publishResult.jobName,
      });
      expect(terminal.status, `publish job ${publishResult.jobName} terminal`).toBe('Succeeded');

      // ── 5. Probe: the canary's OWN page renders dynamically from config ─
      // "Made with Kefi" is emitted only by the dynamic mapper — its presence
      // proves the page was built from config (not hand-authored, not the SPA).
      // The slug appears in the canonical URL the mapper always emits.
      const probe = await probeDynamicLandingRender({
        slug: publishResult.tenantSlug,
        requiredMarkers: ['Made with Kefi', publishResult.tenantSlug],
      });
      expect(probe.missingMarkers, 'dynamic landing markers').toEqual([]);

      // Regression guard (#160): the tenant-ROOT path itself must serve 200,
      // not just the per-event page. A just-published tenant whose root-landing
      // fetch fell back to null at build time used to silently drop
      // /t/<slug>/index.html → the "Your page is live!" link the editor hands
      // the client 403'd while /t/<slug>/<eventSlug>/ still 200'd.
      //
      // The marker probe above can early-return on the per-event content, so
      // assert the ROOT explicitly with its own retried poll (the rollout can
      // briefly 502 before the new image settles).
      expect(
        probe.url.endsWith(`/t/${publishResult.tenantSlug}/`),
        'probe targeted the tenant-ROOT path',
      ).toBe(true);
      const canaryRoot = await expectTenantRootServes200(publishResult.tenantSlug);
      expect(canaryRoot.status, 'canary tenant-ROOT path serves 200').toBe(200);

      // Systemic guard (429-storm fix): the canary's publish rebuilt the WHOLE
      // kefi-landings image — getStaticPaths re-fetches EVERY published tenant.
      // The old single-slug check passed even when the build's 429 storm dropped
      // OTHER tenants' roots. Sweep a sample of config-only sibling roots and
      // assert none 403/404 — that would mean the rebuild dropped their
      // index.html. (Canary orphans `e2c-…` are excluded by the sweep.)
      const siblings = await sweepSiblingTenantRoots({
        excludeSlugs: [publishResult.tenantSlug],
      });
      expect(
        siblings.forbidden,
        `sibling tenant roots dropped by the rebuild (403/404): ${siblings.forbidden
          .map((p) => `${p.slug}=${String(p.status)}`)
          .join(', ')}`,
      ).toEqual([]);

      // ── 6. Sweep — one of each resource class should be deleted ───────
      const cleanup = await adminClient.canaryCleanup(ctx.canaryId);
      expect(cleanup.tenantsDeleted).toBe(1);
      expect(cleanup.usersDeleted).toBe(1);

      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient });
    }
  });
});
