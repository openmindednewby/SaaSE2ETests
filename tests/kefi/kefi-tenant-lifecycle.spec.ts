/**
 * Kefi tenant-lifecycle E2E (Phases B + C + D).
 *
 * End-to-end self-serve nightly canary:
 *   1. Marketing /signup form creates a verified tenant via IMAP loopback.
 *   2. Tenant owner logs into kefi-web, completes the 7-step onboarding wizard
 *      (canary stub data; KUCY template; Pro plan).
 *   3. Welcome-email sweep is force-triggered, the bot mailbox is polled
 *      for "Welcome to Kefi" at the canary address — proves end-to-end
 *      transactional SMTP from Maddy via the welcome worker.
 *   4. API-side, the canary's saved landing-config is overwritten with a
 *      KUCY-shaped fixture (template='kucy' + full LandingConfigDto shape).
 *   5. Tenant owner publishes — the publish job rebuilds kefi-landings and
 *      rolls out the new image.
 *   6. Subdomain probe asserts KUCY's hand-authored landing
 *      (https://kizomba-union-cy.kefi.dloizides.com/) still renders every
 *      expected template marker after the rebuild. Catches regressions in
 *      shared template-1 components and the API overlay pipeline.
 *   7. Phase-A canary-cleanup sweep removes the tenant + KC user + per-tenant
 *      Ingress + Certificate + TLS Secret, leaving zero residue.
 *
 * Runs on staging + prod via the existing E2E_TARGET switch. Local is skipped
 * pending a kefi-marketing + kefi-api + kefi-web dev stack.
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { buildKucyShapedConfig } from '../../helpers/kefi/kefiKucyShapedConfig.js';
import { probeKucyLandingRender } from '../../helpers/kefi/kefiKucyProbe.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Spec runs serially — parallel runs share one bot mailbox + one Maddy SMTP
// queue, and Phase C also reuses the single kefi-landings Deployment (rapid
// successive publishes would cause rollouts to step on each other).
test.describe.configure({ mode: 'serial' });

/** Days from today the canary event is set to — far enough that no validator complains. */
const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Format a Date as YYYY-MM-DD (UTC). The wizard's event-date field accepts ISO. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

test.describe('Kefi tenant lifecycle — full self-serve canary', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi lifecycle E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('signs up, completes wizard, publishes, asserts KUCY renders, cleans up', async ({ page }) => {
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

      // ── 2. IMAP: wait for verification email ─────────────────────────
      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), {
        timeoutMs: 60_000,
        pollIntervalMs: 2_000,
      });
      const captured = await mailbox.waitForMessageTo(ctx.email);
      expect(captured.to).toContain(ctx.email);

      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, `verify URL extracted from ${captured.subject}`).not.toBeNull();

      // ── 3. Verify email → KC emailVerified=true ──────────────────────
      // The verify URL is the kefi-web SPA route (/verify-email?token=...).
      // GETting it just returns the HTML shell — the actual verify is a
      // POST /bff/verify-email that the page's React code fires on mount.
      // Doing the POST from the spec directly is blocked by the BFF's
      // same-origin check (the spec's page is still on the marketing
      // host). Easiest path: navigate the browser to the verify URL and
      // wait for the SPA's success state — the React code does the
      // properly-originated POST itself. Phase D caught this; Phase B
      // used to GET-only and never noticed because nothing downstream
      // depended on tenant.Status=Active.
      await page.goto(verifyUrl!);
      await expect(page.getByTestId('verify-email-success')).toBeVisible({ timeout: 30_000 });

      // ── 4. UI: log in as the canary owner; OnboardingGate redirects to /onboarding ──
      const login = new KefiLoginPage(page);
      await login.goto();
      await login.signInAndExpectOnboarding({
        email: ctx.email,
        password: ctx.password,
      });

      // ── 5. UI: complete the 7-step onboarding wizard ─────────────────
      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      const eventDateIso = toIsoDate(new Date(Date.now() + CANARY_EVENT_DAYS_AHEAD * MS_PER_DAY));
      await wizard.completeAllSteps({
        canaryPrefix: ctx.slugPrefix,
        eventDateIso,
      });

      // ── 6. API: trigger welcome-email sweep + IMAP-poll the inbox ────
      // Phase D — the wizard's `complete` POST flips
      // Tenant.OnboardingCompleted=true, which makes the tenant eligible
      // for the welcome-email worker. Force-running the sweep skips the
      // worker's normal 5-min cadence so the spec stays under 3 min total.
      // The IMAP assertion is the binding end-to-end SMTP proof; the DB-state
      // probe below is the corroborating signal (plan-doc decision #24 wanted
      // both). The worker stamps `Tenant.WelcomeEmailSentAt` only AFTER the
      // dispatcher returns true, so the column being non-null and the email
      // landing in the inbox should always agree.
      const sweepResult = await adminClient.triggerWelcomeSweep();
      // EligibleCount may already be > 0 from other test runs that landed
      // between the worker's last tick and our trigger; what matters is the
      // welcome lands at our specific canary address within the budget.
      expect(sweepResult.eligibleCount, 'welcome sweep eligibleCount').toBeGreaterThanOrEqual(0);

      const welcomeMailbox = new KefiMailbox(loadKefiMailboxConfig(), {
        timeoutMs: 60_000,
        pollIntervalMs: 2_000,
      });
      const welcome = await welcomeMailbox.waitForMessageTo(ctx.email, {
        subjectIncludes: 'Welcome to Kefi',
      });
      expect(welcome.subject, 'welcome email subject').toContain('Welcome to Kefi');
      expect(welcome.to, 'welcome email To').toContain(ctx.email);

      // ── 6b. DB-state probe — assert the worker stamped WelcomeEmailSentAt.
      // GET /internal/canary-tenant (Phase-D follow-up endpoint). The email
      // already arrived above, so the stamp must be set; this catches a
      // regression where the email sends but the dedup column doesn't stamp
      // (which would make the worker re-send on every future tick).
      const tenantState = await adminClient.getCanaryTenantState(ctx.canaryId);
      expect(tenantState.found, 'canary tenant found in DB').toBe(true);
      expect(tenantState.status, 'canary tenant status').toBe('Active');
      expect(tenantState.onboardingCompleted, 'canary onboarding completed').toBe(true);
      expect(
        tenantState.welcomeEmailSentAtUtc,
        'WelcomeEmailSentAt stamped after welcome dispatch',
      ).not.toBeNull();

      // ── 7. API: overwrite landing-config with KUCY-shaped fixture ────
      const kucyShaped = buildKucyShapedConfig(ctx.slugPrefix);
      await adminClient.putLandingConfig({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
        dto: kucyShaped,
      });

      // ── 8. API: publish + poll until Succeeded ───────────────────────
      const publishResult = await adminClient.publishLanding({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
      });
      expect(publishResult.status, 'publish enqueued').toBe('Enqueued');
      expect(publishResult.jobName.length, 'publish jobName').toBeGreaterThan(0);

      const terminal = await adminClient.pollPublishStatus({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
        jobName: publishResult.jobName,
      });
      expect(terminal.status, `publish job ${publishResult.jobName} terminal`).toBe('Succeeded');

      // ── 9. Probe: KUCY landing still renders every expected marker ──
      // The canary publish rebuilt the kefi-landings image. KUCY is the
      // hand-authored proxy for "self-serve rendering would have worked
      // if Astro getStaticPaths supported dynamic tenants" — see
      // helpers/kefi/kefiKucyProbe.ts for the deliberate choice.
      const probe = await probeKucyLandingRender();
      expect(probe.missingMarkers, `KUCY markers after canary publish`).toEqual([]);

      // ── 10. Sweep — exactly one of each resource class should be deleted ──
      const cleanup = await adminClient.canaryCleanup(ctx.canaryId);
      expect(cleanup.tenantsDeleted).toBe(1);
      expect(cleanup.usersDeleted).toBe(1);
      expect(cleanup.ingressesDeleted).toBeGreaterThanOrEqual(1);
      // Cert + secret may be absent if cert-manager HTTP-01 hasn't completed
      // by the time we sweep — verified separately in Phase A's manual smoke.
      expect(cleanup.certificatesDeleted).toBeGreaterThanOrEqual(0);
      expect(cleanup.secretsDeleted).toBeGreaterThanOrEqual(0);

      // ── 11. Mailbox hygiene — expunge both captured messages ────────
      await mailbox
        .expungeMessages([captured.uid, welcome.uid])
        .catch(() => undefined);
    } finally {
      // Always sweep, even if any assertion threw. Idempotent — re-sweep returns 0s.
      await cleanupKefiCanary(ctx.canaryId, { adminClient });
    }
  });
});
