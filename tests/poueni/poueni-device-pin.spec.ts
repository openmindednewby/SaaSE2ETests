/**
 * Poueni device-PIN E2E (login-method parity #173).
 *
 * Proves the remembered-device PIN-unlock journey end-to-end through the
 * Poueni dashboard's Vite-native device-PIN UI + bff-poueni (Bff.AspNetCore
 * 1.3.2) + the poueni realm:
 *   1. Sign in as the seeded poueni test user (plain /bff/login ROPC).
 *   2. ENROL a device PIN (POST /bff/pin/enroll) — acquires a KC offline token,
 *      stores the Argon2id hash, sets the __Host-bffdev-poueni device cookie.
 *   3. UNLOCK via the Vite unlock gate: a SECOND context carrying ONLY the
 *      device cookie loads /login, sees the PIN gate, enters the PIN, lands on
 *      the dashboard with a fresh session.
 *   4. REPEAT UNLOCK (API) — guards offline-token rotation: on engine 1.3.1 the
 *      device died after one unlock; 1.3.2 persists the rotated token so a second
 *      unlock still succeeds.
 *   5. WRONG PIN → 401; after the failure threshold → device lockout 429.
 *   6. DISABLE revokes the offline token + clears the record; the remembered
 *      device can no longer unlock (generic 401).
 *
 * The PIN is NEVER sent to Keycloak and is never a standalone credential — it
 * unlocks a KC-issued offline token the BFF holds. Vite-native testIDs are
 * poueni-device-pin-*. Runs on staging + prod via E2E_TARGET; local is skipped.
 */

import { test, expect } from '@playwright/test';

import {
  bffPostThroughRateLimit,
  bffPostThroughTransientErrors,
  requireCookie,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  HTTP_TOO_MANY_REQUESTS,
} from '../../helpers/bff-auth-api.js';
import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';

const SESSION_COOKIE = '__Host-bff-poueni';
const DEVICE_COOKIE = '__Host-bffdev-poueni';
const NAV_TIMEOUT_MS = 30_000;

/** The seeded poueni-realm test user (created by seed-realm-users.ps1). */
const TEST_USER = {
  username: process.env.TEST_USER_USERNAME ?? '',
  password: process.env.TEST_USER_PASSWORD ?? '',
};

const CANARY_PIN = '135790';
const CANARY_PIN_DIGITS = 6;
const WRONG_PIN = '999999';
/** Engine default MaxFailures is 5 → the 6th wrong attempt is device-locked. */
const MAX_LOCKOUT_ITERATIONS = 12;

const UNLOCK_GATE_TEST_ID = 'poueni-device-pin-unlock';
const UNLOCK_INPUT_TEST_ID = 'poueni-device-pin-unlock-input';
const UNLOCK_SUBMIT_TEST_ID = 'poueni-device-pin-unlock-submit';

test.describe('Poueni device-PIN (Vite dashboard + bff-poueni 1.3.2)', () => {
  test.skip(
    !isRemoteTarget(),
    'Poueni device-PIN E2E targets staging+prod; no local poueni BFF in the dev loop',
  );
  test.skip(
    TEST_USER.username === '' || TEST_USER.password === '',
    'TEST_USER_USERNAME / TEST_USER_PASSWORD not set in the target .env file',
  );

  test('enrol, unlock on a remembered device, repeat-unlock, lockout, disable', async ({
    browser,
    page,
  }) => {
    const { dashboardUrl } = getPoueniUrls();

    // ── 1. Sign in as the seeded test user ─────────────────────────────────
    // Absolute goto + same-origin fetch (NOT the relative-nav login helper,
    // which would resolve against the default baseURL — the wrong host here).
    await page.goto(`${dashboardUrl}/login`);
    await page.waitForLoadState('networkidle');
    const loginStatus = await page.evaluate(
      async (creds: { username: string; password: string }) => {
        const res = await fetch('/bff/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
          body: JSON.stringify(creds),
        });
        return res.status;
      },
      { username: TEST_USER.username, password: TEST_USER.password },
    );
    expect(loginStatus, 'seeded test user signs in via /bff/login').toBe(HTTP_OK);

    // ── 2. ENROL a device PIN (retries the intermittent staging KC 502) ─────
    const enrollResp = await bffPostThroughTransientErrors(page.request, dashboardUrl, '/bff/pin/enroll', {
      pin: CANARY_PIN,
      digits: CANARY_PIN_DIGITS,
    });
    expect(
      enrollResp.status(),
      'enroll OK — a persistent 502 means bff-poueni-client lacks the offline_access scope on the poueni realm',
    ).toBe(HTTP_OK);

    const ownerCookies = await page.context().cookies();
    const deviceCookie = requireCookie(ownerCookies, DEVICE_COOKIE);
    requireCookie(ownerCookies, SESSION_COOKIE);

    // ── 3. UNLOCK via the Vite gate on a remembered, logged-out device ──────
    const returningContext = await browser.newContext();
    await returningContext.addCookies([deviceCookie]);
    const returningPage = await returningContext.newPage();

    await returningPage.goto(`${dashboardUrl}/login`);
    await expect(
      returningPage.getByTestId(UNLOCK_GATE_TEST_ID),
      'the device-PIN unlock gate renders for a remembered device',
    ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await returningPage.getByTestId(UNLOCK_INPUT_TEST_ID).fill(CANARY_PIN);
    await returningPage.getByTestId(UNLOCK_SUBMIT_TEST_ID).click();
    await returningPage.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: NAV_TIMEOUT_MS,
    });
    const afterUnlock = await returningContext.cookies();
    requireCookie(afterUnlock, SESSION_COOKIE);
    await returningContext.close();

    // ── 4. REPEAT UNLOCK (API) — rotation guard (passes on 1.3.2, fails on 1.3.1) ──
    const repeatContext = await browser.newContext();
    await repeatContext.addCookies([deviceCookie]);
    const repeatUnlock = await bffPostThroughRateLimit(repeatContext.request, dashboardUrl, '/bff/pin/unlock', {
      pin: CANARY_PIN,
    });
    expect(
      repeatUnlock.status(),
      'device unlocks REPEATEDLY (engine persists the rotated offline token)',
    ).toBe(HTTP_OK);
    await repeatContext.close();

    // ── 5. WRONG PIN + LOCKOUT (API, device-cookie-only context) ───────────
    const lockoutContext = await browser.newContext();
    await lockoutContext.addCookies([deviceCookie]);
    const firstWrong = await bffPostThroughRateLimit(lockoutContext.request, dashboardUrl, '/bff/pin/unlock', {
      pin: WRONG_PIN,
    });
    expect(firstWrong.status(), 'first wrong PIN is a generic 401').toBe(HTTP_UNAUTHORIZED);

    let lockedStatus = firstWrong.status();
    let retryAfter: string | null = null;
    for (let attempt = 2; attempt <= MAX_LOCKOUT_ITERATIONS; attempt++) {
      const resp = await bffPostThroughRateLimit(lockoutContext.request, dashboardUrl, '/bff/pin/unlock', {
        pin: WRONG_PIN,
      });
      lockedStatus = resp.status();
      if (lockedStatus === HTTP_TOO_MANY_REQUESTS) {
        retryAfter = resp.headers()['retry-after'] ?? null;
        break;
      }
      expect(lockedStatus, `wrong-PIN attempt ${attempt} before lockout`).toBe(HTTP_UNAUTHORIZED);
    }
    expect(lockedStatus, 'device locks out after the failure threshold').toBe(HTTP_TOO_MANY_REQUESTS);
    expect(retryAfter, 'device-lockout 429 carries a Retry-After header').not.toBeNull();
    await lockoutContext.close();

    // ── 6. DISABLE revokes the record; a stale device cookie can't unlock ───
    const disableResp = await bffPostThroughRateLimit(page.request, dashboardUrl, '/bff/pin/disable');
    expect(disableResp.status(), 'disable OK').toBe(HTTP_OK);

    const staleContext = await browser.newContext();
    await staleContext.addCookies([deviceCookie]);
    const afterDisable = await bffPostThroughRateLimit(staleContext.request, dashboardUrl, '/bff/pin/unlock', {
      pin: CANARY_PIN,
    });
    expect(
      afterDisable.status(),
      'a disabled device cannot unlock (record deleted → generic 401)',
    ).toBe(HTTP_UNAUTHORIZED);
    await staleContext.close();
  });
});
