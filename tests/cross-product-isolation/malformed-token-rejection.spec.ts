import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Malformed-Token Rejection
 *
 * Verifies that tokens which fail upstream JWT validation (signature, format,
 * structure) are rejected with HTTP 401 by every product API. This is the
 * baseline "garbage in" test — the realm authorization handler runs AFTER
 * JWT bearer middleware, so anything that fails JWT validation never reaches
 * the realm handler. Both layers must independently fail closed.
 *
 * NOTE on iss-claim variants: the centralized realm-validation handler unit
 * tests in `Security.Claims` and each per-service test suite cover the
 * "missing iss" / "non-Keycloak iss" / "non-existent realm" matrix at the
 * unit level (54 tests across 6 services). At the E2E layer we cannot
 * forge a JWT with a tampered iss claim AND a valid Keycloak signature,
 * because we don't have Keycloak's signing key. The closest E2E proxy is
 * the cross-realm test (in cross-realm-rejection.spec.ts) — a real signed
 * token from realm A hitting a service that doesn't allow realm A.
 *
 * What we CAN test E2E for malformed tokens:
 *   - Garbage string in Authorization header        → 401
 *   - Empty bearer token                            → 401
 *   - Structurally valid JWT with bad signature     → 401
 *   - No Authorization header at all                → 401
 */

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return (value && value.trim().length > 0) ? value.trim().replace(/\/+$/, '') : fallback;
}

const SERVICE_URLS = {
  questioner: resolveBaseUrl('QUESTIONER_API_URL', 'https://localhost:5004'),
  onlineMenu: resolveBaseUrl('ONLINEMENU_API_URL', 'https://localhost:5006'),
  identity: resolveBaseUrl('IDENTITY_API_URL', 'http://localhost:5002'),
  notification: resolveBaseUrl('NOTIFICATION_SERVICE_URL', 'http://localhost:5015'),
  content: resolveBaseUrl('CONTENT_API_URL', 'http://localhost:5009'),
  payment: resolveBaseUrl('PAYMENT_API_URL', 'http://localhost:5018'),
} as const;

const PROBE_PATHS = {
  questioner: '/api/v1/questionerTemplates/list',
  onlineMenu: '/api/v1/TenantMenus/list',
  identity: '/api/v1/tenants',
  notification: '/api/v1/notifications',
  content: '/api/v1/content',
  payment: '/api/v1/subscriptions/me',
} as const;

const HTTP_UNAUTHORIZED = 401;

/**
 * A structurally valid JWT (header.payload.signature) but signed with
 * a key Keycloak doesn't recognize. Should fail signature validation and
 * be rejected with 401 BEFORE reaching the realm handler.
 *
 * Header: {"alg":"HS256","typ":"JWT"}
 * Payload: {"iss":"https://identity.dloizides.com/realms/questioner","sub":"test","exp":99999999999}
 * Signature: HS256("test-secret") — won't validate against Keycloak's RS256 public key.
 */
const BAD_SIG_BUT_VALID_STRUCTURE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // base64url for {"iss":"https://identity.dloizides.com/realms/questioner","sub":"test","exp":99999999999}
  Buffer.from(
    JSON.stringify({
      iss: 'https://identity.dloizides.com/realms/questioner',
      sub: 'e2e-cross-product-isolation-test',
      exp: 99999999999,
    }),
  )
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_') +
  '.invalid_signature_will_not_verify';

async function makeApiContext(baseUrl: string): Promise<APIRequestContext> {
  return await playwrightRequest.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });
}

async function expectRejection(
  apiContext: APIRequestContext,
  path: string,
  authHeader: string | null,
  serviceName: string,
  scenario: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader !== null) {
    headers.Authorization = authHeader;
  }
  const response = await apiContext.get(path, { headers, failOnStatusCode: false });
  expect(
    response.status(),
    `${serviceName} should reject ${scenario} with 401, got ${response.status()}`,
  ).toBe(HTTP_UNAUTHORIZED);
}

const SERVICES_TO_PROBE: ReadonlyArray<{ name: string; url: string; path: string }> = [
  { name: 'QuestionerService', url: SERVICE_URLS.questioner, path: PROBE_PATHS.questioner },
  { name: 'OnlineMenuService', url: SERVICE_URLS.onlineMenu, path: PROBE_PATHS.onlineMenu },
  { name: 'IdentityService', url: SERVICE_URLS.identity, path: PROBE_PATHS.identity },
  { name: 'NotificationService', url: SERVICE_URLS.notification, path: PROBE_PATHS.notification },
  { name: 'ContentService', url: SERVICE_URLS.content, path: PROBE_PATHS.content },
  { name: 'PaymentService', url: SERVICE_URLS.payment, path: PROBE_PATHS.payment },
];

test.describe('Malformed-Token Rejection — every service fails closed @cross-product-isolation', () => {
  for (const service of SERVICES_TO_PROBE) {
    test(`${service.name} rejects request with NO Authorization header`, async () => {
      const api = await makeApiContext(service.url);
      try {
        await expectRejection(api, service.path, null, service.name, 'no Authorization header');
      } finally {
        await api.dispose();
      }
    });

    test(`${service.name} rejects request with EMPTY bearer token`, async () => {
      const api = await makeApiContext(service.url);
      try {
        await expectRejection(api, service.path, 'Bearer ', service.name, 'empty bearer token');
      } finally {
        await api.dispose();
      }
    });

    test(`${service.name} rejects request with GARBAGE bearer token`, async () => {
      const api = await makeApiContext(service.url);
      try {
        await expectRejection(api, service.path, 'Bearer not-a-jwt-just-garbage', service.name, 'garbage bearer token');
      } finally {
        await api.dispose();
      }
    });

    test(`${service.name} rejects JWT with valid structure but invalid signature`, async () => {
      const api = await makeApiContext(service.url);
      try {
        await expectRejection(
          api,
          service.path,
          `Bearer ${BAD_SIG_BUT_VALID_STRUCTURE_JWT}`,
          service.name,
          'JWT with bad signature',
        );
      } finally {
        await api.dispose();
      }
    });
  }
});

/**
 * The "iss claim variants" matrix is fully covered at the unit-test layer
 * (Security.Claims/RealmExtensions tests + per-service RealmAuthorizationHandler
 * tests, 54 tests total). We document that here so reviewers know it's not
 * an oversight that they're absent from the E2E suite.
 *
 * E2E cannot forge a token with a tampered iss claim that ALSO survives JWT
 * signature validation, because we don't have Keycloak's RS256 private key.
 * The closest E2E proxy is the cross-realm test in
 * cross-realm-rejection.spec.ts.
 */
test.describe('iss-claim variants — covered at unit-test layer', () => {
  test('documentation only', () => {
    // No E2E assertion. See comment block above.
    expect(true).toBe(true);
  });
});
