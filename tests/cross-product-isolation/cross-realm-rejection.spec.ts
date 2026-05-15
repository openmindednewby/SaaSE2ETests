import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getRealmToken, decodeIssuerClaim } from '../../helpers/realm-token-helper.js';

/**
 * Cross-Realm Rejection (the wall holds)
 *
 * Verifies that a token issued by realm A cannot access realm B's product
 * API. Realm policy for the PRODUCT-SPECIFIC services:
 *
 *  - QuestionerService: product endpoints accept `questioner` ONLY
 *  - OnlineMenuService: product endpoints accept `onlinemenu` ONLY
 *
 * The legacy `OnlineMenu` realm WAS in every service's AllowedRealms during
 * the early cutover. As of the product split, QuestionerService's
 * staging+prod product-endpoint realm set is `questioner` only — the legacy
 * `OnlineMenu` realm is being retired (it survives only in
 * `appsettings.Development.json`). The test that asserted legacy
 * cross-realm acceptance is therefore SKIPPED (see below).
 *
 * KI-5 — QuestionerService's product wall is enforced at the JWT-bearer
 * VALIDATION layer. Its `appsettings.json` splits the realm config into
 * `Authentication:ProductRealms` (`["questioner"]` — the default `Bearer`
 * scheme + every product endpoint) and `Authentication:CanaryRealms`
 * (`["questioner","onlinemenu"]` — a dedicated `CanaryBearer` scheme used
 * ONLY by the internal `/internal/canary-*` endpoints). An `onlinemenu`
 * token therefore fails issuer validation on QuestionerService product
 * endpoints (this spec's assertion) while the `onlinemenu`-minted canary
 * superUser token still validates against `CanaryBearer` on the canary
 * cleanup endpoint. See
 * `BaseClient/docs/Tasks/COMPLETED/ki-5-ki-6-cross-realm-orphan-scope.md`.
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
  // SKIPPED — retired legacy behaviour. This test asserted that a token minted
  // from the legacy `OnlineMenu` realm is still ACCEPTED by QuestionerService
  // (backward-compat during the early product-split cutover).
  //
  // That backward-compat window has closed. QuestionerService's base
  // `appsettings.json` — which staging+prod inherit — sets
  // `Authentication:AllowedRealms` to `["questioner"]` only. The legacy
  // `OnlineMenu` realm survives ONLY in `appsettings.Development.json`
  // (`["OnlineMenu", "questioner"]`), so on every non-Development environment
  // a legacy `OnlineMenu` token is now correctly rejected with 401.
  //
  // The product split (see BaseClient/docs/Tasks/IN_PROGRESS/product-split-roadmap.md)
  // is deliberately retiring the legacy `OnlineMenu` realm. A spec asserting
  // legacy cross-realm acceptance is testing behaviour we are removing on
  // purpose — keeping it would be a false regression signal on staging+prod.
  //
  // Not deleted (kept as a documented record of the cutover): if the legacy
  // realm is ever re-added to QuestionerService's staging/prod AllowedRealms
  // this is the spec to un-skip.
  test.skip('legacy OnlineMenu-realm token still works against QuestionerService (backward-compat) — RETIRED: product-split removed OnlineMenu from QuestionerService staging+prod AllowedRealms', async () => {
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
      expect(
        result.status,
        `Expected non-401 from QuestionerService for legacy OnlineMenu token (status=${result.status}).`,
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
