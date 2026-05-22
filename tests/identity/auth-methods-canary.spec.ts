/**
 * Auth-methods canary coverage — `GET /api/v1/auth/methods`.
 *
 * Purpose
 * -------
 * Phase 1 of the Identity-Service shrink merged the auth-methods handler from
 * the deleted `Auth/GetAuthMethods.cs` proxy into `TenantService`'s
 * `Tenants/GetTenantAuthConfig.cs` (the `GetAuthMethods` endpoint), on the
 * frozen `/auth/methods` route. Every frontend hits this endpoint at
 * login-form render time to decide which auth methods to show.
 *
 * The `playwright-e2e-staging-canary` suite previously ran ONLY the
 * `cross-product-isolation` project, so it never exercised `/auth/methods` —
 * a route that, if it 404'd or changed shape after the shrink, would break
 * every login page silently. This spec closes that blind spot.
 *
 * Scope / safety
 * --------------
 *   - Pure read. No tenant / user / data created → nothing for the canary
 *     teardown to sweep. Canary-safe by construction.
 *   - `AllowAnonymous` on the endpoint — no token needed.
 *   - Hits the `IDENTITY_API_URL` base (the canary Job maps this to the
 *     in-cluster `tenant-api` Service); falls back to the local TenantService
 *     port for the dev-PC path.
 *   - The no-params response is a frozen contract (see `GetAuthMethodsResponse`
 *     in TenantService): `PrimaryMethod = UsernamePassword`,
 *     `AllowedMethods = [UsernamePassword]`, `OtpCodeLength = 6`,
 *     `OtpExpiryMinutes = 5`, `RequireSmsVerification = true`.
 *
 * Enum shape note
 * ---------------
 * FastEndpoints serializes the `AuthMethod` enum; depending on the JSON enum
 * converter config it surfaces as either the integer `0` or the string
 * `"UsernamePassword"`. The assertions accept BOTH so the spec pins the
 * contract without coupling to the serializer setting.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const DEFAULT_OTP_CODE_LENGTH = 6;
const DEFAULT_OTP_EXPIRY_MINUTES = 5;

/** `UsernamePassword` is `AuthMethod` ordinal 0 — the no-tenant default. */
const USERNAME_PASSWORD_VALUES: ReadonlyArray<string | number> = [0, 'UsernamePassword'];

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return value && value.trim().length > 0
    ? value.trim().replace(/\/+$/, '')
    : fallback;
}

/** TenantService base — canary Job maps `IDENTITY_API_URL` to `tenant-api`. */
const TENANT_API_URL = resolveBaseUrl('IDENTITY_API_URL', 'http://localhost:5002');
const AUTH_METHODS_PATH = '/api/v1/auth/methods';

async function makeApiContext(): Promise<APIRequestContext> {
  return await playwrightRequest.newContext({
    baseURL: TENANT_API_URL,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });
}

/** True if the serialized enum value matches one of the accepted forms. */
function isUsernamePassword(value: unknown): boolean {
  return USERNAME_PASSWORD_VALUES.includes(value as string | number);
}

test.describe('Auth-methods endpoint — /auth/methods @identity @auth @canary', () => {
  test('no params: returns 200 with the frozen UsernamePassword default contract', async () => {
    const api = await makeApiContext();
    try {
      const response = await api.get(AUTH_METHODS_PATH, { failOnStatusCode: false });
      expect(
        response.status(),
        `GET ${AUTH_METHODS_PATH} must return 200 (the route survived the Identity shrink)`,
      ).toBe(HTTP_OK);

      const body = (await response.json()) as {
        primaryMethod: unknown;
        allowedMethods: unknown;
        otpCodeLength: unknown;
        otpExpiryMinutes: unknown;
        requireSmsVerification: unknown;
      };

      expect(
        isUsernamePassword(body.primaryMethod),
        `primaryMethod must be UsernamePassword, got ${JSON.stringify(body.primaryMethod)}`,
      ).toBe(true);

      expect(Array.isArray(body.allowedMethods), 'allowedMethods must be an array').toBe(true);
      const allowed = body.allowedMethods as unknown[];
      expect(allowed, 'no-params allowedMethods must contain exactly one method').toHaveLength(1);
      expect(
        isUsernamePassword(allowed[0]),
        `allowedMethods[0] must be UsernamePassword, got ${JSON.stringify(allowed[0])}`,
      ).toBe(true);

      expect(body.otpCodeLength, 'default otpCodeLength').toBe(DEFAULT_OTP_CODE_LENGTH);
      expect(body.otpExpiryMinutes, 'default otpExpiryMinutes').toBe(DEFAULT_OTP_EXPIRY_MINUTES);
      expect(body.requireSmsVerification, 'default requireSmsVerification').toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('unknown tenantSlug: returns 404 (the lookup path runs and fails closed)', async () => {
    // A nonexistent slug forces the endpoint down the DB-lookup branch — proving
    // the tenant lookup is wired post-shrink, not just the no-params shortcut.
    const api = await makeApiContext();
    try {
      const response = await api.get(
        `${AUTH_METHODS_PATH}?tenantSlug=e2e-canary-nonexistent-slug`,
        { failOnStatusCode: false },
      );
      expect(
        response.status(),
        `GET ${AUTH_METHODS_PATH} with an unknown tenantSlug must return 404`,
      ).toBe(HTTP_NOT_FOUND);
    } finally {
      await api.dispose();
    }
  });
});
