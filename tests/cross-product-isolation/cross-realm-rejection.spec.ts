import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getRealmToken, decodeIssuerClaim } from '../../helpers/realm-token-helper.js';

/**
 * Cross-Realm Rejection (the wall holds)
 *
 * Verifies that a token issued by realm A cannot access realm B's product
 * API. Realm policy:
 *
 *  - QuestionerService: accepts `questioner` ONLY
 *  - OnlineMenuService: accepts `onlinemenu` ONLY
 *
 * The legacy `OnlineMenu` realm is currently still in every service's
 * AllowedRealms (backward-compat during cutover); this is documented and
 * tested as a known-passing case so we notice when the cutover lands.
 *
 * EVERY rejection MUST be HTTP 401, never 403. 403 would leak "you have a
 * valid token from some realm but the wrong one" — by returning 401 the wall
 * makes a wrong-realm token indistinguishable from a missing token.
 *
 * Multi-realm-service acceptance tests (Identity, Notification, Content,
 * Payment) live in cross-realm-acceptance.spec.ts to keep file size sane.
 */

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return (value && value.trim().length > 0) ? value.trim().replace(/\/+$/, '') : fallback;
}

const SERVICE_URLS = {
  questioner: resolveBaseUrl('QUESTIONER_API_URL', 'https://localhost:5004'),
  onlineMenu: resolveBaseUrl('ONLINEMENU_API_URL', 'https://localhost:5006'),
} as const;

const PROBE_PATHS = {
  questioner: '/api/v1/questionerTemplates/list',
  onlineMenu: '/api/v1/TenantMenus/list',
} as const;

const HTTP_UNAUTHORIZED = 401;

interface ProbeResult {
  status: number;
  bodyText: string;
}

async function probe(
  apiContext: APIRequestContext,
  path: string,
  token: string,
): Promise<ProbeResult> {
  const response = await apiContext.get(path, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  return {
    status: response.status(),
    bodyText: await response.text().catch(() => ''),
  };
}

async function makeApiContext(baseUrl: string): Promise<APIRequestContext> {
  return await playwrightRequest.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });
}

test.describe('Cross-Realm Rejection — the wall holds @cross-product-isolation @critical', () => {
  test('legacy OnlineMenu-realm token still works against QuestionerService (backward-compat)', async () => {
    const token = await getRealmToken('OnlineMenu');
    if (!token.accessToken) {
      test.skip(true, `Legacy OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const issuer = decodeIssuerClaim(token.accessToken);
    expect(issuer, 'Legacy token should carry an iss claim').toBeTruthy();
    expect(issuer, 'Legacy token must come from the OnlineMenu realm').toMatch(/\/realms\/OnlineMenu(\/|$)/);

    const api = await makeApiContext(SERVICE_URLS.questioner);
    try {
      const result = await probe(api, PROBE_PATHS.questioner, token.accessToken);
      // While the OnlineMenu realm is still in QuestionerService AllowedRealms
      // (dev/staging during cutover), the token MUST be accepted. The
      // exact status may be 200 or 404 but not 401.
      // After the cutover this expectation flips to 401.
      expect(
        result.status,
        `Expected non-401 from QuestionerService for legacy OnlineMenu token (status=${result.status}). After Phase-2 cutover this will become 401.`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is REJECTED by OnlineMenuService (the wall)', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const issuer = decodeIssuerClaim(token.accessToken);
    expect(issuer, 'Token must come from the questioner realm').toMatch(/\/realms\/questioner(\/|$)/);

    const api = await makeApiContext(SERVICE_URLS.onlineMenu);
    try {
      const result = await probe(api, PROBE_PATHS.onlineMenu, token.accessToken);
      expect(
        result.status,
        `OnlineMenuService MUST reject questioner-realm token with 401, got ${result.status}`,
      ).toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is REJECTED by QuestionerService (the wall)', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const issuer = decodeIssuerClaim(token.accessToken);
    expect(issuer, 'Token must come from the onlinemenu realm').toMatch(/\/realms\/onlinemenu(\/|$)/);

    const api = await makeApiContext(SERVICE_URLS.questioner);
    try {
      const result = await probe(api, PROBE_PATHS.questioner, token.accessToken);
      expect(
        result.status,
        `QuestionerService MUST reject onlinemenu-realm token with 401, got ${result.status}`,
      ).toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by QuestionerService (sanity)', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.questioner);
    try {
      const result = await probe(api, PROBE_PATHS.questioner, token.accessToken);
      // Accept any non-401 status. 403 (missing role) is fine — the wall let
      // them in.
      expect(
        result.status,
        `QuestionerService should accept its own realm token (got 401 — wall is rejecting valid tokens)`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by OnlineMenuService (sanity)', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.onlineMenu);
    try {
      const result = await probe(api, PROBE_PATHS.onlineMenu, token.accessToken);
      expect(
        result.status,
        `OnlineMenuService should accept its own realm token (got 401 — wall is rejecting valid tokens)`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });
});
