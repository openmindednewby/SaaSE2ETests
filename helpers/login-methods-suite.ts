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

import { test, expect, type APIRequestContext, type Cookie, type Page } from '@playwright/test';

import { isRemoteTarget } from './target.js';
import { loginAsTenantAdminBrowser } from './realm-browser-auth.js';
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

const CSRF_HEADER = 'X-BFF-Csrf';
const CSRF_VALUE = '1';

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

/**
 * Auto-dismiss the app's cookie-consent banner whenever it blocks an
 * interaction (mirrors BasePage.registerOverlayHandlers). Without it, the
 * banner overlays the passkey button and intercepts the click.
 */
async function registerCookieBannerHandler(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.locator('[data-testid="cookie-consent-banner"]'),
    async () => {
      try {
        await page
          .locator('[data-testid="cookie-consent-accept-all"]')
          .click({ noWaitAfter: true, timeout: 5_000 });
      } catch {
        // Banner disappeared mid-navigation — safe to ignore.
      }
    },
  );
}

/**
 * Drives the browser to a rate-limited BFF GET endpoint (/bff/passkey/login or
 * /bff/passkey/register), polling through empty-body 429 pages. These endpoints
 * share the per-IP "BffAuth" limiter with the PIN endpoints, so in serial runs
 * the PIN test's lockout phase can leave the window drained — a navigation then
 * renders a bare 429 instead of redirecting to Keycloak.
 */
async function gotoBffThroughRateLimit(page: Page, url: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if (isOnKeycloak(page)) return 'on-keycloak';
        const response = await page.goto(url);
        if (response !== null && response.status() === HTTP_TOO_MANY_REQUESTS) {
          return 'rate-limited';
        }
        return isOnKeycloak(page) ? 'on-keycloak' : 'navigating';
      },
      {
        message: `waiting out the per-IP BffAuth rate limiter navigating to ${url}`,
        intervals: [RATE_LIMIT_BACKOFF_MS],
        timeout: RATE_LIMIT_MAX_WAIT_MS,
      },
    )
    .toBe('on-keycloak');
}

/**
 * Logs in via the BFF, polling through per-IP rate-limit 429s. The serial
 * device-PIN test's lockout phase deliberately drains the BffAuth limiter, so
 * the next test's first login can land inside a still-throttled window —
 * that's the limiter doing its job, not a product failure.
 */
async function loginThroughRateLimit(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          await loginAsTenantAdminBrowser(page, user);
          return 'logged-in';
        } catch (error) {
          if (error instanceof Error && error.message.includes('status 429')) {
            return 'rate-limited';
          }
          throw error;
        }
      },
      {
        message: 'waiting out the per-IP BffAuth rate limiter before /bff/login',
        intervals: [RATE_LIMIT_BACKOFF_MS],
        timeout: RATE_LIMIT_MAX_WAIT_MS,
      },
    )
    .toBe('logged-in');
}

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
  });
}
