/**
 * Shared device-PIN + passkey E2E suite (unified-login Increment 3).
 *
 * One parameterised suite definition consumed by every product that rolled out
 * the unified login methods via the shared @dloizides/auth-web 1.4.0 components
 * (katalogos, erevna, …). Extracted from the Katalogos spec on its second use
 * (the Erevna rollout) — per-product spec files stay thin config callers.
 *
 *   Test 1 — device PIN:
 *     login (seeded test user) → enrol via /bff/pin/enroll → a SECOND context
 *     carrying ONLY the device cookie sees the shared DevicePinUnlockScreen gate
 *     on /login → unlocks → fresh session. Then wrong-PIN 401s → device lockout
 *     429 + Retry-After → disable revokes the record.
 *
 *   Test 2 — passkey:
 *     CDP virtual authenticator → /bff/passkey/register (KC re-auth + WebAuthn
 *     ceremony) → clear cookies → the shared PasskeyLoginButton on /login →
 *     usernameless passkey login → /bff/me identifies the user → a forged
 *     callback is rejected to /login?passkeyError=.
 *
 * Uses the realm's SEEDED test user (TEST_USER_USERNAME / TEST_USER_PASSWORD).
 * Cleanup: the PIN device record is disabled in test 1; passkey credentials
 * accumulate on the test user (KC handles multiples; accepted gap).
 *
 * The app host comes from the calling project's baseURL. Runs on staging +
 * prod; local is skipped.
 */

import { test, expect } from '@playwright/test';

import { definePreferredMethodTest } from './login-methods-preferred.js';
import { isRemoteTarget } from './target.js';
import {
  bffPostThroughRateLimit,
  gotoBffThroughRateLimit,
  loginThroughRateLimit,
  registerCookieBannerHandler,
  requireCookie,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  HTTP_TOO_MANY_REQUESTS,
} from './bff-auth-api.js';
import {
  attachVirtualAuthenticator,
  driveKeycloakPages,
  isOnKeycloak,
} from './webauthn-helpers.js';

/** Per-product parameters for the shared suite. */
export interface LoginMethodsSuiteConfig {
  /** Human name used in test titles, e.g. "Katalogos". */
  product: string;
  /** The BFF session cookie name, e.g. `__Host-bff-katalogos`. */
  sessionCookie: string;
  /** The BFF device cookie name, e.g. `__Host-bffdev-katalogos`. */
  deviceCookie: string;
  /** The app's testIdPrefix — shared-component testIDs are `{prefix}-auth-…`. */
  testIdPrefix: string;
}

/** The seeded realm test user (created by keycloak-seed-test-users). */
const TEST_USER = {
  username: process.env.TEST_USER_USERNAME ?? '',
  password: process.env.TEST_USER_PASSWORD ?? '',
};

const CANARY_PIN = '135790';
const CANARY_PIN_DIGITS = 6;
const WRONG_PIN = '999999';

/** Engine default `MaxFailures` is 5 → the 6th wrong attempt is device-locked. */
const MAX_LOCKOUT_ITERATIONS = 12;
const NAV_TIMEOUT_MS = 30_000;

/**
 * Defines the two-test login-methods suite for one product. Call from a spec
 * file (which should also set `test.describe.configure({ mode: 'serial' })` —
 * both tests share the seeded user + the per-IP rate limiter).
 */
export function defineLoginMethodsSuite(config: LoginMethodsSuiteConfig): void {
  const unlockGateTestId = `${config.testIdPrefix}-auth-device-pin-unlock`;
  const unlockInputTestId = `${config.testIdPrefix}-auth-device-pin-unlock-input`;
  const unlockSubmitTestId = `${config.testIdPrefix}-auth-device-pin-unlock-submit`;
  const passkeyButtonTestId = `${config.testIdPrefix}-auth-passkey-login-button`;
  const passkeyErrorTestId = `${config.testIdPrefix}-auth-passkey-login-error`;

  test.describe(`${config.product} device-PIN + passkey (shared auth-web 1.4.0 components)`, () => {
    test.skip(
      !isRemoteTarget(),
      `${config.product} login-methods E2E targets staging+prod; no local BFF in the dev loop`,
    );
    test.skip(
      TEST_USER.username === '' || TEST_USER.password === '',
      'TEST_USER_USERNAME / TEST_USER_PASSWORD not set in the target .env file',
    );

    test('device PIN: enrol, unlock on a remembered device, lockout, disable', async ({
      browser,
      page,
      baseURL,
    }) => {
      const appUrl = baseURL!;
      await registerCookieBannerHandler(page);

      // ── 1. Sign in as the seeded test user (BFF ROPC via the SPA origin) ──
      await loginThroughRateLimit(page, TEST_USER);

      // ── 2. ENROL a device PIN against this strong session ─────────────────
      const enrollResp = await bffPostThroughRateLimit(page.request, appUrl, '/bff/pin/enroll', {
        pin: CANARY_PIN,
        digits: CANARY_PIN_DIGITS,
      });
      expect(
        enrollResp.status(),
        'enroll OK — a 502 here means the BFF client lacks the offline_access scope on its realm',
      ).toBe(HTTP_OK);

      const ownerCookies = await page.context().cookies();
      const deviceCookie = requireCookie(ownerCookies, config.deviceCookie);
      requireCookie(ownerCookies, config.sessionCookie);

      // ── 3. UNLOCK via the SHARED DevicePinUnlockScreen on a remembered, logged-out device ──
      const returningContext = await browser.newContext();
      await returningContext.addCookies([deviceCookie]);
      const returningPage = await returningContext.newPage();
      await registerCookieBannerHandler(returningPage);

      await returningPage.goto(`${appUrl}/login`);
      await expect(
        returningPage.getByTestId(unlockGateTestId),
        'the shared unlock gate renders for a remembered device',
      ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
      await returningPage.getByTestId(unlockInputTestId).fill(CANARY_PIN);
      await returningPage.getByTestId(unlockSubmitTestId).click();
      await returningPage.waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: NAV_TIMEOUT_MS,
      });

      const afterUnlock = await returningContext.cookies();
      requireCookie(afterUnlock, config.sessionCookie);
      await returningContext.close();

      // ── 3b. REPEAT UNLOCK (API-level) — guards offline-token rotation ──────
      // The realms revoke refresh tokens on use, so this second unlock replays
      // a dead token unless the engine persisted the rotated one on the first
      // unlock (Bff.AspNetCore 1.3.2). On 1.3.1 the device dies after one use.
      const repeatContext = await browser.newContext();
      await repeatContext.addCookies([deviceCookie]);
      const repeatUnlock = await bffPostThroughRateLimit(
        repeatContext.request,
        appUrl,
        '/bff/pin/unlock',
        { pin: CANARY_PIN },
      );
      expect(
        repeatUnlock.status(),
        'device unlocks REPEATEDLY (engine persists the rotated offline token)',
      ).toBe(HTTP_OK);
      await repeatContext.close();

      // ── 4. WRONG PIN + LOCKOUT (API-level, device-cookie-only context) ─────
      const lockoutContext = await browser.newContext();
      await lockoutContext.addCookies([deviceCookie]);

      const firstWrong = await bffPostThroughRateLimit(
        lockoutContext.request,
        appUrl,
        '/bff/pin/unlock',
        { pin: WRONG_PIN },
      );
      expect(firstWrong.status(), 'first wrong PIN is a generic 401').toBe(HTTP_UNAUTHORIZED);

      let lockedStatus = firstWrong.status();
      let retryAfter: string | null = null;
      for (let attempt = 2; attempt <= MAX_LOCKOUT_ITERATIONS; attempt++) {
        const resp = await bffPostThroughRateLimit(
          lockoutContext.request,
          appUrl,
          '/bff/pin/unlock',
          { pin: WRONG_PIN },
        );
        lockedStatus = resp.status();
        if (lockedStatus === HTTP_TOO_MANY_REQUESTS) {
          retryAfter = resp.headers()['retry-after'] ?? null;
          break;
        }
        expect(lockedStatus, `wrong-PIN attempt ${attempt} before lockout`).toBe(
          HTTP_UNAUTHORIZED,
        );
      }
      expect(lockedStatus, 'device locks out after the failure threshold').toBe(
        HTTP_TOO_MANY_REQUESTS,
      );
      expect(retryAfter, 'device-lockout 429 carries a Retry-After header').not.toBeNull();
      await lockoutContext.close();

      // ── 5. DISABLE revokes the record; a stale device cookie can't unlock ──
      const disableResp = await bffPostThroughRateLimit(page.request, appUrl, '/bff/pin/disable');
      expect(disableResp.status(), 'disable OK').toBe(HTTP_OK);

      const staleContext = await browser.newContext();
      await staleContext.addCookies([deviceCookie]);
      const afterDisable = await bffPostThroughRateLimit(
        staleContext.request,
        appUrl,
        '/bff/pin/unlock',
        { pin: CANARY_PIN },
      );
      expect(
        afterDisable.status(),
        'a disabled device cannot unlock (record deleted → generic 401)',
      ).toBe(HTTP_UNAUTHORIZED);
      await staleContext.close();
    });

    test('passkey: register via the KC ceremony, sign in with it, forged callback rejected', async ({
      page,
      baseURL,
    }) => {
      const appUrl = baseURL!;
      await registerCookieBannerHandler(page);

      // ── 1. Sign in + attach the virtual platform authenticator ────────────
      await loginThroughRateLimit(page, TEST_USER);
      await attachVirtualAuthenticator(page);

      // ── 2. REGISTER a passkey (KC password re-auth + WebAuthn ceremony) ───
      // Navigation polls through rate-limit 429s — /bff/passkey/register shares
      // the per-IP limiter the PIN test's lockout phase may have drained.
      await gotoBffThroughRateLimit(page, `${appUrl}/bff/passkey/register?returnUrl=/`);
      await driveKeycloakPages(page, {
        email: TEST_USER.username,
        password: TEST_USER.password,
      });
      await page.waitForURL(() => !isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });

      // ── 3. SIGN OUT (cookies only — the authenticator keeps its credential) ──
      await page.context().clearCookies();

      // ── 4. PASSKEY LOGIN via the SHARED PasskeyLoginButton on /login ──────
      await page.goto(`${appUrl}/login`);
      await expect(
        page.getByTestId(passkeyButtonTestId),
        'the shared passkey button renders (BFF advertises the passkey method)',
      ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
      await page.getByTestId(passkeyButtonTestId).click();

      // The click navigates to /bff/passkey/login (also rate-limited). If the
      // window is drained the page shows a bare 429 — fall back to polling the
      // navigation directly (equivalent to the button's window.location.assign).
      const reachedKeycloak = await page
        .waitForURL(() => isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!reachedKeycloak) {
        await gotoBffThroughRateLimit(page, `${appUrl}/bff/passkey/login?returnUrl=/`);
      }
      await driveKeycloakPages(page, {
        email: TEST_USER.username,
        password: TEST_USER.password,
      });
      await page.waitForURL((url) => !isOnKeycloak(page) && !url.pathname.includes('/login'), {
        timeout: NAV_TIMEOUT_MS,
      });

      // The passkey-minted session is real and belongs to the seeded user.
      const cookies = await page.context().cookies();
      requireCookie(cookies, config.sessionCookie);
      const meResponse = await page.request.get(`${appUrl}/bff/me`);
      expect(meResponse.status(), 'passkey-minted session resolves /bff/me').toBe(HTTP_OK);
      const me = (await meResponse.json()) as { user?: { preferred_username?: string } };
      expect(
        me.user?.preferred_username?.toLowerCase(),
        'the passkey session belongs to the seeded test user',
      ).toBe(TEST_USER.username.toLowerCase());

      // ── 5. NEGATIVE: a forged callback cannot mint a session ──────────────
      await page.context().clearCookies();
      await page.goto(`${appUrl}/bff/passkey/callback?state=forged-state&code=forged-code`);
      await page.waitForURL((url) => url.searchParams.get('passkeyError') !== null, {
        timeout: NAV_TIMEOUT_MS,
      });
      await expect(page.getByTestId(passkeyErrorTestId)).toBeVisible({
        timeout: NAV_TIMEOUT_MS,
      });
      const forgedCookies = await page.context().cookies();
      expect(
        forgedCookies.find((cookie) => cookie.name === config.sessionCookie),
        'a forged callback must not mint a session',
      ).toBeUndefined();
    });

    // The cross-device preferred-method round-trip (D5) — its own module to keep
    // this file within the max-file-lines budget. Inherits the describe's skips.
    definePreferredMethodTest(TEST_USER);
  });
}
