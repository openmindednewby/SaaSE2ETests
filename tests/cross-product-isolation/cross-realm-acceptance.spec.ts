import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getRealmToken } from '../../helpers/realm-token-helper.js';

/**
 * Cross-Realm Acceptance — multi-realm services must accept BOTH new realms.
 *
 * IdentityService, NotificationService, ContentService (Option-B partitioned),
 * and PaymentService all sit on BOTH sides of the product split. Their
 * AllowedRealms list contains both `questioner` and `onlinemenu`. They
 * MUST accept tokens from either realm.
 *
 * If any of these incorrectly walls off a realm, the wrong-realm rejection
 * surfaces as a JWT/realm 401 here — which would be a regression in the
 * realm-validation configuration of that service.
 *
 * KI-5 finding 2 — IMPORTANT distinction: a JWT/realm rejection is NOT the
 * only thing that produces a 401. An endpoint can also issue its OWN 401 from
 * inside its handler (e.g. NotificationService's `/api/v1/notifications` calls
 * `Send.UnauthorizedAsync()` when the token carries no tenant-user context —
 * the canary/dry-run superUser token is an admin token with no `tenantId`/user
 * mapping, so it legitimately gets a 401 there). That endpoint-level 401 is
 * CORRECT behaviour, not a realm-validation regression. The dry run that
 * surfaced KI-5 was hitting a tenant-scoped endpoint with an admin token.
 *
 * To test ONLY realm validation and not conflate it with tenant-scope
 * enforcement, this spec distinguishes the two:
 *   - A JWT-layer rejection (bad signature / wrong issuer / disallowed realm)
 *     ALWAYS carries a `WWW-Authenticate: Bearer ...` response header — it is
 *     emitted by the JwtBearer middleware before the endpoint handler runs.
 *   - An endpoint's own `Send.UnauthorizedAsync()` does NOT set that header.
 * So "realm accepted" == "either non-401, OR a 401 with no `WWW-Authenticate`
 * header (the token passed JWT+realm validation; the handler rejected it for
 * an unrelated, tenant-scope reason)".
 *
 * Companion file to cross-realm-rejection.spec.ts (the actual wall).
 */

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return (value && value.trim().length > 0) ? value.trim().replace(/\/+$/, '') : fallback;
}

const SERVICE_URLS = {
  identity: resolveBaseUrl('IDENTITY_API_URL', 'http://localhost:5002'),
  notification: resolveBaseUrl('NOTIFICATION_SERVICE_URL', 'http://localhost:5015'),
  content: resolveBaseUrl('CONTENT_API_URL', 'http://localhost:5009'),
  payment: resolveBaseUrl('PAYMENT_API_URL', 'http://localhost:5018'),
} as const;

const PROBE_PATHS = {
  identity: '/api/v1/tenants',
  notification: '/api/v1/notifications',
  content: '/api/v1/content',
  payment: '/api/v1/subscriptions/me',
} as const;

const HTTP_UNAUTHORIZED = 401;

interface RealmProbeResult {
  status: number;
  /** The `WWW-Authenticate` response header, if any. Present == JWT-layer rejection. */
  wwwAuthenticate: string | null;
}

async function probeRealm(
  apiContext: APIRequestContext,
  path: string,
  token: string,
): Promise<RealmProbeResult> {
  const response = await apiContext.get(path, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const headers = response.headers();
  return {
    status: response.status(),
    wwwAuthenticate: headers['www-authenticate'] ?? null,
  };
}

/**
 * Asserts a service ACCEPTED the token at the JWT + realm-validation layer.
 *
 * "Accepted" means the token passed JWT signature/issuer/realm validation —
 * NOT that the endpoint returned 2xx. A 401 is only a realm-validation FAILURE
 * when it carries a `WWW-Authenticate` header (the JwtBearer middleware's
 * challenge). A 401 WITHOUT that header is the endpoint's own in-handler
 * rejection (e.g. missing tenant-user scope) — the token was accepted by the
 * realm layer; the handler rejected it for an orthogonal reason. See the
 * KI-5 finding-2 note in the file header.
 */
function expectRealmAccepted(result: RealmProbeResult, serviceLabel: string): void {
  const isJwtLayerRejection =
    result.status === HTTP_UNAUTHORIZED && result.wwwAuthenticate !== null;
  expect(
    isJwtLayerRejection,
    `${serviceLabel} rejected the token at the JWT/realm-validation layer ` +
      `(status=${result.status}, WWW-Authenticate=${JSON.stringify(result.wwwAuthenticate)}). ` +
      `A multi-realm service must ACCEPT both questioner and onlinemenu realm tokens. ` +
      `Note: a 401 WITHOUT a WWW-Authenticate header would be an endpoint-level ` +
      `rejection (e.g. tenant-scope), which this assertion correctly treats as "accepted".`,
  ).toBe(false);
}

async function makeApiContext(baseUrl: string): Promise<APIRequestContext> {
  return await playwrightRequest.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });
}

test.describe('Multi-Realm Acceptance — both new realms accepted by shared services @cross-product-isolation', () => {
  test('questioner-realm token is ACCEPTED by IdentityService', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.identity);
    try {
      const result = await probeRealm(api, PROBE_PATHS.identity, token.accessToken);
      expectRealmAccepted(result, 'IdentityService (multi-realm service, questioner-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by IdentityService', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.identity);
    try {
      const result = await probeRealm(api, PROBE_PATHS.identity, token.accessToken);
      expectRealmAccepted(result, 'IdentityService (multi-realm service, onlinemenu-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by NotificationService', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.notification);
    try {
      // /api/v1/notifications is tenant-user-scoped — an admin/superUser token
      // gets the endpoint's own 401 (no WWW-Authenticate). expectRealmAccepted
      // correctly treats that as "realm accepted" (KI-5 finding 2).
      const result = await probeRealm(api, PROBE_PATHS.notification, token.accessToken);
      expectRealmAccepted(result, 'NotificationService (questioner-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by NotificationService', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.notification);
    try {
      // See the questioner-realm variant above — tenant-scoped endpoint, an
      // admin token's in-handler 401 is "realm accepted" (KI-5 finding 2).
      const result = await probeRealm(api, PROBE_PATHS.notification, token.accessToken);
      expectRealmAccepted(result, 'NotificationService (onlinemenu-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by ContentService (Option-B partitioned)', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.content);
    try {
      const result = await probeRealm(api, PROBE_PATHS.content, token.accessToken);
      expectRealmAccepted(result, 'ContentService (Option-B shared service, questioner-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by ContentService (Option-B partitioned)', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.content);
    try {
      const result = await probeRealm(api, PROBE_PATHS.content, token.accessToken);
      expectRealmAccepted(result, 'ContentService (Option-B shared service, onlinemenu-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by PaymentService', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.payment);
    try {
      const result = await probeRealm(api, PROBE_PATHS.payment, token.accessToken);
      expectRealmAccepted(result, 'PaymentService (questioner-realm token)');
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by PaymentService', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.payment);
    try {
      const result = await probeRealm(api, PROBE_PATHS.payment, token.accessToken);
      expectRealmAccepted(result, 'PaymentService (onlinemenu-realm token)');
    } finally {
      await api.dispose();
    }
  });
});
