/**
 * The cross-device preferred-login-method E2E test (unified-login D5), split
 * out of `login-methods-suite.ts` to keep that file within the max-file-lines
 * budget. Registered into the suite's `describe` block via
 * {@link definePreferredMethodTest}, so it inherits the suite's skip guards
 * (remote-only + seeded-test-user present).
 *
 * API-level on purpose: it proves the integration the package unit tests can't
 * reach — the BFF YARP proxy path to TenantService (`/bff/api/tenants/api/v1/
 * me/*`), the forwarded Bearer, and the CSRF gate on the state-changing PUT.
 */
import { test, expect } from '@playwright/test';

import { bffPut, loginThroughRateLimit, registerCookieBannerHandler, HTTP_OK } from './bff-auth-api.js';

const SET_PATH = '/bff/api/tenants/api/v1/me/login-method-preference';
const GET_PATH = '/bff/api/tenants/api/v1/me/preferences';

/** Register the preferred-method round-trip test for the given seeded test user. */
export function definePreferredMethodTest(user: { username: string; password: string }): void {
  test('preferred method: set + read-back round-trips through the BFF tenants proxy', async ({
    page,
    baseURL,
  }) => {
    const appUrl = baseURL!;
    await registerCookieBannerHandler(page);

    // ── 1. Authenticate (the proxied /me/* calls need a session) ────────────
    await loginThroughRateLimit(page, user);

    // ── 2. PUT a preferred method through the BFF → TenantService ───────────
    const setResp = await bffPut(page.request, appUrl, SET_PATH, { method: 'passkey' });
    expect(setResp.status(), 'PUT login-method-preference is accepted').toBe(HTTP_OK);

    // ── 3. GET /me/preferences reflects it (server-side cross-device truth) ──
    const getResp = await page.request.get(`${appUrl}${GET_PATH}`);
    expect(getResp.status(), 'GET preferences OK').toBe(HTTP_OK);
    const prefs = (await getResp.json()) as { preferredLoginMethod?: string | null };
    expect(prefs.preferredLoginMethod, 'the stored preference round-trips').toBe('passkey');

    // ── 4. Clearing the preference (null) round-trips too ───────────────────
    const clearResp = await bffPut(page.request, appUrl, SET_PATH, { method: null });
    expect(clearResp.status(), 'clearing the preference is accepted').toBe(HTTP_OK);
    const afterClear = await page.request.get(`${appUrl}${GET_PATH}`);
    const clearedPrefs = (await afterClear.json()) as { preferredLoginMethod?: string | null };
    expect(
      clearedPrefs.preferredLoginMethod ?? null,
      'a cleared preference reads back as null',
    ).toBeNull();
  });
}
