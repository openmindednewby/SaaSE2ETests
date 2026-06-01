/**
 * Kefi device-PIN unlock E2E (unified-login Increment 1, Batch 5).
 *
 * Proves the remembered-device PIN-unlock journey end-to-end through the real
 * kefi-web SPA + bff-kefi BFF + Keycloak:
 *   1. Self-serve signup + IMAP verify magic-link-auto-logs-in the tenant owner
 *      (reusing the tenant-lifecycle setup) — gives a real, Active, authenticated
 *      session.
 *   2. ENROL: POST /bff/pin/enroll with the session cookie acquires a Keycloak
 *      offline token, stores the Argon2id PIN hash, and sets the device cookie
 *      (__Host-bffdev-kefi). [If this 502s on staging, the kefi realm hasn't made
 *      the `offline_access` client scope assignable to bff-kefi-client — a
 *      config-only fix; the assertion message says so.]
 *   3. UNLOCK (happy path): a SECOND browser context carrying ONLY the device
 *      cookie (no session) — a returning, logged-out, remembered device — loads
 *      /login, sees the PIN-only gate (driven by GET /bff/config hasPin +
 *      rememberedUsername), enters the PIN, and is signed in (a fresh session
 *      cookie is minted from the stored offline token).
 *   4. WRONG PIN + LOCKOUT: a device-cookie-only context drives /bff/pin/unlock
 *      directly — a wrong PIN is a generic 401; after the failure threshold the
 *      device locks with 429 + Retry-After.
 *   5. DISABLE: with the authenticated session, POST /bff/pin/disable revokes the
 *      offline token at KC, deletes the device record, and clears the device
 *      cookie — after which the remembered device can no longer unlock (401).
 *   6. Phase-A canary-cleanup removes the tenant + KC user + per-tenant resources.
 *
 * The PIN is NEVER sent to Keycloak and NEVER a standalone credential — it
 * unlocks a KC-issued offline token the BFF holds. Keycloak stays sole issuer.
 *
 * DISTINCT from the event-staff PIN (`/bff/pin/login`, needs eventExternalId);
 * this is the per-user device unlock. Runs on staging + prod via E2E_TARGET;
 * local is skipped (no kefi marketing+api+web dev stack wired in the dev-loop).
 */

import { test, expect, type APIRequestContext, type Cookie } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiDevicePinPage } from '../../pages/kefi/KefiDevicePinPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Serial — the negative/lockout phase mutates the single device record, and the
// run shares one bot mailbox + one Maddy SMTP queue with the other kefi canaries.
test.describe.configure({ mode: 'serial' });

const CSRF_HEADER = 'X-BFF-Csrf';
const CSRF_VALUE = '1';
const SESSION_COOKIE = '__Host-bff-kefi';
const DEVICE_COOKIE = '__Host-bffdev-kefi';

/** The canary's chosen PIN — 6 digits (Kefi's default `pinDigits`). */
const CANARY_PIN = '246813';
const CANARY_PIN_DIGITS = 6;
const WRONG_PIN = '999999';

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
/** Engine default `MaxFailures` is 5 → the 6th wrong attempt is device-locked. */
const MAX_LOCKOUT_ITERATIONS = 12;
const NAV_TIMEOUT_MS = 30_000;
/**
 * The BFF's per-IP "BffAuth" rate limiter (5 req / 60s sliding window, 10s
 * segments) sits IN FRONT of the device-PIN lockout. Its 429s have an EMPTY
 * body; the device-lockout 429 has a JSON `{error}` body + Retry-After. Calls
 * poll with a backoff between rate-limited attempts so they can reach the
 * device-PIN logic underneath.
 */
const RATE_LIMIT_BACKOFF_MS = 15_000;
const RATE_LIMIT_MAX_WAIT_MS = 120_000;

/** POSTs a device-PIN endpoint with the CSRF header the BFF requires. */
function pinPost(
  request: APIRequestContext,
  path: string,
  data?: Record<string, unknown>,
): ReturnType<APIRequestContext['post']> {
  const { webUrl } = getKefiUrls();
  // Origin must be sent explicitly: the BFF's anti-forgery gate checks the
  // CSRF header AND an allow-listed Origin/Referer. Browsers add Origin
  // automatically; Playwright's APIRequestContext does not.
  return request.post(`${webUrl}${path}`, {
    headers: { [CSRF_HEADER]: CSRF_VALUE, Origin: webUrl },
    data: data ?? {},
  });
}

/**
 * Like {@link pinPost}, but polls through the per-IP rate limiter: an
 * empty-body 429 (the "BffAuth" sliding-window limiter) is retried on a
 * backoff interval, while any other response — including the device-lockout
 * 429, which carries a JSON body — resolves the poll and is returned as-is.
 */
async function pinPostThroughRateLimit(
  request: APIRequestContext,
  path: string,
  data?: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext['post']>>> {
  let lastResponse: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  await expect
    .poll(
      async () => {
        lastResponse = await pinPost(request, path, data);
        if (lastResponse.status() !== HTTP_TOO_MANY_REQUESTS) return 'reached';
        const body = await lastResponse.text();
        // Device-lockout 429s carry a JSON body — that IS the signal we want.
        return body.length > 0 ? 'reached' : 'rate-limited';
      },
      {
        message: `waiting out the per-IP BffAuth rate limiter on ${path}`,
        intervals: [RATE_LIMIT_BACKOFF_MS],
        timeout: RATE_LIMIT_MAX_WAIT_MS,
      },
    )
    .toBe('reached');
  return lastResponse!;
}

/** Finds a captured cookie by name, asserting it exists. */
function requireCookie(cookies: Cookie[], name: string): Cookie {
  const cookie = cookies.find((c) => c.name === name);
  expect(cookie, `cookie ${name} present`).toBeDefined();
  return cookie!;
}

test.describe('Kefi device-PIN unlock — enrol, unlock, lockout, disable', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi device-PIN E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('returning device unlocks with a PIN; wrong PIN locks out; disable revokes', async ({
    browser,
    page,
  }) => {
    const ctx = newCanaryContext();
    const adminClient = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    try {
      // ── 1. Signup + IMAP verify → magic-link auto-login (authenticated) ──
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
      const captured = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();

      // Navigating the verify URL POSTs /bff/verify-and-login on mount → the
      // Playwright context is authenticated once that completes. The completion
      // signal is the SPA routing to /organizer/onboarding (the wizard) — the
      // verify page's own pathname (/verify-email) must NOT be treated as done,
      // or we race the session-cookie mint and the enroll below 401s.
      await page.goto(verifyUrl!);
      await page.waitForURL((url) => url.pathname.includes('/organizer'), {
        timeout: NAV_TIMEOUT_MS,
      });

      // ── 2. ENROL: bind a device PIN to this strong session ──────────────
      const enrollResp = await pinPost(page.request, '/bff/pin/enroll', {
        pin: CANARY_PIN,
        digits: CANARY_PIN_DIGITS,
      });
      expect(
        enrollResp.status(),
        'enroll OK — a 502 here means bff-kefi-client lacks the offline_access client scope on the kefi realm (config-only fix)',
      ).toBe(HTTP_OK);

      const ownerCookies = await page.context().cookies();
      const deviceCookie = requireCookie(ownerCookies, DEVICE_COOKIE);
      requireCookie(ownerCookies, SESSION_COOKIE); // proves we enrolled from a real session

      // ── 3. UNLOCK (happy path) via the UI on a remembered, logged-out device ──
      // A fresh context carrying ONLY the device cookie — no session.
      const returningContext = await browser.newContext();
      await returningContext.addCookies([deviceCookie]);
      const returningPage = await returningContext.newPage();

      const devicePin = new KefiDevicePinPage(returningPage);
      await devicePin.gotoAndExpectUnlockGate();
      await devicePin.submitPin(CANARY_PIN);
      await returningPage.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: NAV_TIMEOUT_MS,
      });

      const afterUnlock = await returningContext.cookies();
      requireCookie(afterUnlock, SESSION_COOKIE); // a fresh session was minted
      await returningContext.close();

      // ── 4. WRONG PIN + LOCKOUT (API-level, device-cookie-only context) ──
      // A separate context so the happy-path session above is untouched. The
      // successful unlock in step 3 reset the failure counter, so we start clean.
      // pinPostThroughRateLimit waits out the per-IP "BffAuth" limiter (empty-body
      // 429s) so the loop can reach the DEVICE lockout (JSON-body 429) underneath.
      const lockoutContext = await browser.newContext();
      await lockoutContext.addCookies([deviceCookie]);

      const firstWrong = await pinPostThroughRateLimit(lockoutContext.request, '/bff/pin/unlock', {
        pin: WRONG_PIN,
      });
      expect(firstWrong.status(), 'first wrong PIN is a generic 401').toBe(HTTP_UNAUTHORIZED);

      // Keep submitting wrong PINs until the device locks. Engine default
      // threshold is 5 failures → the 6th wrong attempt is locked out.
      let lockedStatus = firstWrong.status();
      let retryAfter: string | null = null;
      for (let attempt = 2; attempt <= MAX_LOCKOUT_ITERATIONS; attempt++) {
        const resp = await pinPostThroughRateLimit(lockoutContext.request, '/bff/pin/unlock', {
          pin: WRONG_PIN,
        });
        lockedStatus = resp.status();
        if (lockedStatus === HTTP_TOO_MANY_REQUESTS) {
          retryAfter = resp.headers()['retry-after'] ?? null;
          break;
        }
        expect(lockedStatus, `wrong-PIN attempt ${attempt} before lockout`).toBe(HTTP_UNAUTHORIZED);
      }
      expect(lockedStatus, 'device locks out after the failure threshold').toBe(
        HTTP_TOO_MANY_REQUESTS,
      );
      expect(retryAfter, 'device-lockout 429 carries a Retry-After header').not.toBeNull();
      await lockoutContext.close();

      // ── 5. DISABLE revokes the offline token + clears the device record ──
      // (Same per-IP rate-limit bucket as the lockout loop above — wait it out.)
      const disableResp = await pinPostThroughRateLimit(page.request, '/bff/pin/disable');
      expect(disableResp.status(), 'disable OK').toBe(HTTP_OK);

      // The remembered device can no longer unlock — the record is gone, so a
      // (correct) PIN now returns the generic 401, NOT 429 (the lockout was on
      // the deleted record). Proves disable severs the device, not just locks it.
      const afterDisableContext = await browser.newContext();
      await afterDisableContext.addCookies([deviceCookie]);
      const afterDisable = await pinPostThroughRateLimit(
        afterDisableContext.request,
        '/bff/pin/unlock',
        { pin: CANARY_PIN },
      );
      expect(
        afterDisable.status(),
        'a disabled device cannot unlock (record deleted → generic 401)',
      ).toBe(HTTP_UNAUTHORIZED);
      await afterDisableContext.close();

      // ── 6. Mailbox hygiene ──────────────────────────────────────────────
      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient });
    }
  });
});
