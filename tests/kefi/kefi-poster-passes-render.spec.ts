/**
 * Kefi published poster + pass RENDER E2E (task #276 gap #7, feature #266).
 *
 * The crew-lifecycle @slow spec PUBLISHES a landing carrying display passes +
 * posters, but only asserts the publish job reached Succeeded — never that those
 * tiers + posters actually RENDER to a visitor. This closes the #266 render gap:
 * it extends the coverage from "published" to "rendered".
 *
 *   1. signup → IMAP verify → wizard → a verified FREE canary tenant.
 *   2. PUT a landing config carrying three price tiers (€15/€30/€20) + a poster
 *      with a REAL image URL (placehold.co, so the poster emits an <img>).
 *   3. publish → poll the kaniko job to Succeeded.
 *   4. probe the canary's OWN published page and assert the price-tier pass label
 *      AND the poster image URL are present in the served HTML — i.e. #266's
 *      passes + posters rendered, not merely persisted.
 *
 * `@slow` (spans the kaniko publish build on the shared kefi-landings Deployment).
 * Free-tier publish (Phase F) — no Pro plan, no master-admin. WRITE + COMPILE-
 * verified; runs post-F1-kefi (signup auth) on the nightly lane.
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
import { buildDuplicatedLandingConfig } from '../../helpers/kefi/kefiDuplicatedLandingConfig.js';
import { placeholderHero } from '../../helpers/kefi/kefiPlaceholderImages.js';
import { probeDynamicLandingRender } from '../../helpers/kefi/kefiDynamicLandingProbe.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const CANARY_EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// The kaniko publish build runs on staging's memory-tight single kefi-landings
// Deployment, where a cold build has been observed to take ~8-12 min (vs a few
// minutes on prod). The budgets below are deliberately generous so a slow — but
// still succeeding — staging build does not false-fail this @slow spec:
//   • test ceiling (25 min) > signup/wizard (~2-3 min) + poll (up to 15 min) +
//     render probe (up to 4 min), with headroom.
//   • poll (15 min) comfortably covers the worst-case ~12 min build.
// If a run STILL cannot reach Succeeded inside this budget it is a staging
// resource limit (the feature publishes fine on prod), not a product defect —
// the spec is @slow + owns its own Playwright project, so it is fully isolated
// from the core lane and cannot block it.
const PUBLISH_BUILD_TIMEOUT_MS = 1_500_000;
const PUBLISH_POLL_TIMEOUT_MS = 900_000;
const PUBLISH_POLL_INTERVAL_MS = 8_000;
const RENDER_PROBE_TIMEOUT_MS = 240_000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

test.describe('Kefi published poster + pass render (#266)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi poster/pass-render E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@slow a published landing renders its price tiers and poster image', async ({ page }) => {
    // The kaniko publish build on the shared kefi-landings Deployment is the slow,
    // variable part — budget well beyond the default poll so it does not flake.
    test.setTimeout(PUBLISH_BUILD_TIMEOUT_MS);
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const posterImageUrl = placeholderHero();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    try {
      // ── 1. Verified canary tenant (signup → IMAP verify → wizard) ─────────
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await new KefiSignupSuccessPage(page).expectLoaded();

      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 90_000, pollIntervalMs: 2_000 });
      const captured = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, 'verify URL').not.toBeNull();
      await page.goto(verifyUrl!);

      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      await wizard.fillFastPath({
        canaryPrefix: ctx.slugPrefix,
        eventDateIso: toIsoDate(new Date(Date.now() + CANARY_EVENT_DAYS_AHEAD * MS_PER_DAY)),
      });
      await wizard.finishFromReview();

      // ── 2. PUT a config with price tiers + a poster carrying a real image ──
      await admin.putLandingConfig({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
        dto: buildDuplicatedLandingConfig(ctx.slugPrefix, { posterImageUrl }),
      });

      // ── 3. Publish (Free may publish since Phase F) → poll to Succeeded ───
      const publish = await admin.publishLanding({ ownerEmail: ctx.email, ownerPassword: ctx.password });
      expect(publish.status, 'publish enqueued').toBe('Enqueued');
      const terminal = await admin.pollPublishStatus({
        ownerEmail: ctx.email, ownerPassword: ctx.password, jobName: publish.jobName,
        timeoutMs: PUBLISH_POLL_TIMEOUT_MS, pollIntervalMs: PUBLISH_POLL_INTERVAL_MS,
      });
      expect(terminal.status, `publish job ${publish.jobName} terminal`).toBe('Succeeded');

      // ── 4. The published page RENDERS the price tier + the poster image ──
      // The pass label is canary-unique; the poster image URL proves the <img>
      // was emitted. Both present ⇒ #266 passes + posters rendered, not just
      // persisted. probeDynamicLandingRender retries while the rollout settles.
      const probe = await probeDynamicLandingRender({
        slug: publish.tenantSlug,
        requiredMarkers: [`${ctx.slugPrefix}Full Pass`, posterImageUrl],
        timeoutMs: RENDER_PROBE_TIMEOUT_MS,
      });
      expect(probe.missingMarkers, 'the price tier + poster image rendered on the published page').toEqual([]);

      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});
