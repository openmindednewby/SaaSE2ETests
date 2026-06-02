/**
 * Katalogos device-PIN + passkey E2E (unified-login Increment 3, Batch 3).
 *
 * Proves the rolled-out login methods end-to-end through the real katalogos-web
 * SPA (consuming the SHARED @dloizides/auth-web 1.4.0 components) + bff-katalogos
 * (Bff.AspNetCore 1.3.1) + the onlinemenu realm's Keycloak WebAuthn ceremony:
 *
 *   Test 1 — device PIN:
 *     login (seeded test user) → enrol a device PIN via /bff/pin/enroll → a
 *     SECOND browser context carrying ONLY the device cookie sees the shared
 *     DevicePinUnlockScreen gate on /login → unlocks with the PIN → fresh
 *     session minted. Then wrong-PIN 401s → device lockout 429 + Retry-After →
 *     disable revokes the record (stale device cookie can no longer unlock).
 *
 *   Test 2 — passkey:
 *     CDP virtual authenticator → /bff/passkey/register (KC password re-auth +
 *     WebAuthn ceremony) → clear cookies → the shared PasskeyLoginButton on
 *     /login → usernameless passkey login → /bff/me identifies the test user →
 *     a forged callback (no binding cookie) is rejected to /login?passkeyError=.
 *
 * Unlike the kefi specs (which sign up a fresh canary tenant per run via IMAP),
 * this spec uses the realm's SEEDED test user (TEST_USER_USERNAME /
 * TEST_USER_PASSWORD from .env.*) — katalogos has no self-serve signup flow to
 * lean on. Cleanup: the PIN device record is disabled at the end of test 1;
 * passkey credentials accumulate on the test user (KC handles multiples; noted
 * as an accepted cleanup gap).
 *
 * The app host comes from the project baseURL (katalogos-web per E2E_TARGET).
 * Runs on staging + prod; local is skipped (no katalogos BFF in the dev loop).
 */

import { test, expect, type APIRequestContext, type Cookie } from '@playwright/test';

import { isRemoteTarget } from '../../helpers/target.js';
import { loginAsTenantAdminBrowser } from '../../helpers/realm-browser-auth.js';
import {
  attachVirtualAuthenticator,
  driveKeycloakPages,
  isOnKeycloak,
} from '../../helpers/webauthn-helpers.js';

// Serial — both tests share the seeded user + the per-IP BffAuth rate limiter.
test.describe.configure({ mode: 'serial' });

const CSRF_HEADER = 'X-BFF-Csrf';
const CSRF_VALUE = '1';
const SESSION_COOKIE = '__Host-bff-katalogos';
const DEVICE_COOKIE = '__Host-bffdev-katalogos';

/** The seeded realm test user (created by keycloak-seed-test-users). */
const TEST_USER = {
  username: process.env.TEST_USER_USERNAME ?? '',
  password: process.env.TEST_USER_PASSWORD ?? '',
};

const CANARY_PIN = '135790';
const CANARY_PIN_DIGITS = 6;
const WRONG_PIN = '999999';

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
/** Engine default `MaxFailures` is 5 → the 6th wrong attempt is device-locked. */
const MAX_LOCKOUT_ITERATIONS = 12;
const NAV_TIMEOUT_MS = 30_000;
/** Shared-component testIDs (auth-web 1.4.0) with katalogos-web's testIdPrefix. */
const UNLOCK_GATE_TEST_ID = 'katalogos-auth-device-pin-unlock';
const UNLOCK_INPUT_TEST_ID = 'katalogos-auth-device-pin-unlock-input';
const UNLOCK_SUBMIT_TEST_ID = 'katalogos-auth-device-pin-unlock-submit';
const PASSKEY_BUTTON_TEST_ID = 'katalogos-auth-passkey-login-button';
const PASSKEY_ERROR_TEST_ID = 'katalogos-auth-passkey-login-error';

/**
 * The per-IP "BffAuth" rate limiter (5 req/60s, empty-body 429s) sits in front
 * of the device lockout (JSON-body 429 + Retry-After). Poll through it.
 */
const RATE_LIMIT_BACKOFF_MS = 15_000;
const RATE_LIMIT_MAX_WAIT_MS = 120_000;

/** POSTs a /bff endpoint with the CSRF header + explicit Origin the BFF requires. */
function bffPost(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  data?: Record<string, unknown>,
): ReturnType<APIRequestContext['post']> {
  return request.post(`${baseUrl}${path}`, {
    headers: { [CSRF_HEADER]: CSRF_VALUE, Origin: baseUrl },
    data: data ?? {},
  });
}

/** Like {@link bffPost}, but polls through the per-IP rate limiter's empty-body 429s. */
async function bffPostThroughRateLimit(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  data?: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext['post']>>> {
  let lastResponse: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  await expect
    .poll(
      async () => {
        lastResponse = await bffPost(request, baseUrl, path, data);
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

test.describe('Katalogos device-PIN + passkey (shared auth-web 1.4.0 components)', () => {
  test.skip(
    !isRemoteTarget(),
    'Katalogos login-methods E2E targets staging+prod; no local katalogos BFF in the dev loop',
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

    // ── 1. Sign in as the seeded test user (BFF ROPC via the SPA origin) ──
    await loginAsTenantAdminBrowser(page, TEST_USER);

    // ── 2. ENROL a device PIN against this strong session ─────────────────
    const enrollResp = await bffPostThroughRateLimit(page.request, appUrl, '/bff/pin/enroll', {
      pin: CANARY_PIN,
      digits: CANARY_PIN_DIGITS,
    });
    expect(
      enrollResp.status(),
      'enroll OK — a 502 here means bff-katalogos-client lacks the offline_access scope on the onlinemenu realm',
    ).toBe(HTTP_OK);

    const ownerCookies = await page.context().cookies();
    const deviceCookie = requireCookie(ownerCookies, DEVICE_COOKIE);
    requireCookie(ownerCookies, SESSION_COOKIE);

    // ── 3. UNLOCK via the SHARED DevicePinUnlockScreen on a remembered, logged-out device ──
    const returningContext = await browser.newContext();
    await returningContext.addCookies([deviceCookie]);
    const returningPage = await returningContext.newPage();

    await returningPage.goto(`${appUrl}/login`);
    await expect(
      returningPage.getByTestId(UNLOCK_GATE_TEST_ID),
      'the shared unlock gate renders for a remembered device',
    ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await returningPage.getByTestId(UNLOCK_INPUT_TEST_ID).fill(CANARY_PIN);
    await returningPage.getByTestId(UNLOCK_SUBMIT_TEST_ID).click();
    await returningPage.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: NAV_TIMEOUT_MS,
    });

    const afterUnlock = await returningContext.cookies();
    requireCookie(afterUnlock, SESSION_COOKIE);
    await returningContext.close();

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
      const resp = await bffPostThroughRateLimit(lockoutContext.request, appUrl, '/bff/pin/unlock', {
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

    // ── 5. DISABLE revokes the record; a stale device cookie can't unlock ──
    const disableResp = await bffPostThroughRateLimit(page.request, appUrl, '/bff/pin/disable');
    expect(disableResp.status(), 'disable OK').toBe(HTTP_OK);

    const staleContext = await browser.newContext();
    await staleContext.addCookies([deviceCookie]);
    const afterDisable = await bffPostThroughRateLimit(staleContext.request, appUrl, '/bff/pin/unlock', {
      pin: CANARY_PIN,
    });
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

    // ── 1. Sign in + attach the virtual platform authenticator ────────────
    await loginAsTenantAdminBrowser(page, TEST_USER);
    await attachVirtualAuthenticator(page);

    // ── 2. REGISTER a passkey (KC password re-auth + WebAuthn ceremony) ───
    await page.goto(`${appUrl}/bff/passkey/register?returnUrl=/`);
    await page.waitForURL(() => isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });
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
      page.getByTestId(PASSKEY_BUTTON_TEST_ID),
      'the shared passkey button renders (BFF advertises the passkey method)',
    ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await page.getByTestId(PASSKEY_BUTTON_TEST_ID).click();

    await page.waitForURL(() => isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });
    await driveKeycloakPages(page, {
      email: TEST_USER.username,
      password: TEST_USER.password,
    });
    await page.waitForURL((url) => !isOnKeycloak(page) && !url.pathname.includes('/login'), {
      timeout: NAV_TIMEOUT_MS,
    });

    // The passkey-minted session is real and belongs to the seeded user.
    const cookies = await page.context().cookies();
    requireCookie(cookies, SESSION_COOKIE);
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
    await expect(page.getByTestId(PASSKEY_ERROR_TEST_ID)).toBeVisible({
      timeout: NAV_TIMEOUT_MS,
    });
    const forgedCookies = await page.context().cookies();
    expect(
      forgedCookies.find((cookie) => cookie.name === SESSION_COOKIE),
      'a forged callback must not mint a session',
    ).toBeUndefined();
  });
});
