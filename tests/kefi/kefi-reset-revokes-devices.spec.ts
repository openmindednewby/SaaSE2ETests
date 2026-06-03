/**
 * Password-reset revokes remembered devices (unified-login #169, Batch 6 Seam 1).
 *
 * Proves the security seam end-to-end through the real kefi-web BFF +
 * TenantService + Keycloak: after a user resets their password, every
 * previously remembered device (device-PIN enrolment backed by a KC offline
 * token) must stop working.
 *
 *   1. Self-serve signup + IMAP verify → authenticated session (canary user
 *      with a real bot mailbox).
 *   2. ENROL a device PIN → device cookie + KC offline token.
 *   3. BASELINE — unlock TWICE: the remembered device must unlock repeatedly.
 *      The second unlock specifically guards the engine's offline-token
 *      ROTATION handling (Bff.AspNetCore 1.3.2): the realms revoke refresh
 *      tokens on use, so unlock #2 replays a dead token unless the engine
 *      persisted the rotated one. On 1.3.1 this step fails (the device dies
 *      after one unlock).
 *   4. FORGOT + RESET: POST /bff/forgot-password → reset email via IMAP →
 *      POST /bff/reset-password with the emailed token. This drives
 *      TenantService's reset path, which (the seam) revokes the user's KC
 *      sessions AND offline-token grants.
 *   5. THE SEAM ASSERTION: the same device cookie + correct PIN now gets a
 *      generic 401 — the revoked offline grant failed its refresh, so the
 *      BFF engine self-healed by deleting the device record. Without the
 *      TenantService revocation this step gets 200 (a stolen-then-reset
 *      password keeps working through remembered devices).
 *   6. Sanity: the NEW password logs in via /bff/login (the reset really
 *      took effect at Keycloak).
 *   7. Canary cleanup.
 *
 * Step 3 and step 5 together make the test self-discriminating: a 401 in
 * step 5 can only be caused by the reset (step 3 proved repeated unlocks
 * work), and a pass requires BOTH the engine rotation fix AND the
 * TenantService revocation to be deployed.
 *
 * Runs on staging + prod via E2E_TARGET; local is skipped (no kefi stack in
 * the dev loop).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
  type CapturedEmail,
} from '../../helpers/kefi/kefiMailboxClient.js';
import {
  bffPost,
  bffPostThroughRateLimit,
  requireCookie,
  DEVICE_COOKIE,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from '../../helpers/kefi/kefiBffApi.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Serial + own project: shares the bot mailbox + Maddy SMTP queue with the
// other kefi canaries, and the per-IP BffAuth rate limiter with everything.
test.describe.configure({ mode: 'serial' });

/** The canary's chosen PIN — 6 digits (Kefi's default `pinDigits`). */
const CANARY_PIN = '246813';
const CANARY_PIN_DIGITS = 6;

/** Satisfies KC's password policy (length + upper + digit + special). */
const ROTATED_PASSWORD = 'K!Rotated-E2e-Pass-123';

const NAV_TIMEOUT_MS = 30_000;
const RESET_EMAIL_SUBJECT = 'Reset your password';

/**
 * Extracts the raw reset token from the reset email. The email body carries
 * the SPA reset link built from the `resetUrlTemplate` we posted —
 * `{webUrl}/reset-password?token={token}` — with the token URL-encoded and,
 * in the HTML part, `&` escaped as `&amp;`.
 */
function extractResetToken(email: CapturedEmail): string | null {
  const body = `${email.bodyHtml ?? ''}\n${email.bodyText}`;
  const match = body.match(/reset-password\?token=([A-Za-z0-9%_\-.~]+)/);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

test.describe('Kefi password reset revokes remembered devices', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi reset-revokes-devices E2E targets staging+prod; local stack not wired in dev-loop',
  );

  test('after a password reset, a previously remembered device can no longer PIN-unlock', async ({
    browser,
    page,
  }) => {
    const ctx = newCanaryContext();
    const adminClient = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    try {
      // ── 1. Signup + IMAP verify → authenticated session ─────────────────
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await new KefiSignupSuccessPage(page).expectLoaded();

      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), {
        timeoutMs: 60_000,
        pollIntervalMs: 2_000,
      });
      const verifyEmail = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(verifyEmail);
      expect(verifyUrl, `verify URL from ${verifyEmail.subject}`).not.toBeNull();

      await page.goto(verifyUrl!);
      await page.waitForURL((url) => url.pathname.includes('/organizer'), {
        timeout: NAV_TIMEOUT_MS,
      });

      // ── 2. ENROL: bind a device PIN to this strong session ──────────────
      const enrollResp = await bffPost(page.request, '/bff/pin/enroll', {
        pin: CANARY_PIN,
        digits: CANARY_PIN_DIGITS,
      });
      expect(enrollResp.status(), 'enroll OK').toBe(HTTP_OK);
      const deviceCookie = requireCookie(await page.context().cookies(), DEVICE_COOKIE);

      // ── 3. BASELINE: the remembered device unlocks — REPEATEDLY ─────────
      // Two unlocks back-to-back. The second one guards the engine's
      // offline-token rotation handling (1.3.2): the realm revokes refresh
      // tokens on use, so this replay dies with 401 on an engine that does
      // not persist the rotated token. It also pins the meaning of step 5's
      // 401 — repeated unlocks work, so only the reset can sever the device.
      const baselineContext = await browser.newContext();
      await baselineContext.addCookies([deviceCookie]);
      const firstUnlock = await bffPostThroughRateLimit(
        baselineContext.request,
        '/bff/pin/unlock',
        { pin: CANARY_PIN },
      );
      expect(firstUnlock.status(), 'device unlocks BEFORE the password reset').toBe(HTTP_OK);
      await baselineContext.close();

      const repeatContext = await browser.newContext();
      await repeatContext.addCookies([deviceCookie]);
      const repeatUnlock = await bffPostThroughRateLimit(
        repeatContext.request,
        '/bff/pin/unlock',
        { pin: CANARY_PIN },
      );
      expect(
        repeatUnlock.status(),
        'device unlocks REPEATEDLY (engine persists the rotated offline token — Bff.AspNetCore 1.3.2)',
      ).toBe(HTTP_OK);
      await repeatContext.close();

      // ── 4. FORGOT + RESET through the real BFF → TenantService flow ─────
      const { webUrl } = getKefiUrls();
      const forgotResp = await bffPostThroughRateLimit(page.request, '/bff/forgot-password', {
        email: ctx.email,
        resetUrlTemplate: `${webUrl}/reset-password?token={token}`,
      });
      expect(forgotResp.ok(), 'forgot-password accepted').toBe(true);

      // The verify email may still sit unseen in the inbox — filter by the
      // reset email's distinct subject so we don't re-match it.
      const resetEmail = await mailbox.waitForMessageTo(ctx.email, {
        subjectIncludes: RESET_EMAIL_SUBJECT,
      });
      const resetToken = extractResetToken(resetEmail);
      expect(resetToken, `reset token from "${resetEmail.subject}"`).not.toBeNull();

      const resetResp = await bffPostThroughRateLimit(page.request, '/bff/reset-password', {
        token: resetToken,
        newPassword: ROTATED_PASSWORD,
      });
      expect(resetResp.ok(), 'reset-password succeeded').toBe(true);

      // ── 5. THE SEAM: the remembered device must no longer unlock ────────
      // TenantService revoked the user's KC offline-token grants on reset; the
      // BFF self-heals on the dead token (deletes the device record) and
      // returns a generic 401. A 200 here means a stolen-then-reset password
      // still works through previously remembered devices — the exact gap
      // Seam 1 closes.
      const staleDeviceContext = await browser.newContext();
      await staleDeviceContext.addCookies([deviceCookie]);
      const staleUnlock = await bffPostThroughRateLimit(
        staleDeviceContext.request,
        '/bff/pin/unlock',
        { pin: CANARY_PIN },
      );
      expect(
        staleUnlock.status(),
        'a password reset severs previously remembered devices (revoked offline grant → 401)',
      ).toBe(HTTP_UNAUTHORIZED);
      await staleDeviceContext.close();

      // ── 6. Sanity: the NEW password logs in (the reset really happened) ──
      const freshLoginContext = await browser.newContext();
      const loginResp = await bffPostThroughRateLimit(freshLoginContext.request, '/bff/login', {
        username: ctx.email,
        password: ROTATED_PASSWORD,
      });
      expect(loginResp.status(), 'the rotated password signs in').toBe(HTTP_OK);
      await freshLoginContext.close();

      // ── 7. Mailbox hygiene ───────────────────────────────────────────────
      await mailbox
        .expungeMessages([verifyEmail.uid, resetEmail.uid])
        .catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient });
    }
  });
});
