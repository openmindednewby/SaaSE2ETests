/**
 * Poueni passkey E2E (unified-login Increment 3, Batch 5).
 *
 * Proves passkey login end-to-end through the Poueni dashboard's Vite-native
 * passkey UI + bff-poueni (Bff.AspNetCore 1.3.1) + the poueni realm's Keycloak
 * WebAuthn ceremony:
 *
 *   1. Sign in as the seeded poueni test user (plain /bff/login ROPC).
 *   2. CDP virtual authenticator → "Add a passkey" flow via
 *      /bff/passkey/register?returnUrl=/settings (KC password re-auth +
 *      ceremony) → back at /settings.
 *   3. Clear cookies → /login → the "Sign in with a passkey" button (rendered
 *      because /bff/config advertises the method) → usernameless ceremony →
 *      authenticated session ( /bff/me identifies the test user).
 *   4. NEGATIVE: a forged callback is bounced to /login?passkeyError= and mints
 *      no session.
 *
 * Poueni decision (recorded in the Increment-3 task doc): the web dashboard
 * offers Password + Passkey only — device-PIN's Vite UI port is deferred, so
 * there is no PIN leg in this spec. The dashboard's testIDs are poueni-passkey-*
 * (Vite-native components, not the auth-web testIdPrefix pattern).
 *
 * Runs on staging + prod via E2E_TARGET; local is skipped.
 */

import { test, expect, type Cookie } from '@playwright/test';

import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';
import {
  attachVirtualAuthenticator,
  driveKeycloakPages,
  isOnKeycloak,
} from '../../helpers/webauthn-helpers.js';

const SESSION_COOKIE = '__Host-bff-poueni';
const NAV_TIMEOUT_MS = 30_000;
const HTTP_OK = 200;

/** The seeded poueni-realm test user (created by seed-realm-users.ps1). */
const TEST_USER = {
  username: process.env.TEST_USER_USERNAME ?? '',
  password: process.env.TEST_USER_PASSWORD ?? '',
};

/** Poueni dashboard testIDs (Vite-native components). */
const PASSKEY_BUTTON_TEST_ID = 'poueni-passkey-login-button';
const PASSKEY_ERROR_TEST_ID = 'poueni-passkey-login-error';
const PASSKEY_SETTINGS_ADD_TEST_ID = 'poueni-passkey-settings-add';

/** Finds a captured cookie by name, asserting it exists. */
function requireCookie(cookies: Cookie[], name: string): Cookie {
  const cookie = cookies.find((c) => c.name === name);
  expect(cookie, `cookie ${name} present`).toBeDefined();
  return cookie!;
}

test.describe('Poueni passkey login (Vite dashboard + bff-poueni 1.3.1)', () => {
  test.skip(
    !isRemoteTarget(),
    'Poueni passkey E2E targets staging+prod; no local poueni BFF in the dev loop',
  );
  test.skip(
    TEST_USER.username === '' || TEST_USER.password === '',
    'TEST_USER_USERNAME / TEST_USER_PASSWORD not set in the target .env file',
  );

  test('register a passkey from settings, sign in with it, forged callback rejected', async ({
    page,
  }) => {
    const { dashboardUrl } = getPoueniUrls();

    // ── 1. Sign in via the dashboard login form (plain /bff/login ROPC) ────
    await page.goto(`${dashboardUrl}/login`);
    // The login page clears any stale session on mount; let the document load.
    await page.waitForLoadState('domcontentloaded');
    const loginResult = await page.evaluate(
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
    expect(loginResult, 'seeded test user signs in via /bff/login').toBe(HTTP_OK);

    // ── 2. Attach the virtual authenticator + register a passkey ───────────
    await attachVirtualAuthenticator(page);

    // The settings page hosts the "Add a passkey" card; assert it renders
    // (proves the /bff/config gating works in the Vite UI), then register via
    // the same navigation the button performs.
    await page.goto(`${dashboardUrl}/settings`);
    await expect(
      page.getByTestId(PASSKEY_SETTINGS_ADD_TEST_ID),
      'the passkey settings card renders (BFF advertises the method)',
    ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await page.getByTestId(PASSKEY_SETTINGS_ADD_TEST_ID).click();

    await page.waitForURL(() => isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });
    await driveKeycloakPages(page, {
      email: TEST_USER.username,
      password: TEST_USER.password,
    });
    await page.waitForURL(() => !isOnKeycloak(page), { timeout: NAV_TIMEOUT_MS });

    // ── 3. Sign out (cookies only) → passkey login via the /login button ───
    await page.context().clearCookies();
    await page.goto(`${dashboardUrl}/login`);
    await expect(
      page.getByTestId(PASSKEY_BUTTON_TEST_ID),
      'the passkey login button renders for anonymous visitors',
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
    const meResponse = await page.request.get(`${dashboardUrl}/bff/me`);
    expect(meResponse.status(), 'passkey-minted session resolves /bff/me').toBe(HTTP_OK);
    const me = (await meResponse.json()) as { user?: { preferred_username?: string } };
    expect(
      me.user?.preferred_username?.toLowerCase(),
      'the passkey session belongs to the seeded test user',
    ).toBe(TEST_USER.username.toLowerCase());

    // ── 4. NEGATIVE: a forged callback cannot mint a session ───────────────
    await page.context().clearCookies();
    await page.goto(`${dashboardUrl}/bff/passkey/callback?state=forged-state&code=forged-code`);
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
