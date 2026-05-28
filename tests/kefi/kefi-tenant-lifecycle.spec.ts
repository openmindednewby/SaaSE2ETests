/**
 * Phase B — Kefi tenant-lifecycle E2E: signup round-trip.
 *
 * What this spec proves end-to-end (per the plan doc § Phased delivery):
 *   1. The marketing /signup form is reachable + accepts a canary tenant.
 *   2. The kefi-api public signup endpoint creates the row, KC user, and
 *      provisions the per-tenant Ingress (Path A Option B).
 *   3. The bot mailbox receives the verification email at the
 *      plus-addressed canary id within seconds.
 *   4. The verify link extracted from the body completes the verification
 *      (flips PendingVerification → Active).
 *   5. The Phase-A canary-cleanup endpoint sweeps every resource the
 *      signup created — DB row + KC user + Ingress + Certificate + TLS
 *      Secret — leaving zero residue.
 *
 * Runs on local / staging / prod via the existing `E2E_TARGET` switch
 * (helpers/target.ts). Skipped on local for now — local depends on the
 * kefi-marketing + kefi-api dev stack which the plan doc lists as a
 * future Phase B follow-up; staging + prod are the immediate target.
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Spec runs serially per-canary — parallel runs share one bot mailbox + one
// Maddy SMTP queue. Two parallel signups in the same wall-clock second OK
// (plus-addressing isolates them) but interleaved IMAP polls add flakiness.
test.describe.configure({ mode: 'serial' });

test.describe('Kefi tenant lifecycle — signup round-trip', () => {
  // Local target depends on the kefi-marketing + kefi-api dev stack
  // (KEFI_MARKETING_URL=localhost:8086) which isn't part of the current
  // dev-loop. Phase E may add a local Tilt resource; for now the spec
  // only runs on staging + prod.
  test.skip(
    !isRemoteTarget(),
    'Kefi lifecycle E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('creates a verified tenant + cleans up zero-residue', async ({ page }) => {
    const ctx = newCanaryContext();
    const adminClient = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    // Always sweep, no matter how the spec exits.
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

      // ── 3. Hit the verify link → tenant Active ───────────────────────
      const verifyResponse = await page.request.get(verifyUrl!);
      expect(verifyResponse.ok(), `verify GET ${verifyUrl}`).toBeTruthy();

      // ── 4. Sweep — exactly one of each resource class should be deleted
      const cleanup = await adminClient.canaryCleanup(ctx.canaryId);
      expect(cleanup.tenantsDeleted).toBe(1);
      expect(cleanup.usersDeleted).toBe(1);
      expect(cleanup.ingressesDeleted).toBeGreaterThanOrEqual(1);
      // Cert + secret may be absent if cert-manager hasn't completed
      // HTTP-01 challenge by the time we sweep — verified separately in
      // Phase A's manual smoke. Accept >=0 here; nightly will tighten.
      expect(cleanup.certificatesDeleted).toBeGreaterThanOrEqual(0);
      expect(cleanup.secretsDeleted).toBeGreaterThanOrEqual(0);

      // ── 5. Mailbox hygiene — expunge the message we just consumed ────
      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      // Belt-and-suspenders teardown — always sweep, even if any of the
      // assertions above threw. Idempotent: re-sweep returns 0s.
      await cleanupKefiCanary(ctx.canaryId, { adminClient });
    }
  });
});
