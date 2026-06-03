/**
 * The cross-device preferred-login-method E2E test (unified-login D5), split
 * out of `login-methods-suite.ts` to keep that file within the max-file-lines
 * budget. Registered into the suite's `describe` block via
 * {@link definePreferredMethodTest}, so it inherits the suite's remote-only skip.
 *
 * API-level on purpose: it proves the integration the package unit tests can't
 * reach — the BFF YARP proxy path to TenantService (`/bff/api/tenants/api/v1/
 * me/*`), the forwarded Bearer, and the CSRF gate on the state-changing PUT.
 *
 * It logs in as a TENANT-SCOPED user (not the platform `superUser`): the
 * preferred-method preference is stored in the tenant-scoped `UserPreference`
 * row, so the write endpoint requires a `tenantId` claim. The superUser has
 * none (GET works, PUT 401s) — every real product user belongs to a tenant, so
 * the tenant admin is the faithful actor here. This is why the suite's projects
 * pull in `multi-tenant-setup` (which seeds these users in both realms).
 */
import { test, expect } from '@playwright/test';

import { bffPut, loginThroughRateLimit, registerCookieBannerHandler, HTTP_OK } from './bff-auth-api.js';
import { TEST_USERS } from '../fixtures/test-data.js';

const SET_PATH = '/bff/api/tenants/api/v1/me/login-method-preference';
const GET_PATH = '/bff/api/tenants/api/v1/me/preferences';

/** Register the preferred-method round-trip test. */
export function definePreferredMethodTest(): void {
  test('preferred method: set + read-back round-trips through the BFF tenants proxy', async ({
    page,
    baseURL,
  }) => {
    const appUrl = baseURL!;
    await registerCookieBannerHandler(page);

    // ── 1. Authenticate as a TENANT-scoped user (the write needs a tenantId) ─
    await loginThroughRateLimit(page, TEST_USERS.TENANT_A_ADMIN);

    // ── 2. PUT a preferred method through the BFF → TenantService ───────────
    // A successful write is any 2xx — the endpoint answers 204 (no body); the
    // auth-web client treats every 2xx as success.
    const setResp = await bffPut(page.request, appUrl, SET_PATH, { method: 'passkey' });
    expect(setResp.ok(), `PUT login-method-preference accepted (got ${setResp.status()})`).toBe(true);

    // ── 3. GET /me/preferences reflects it (server-side cross-device truth) ──
    const getResp = await page.request.get(`${appUrl}${GET_PATH}`);
    expect(getResp.status(), 'GET preferences OK').toBe(HTTP_OK);
    const prefs = (await getResp.json()) as { preferredLoginMethod?: string | null };
    expect(prefs.preferredLoginMethod, 'the stored preference round-trips').toBe('passkey');

    // ── 4. Clearing the preference (null) round-trips too ───────────────────
    const clearResp = await bffPut(page.request, appUrl, SET_PATH, { method: null });
    expect(clearResp.ok(), `clearing the preference accepted (got ${clearResp.status()})`).toBe(true);
    const afterClear = await page.request.get(`${appUrl}${GET_PATH}`);
    const clearedPrefs = (await afterClear.json()) as { preferredLoginMethod?: string | null };
    expect(
      clearedPrefs.preferredLoginMethod ?? null,
      'a cleared preference reads back as null',
    ).toBeNull();
  });
}
