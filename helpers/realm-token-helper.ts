/**
 * Realm Token Helper — acquires Keycloak access tokens scoped to specific realms
 * for cross-product isolation tests.
 *
 * Three sources of tokens:
 *
 *  1. Legacy `OnlineMenu` realm — fetched via the existing IdentityService
 *     `/api/v1/auth/login` endpoint (proven path used by all other E2E tests).
 *  2. New `questioner` realm — fetched directly via the realm's OIDC token
 *     endpoint (Resource Owner Password Credentials grant). Requires an OAuth
 *     client in that realm with Direct Access Grants enabled.
 *  3. New `onlinemenu` realm — same as #2 but on the `onlinemenu` realm.
 *
 * If a new realm does not yet have an OAuth client capable of issuing tokens
 * (Phase 2 / Step 3 — OAuth client migration is in flight), the helper returns
 * `null` and dependent tests skip with a clear "PHASE_2_STEP_3_PENDING" reason.
 *
 * Cached per worker via `_cache` so test fixtures don't repeatedly hit Keycloak.
 *
 * Token lifetime is short (default 5min on Keycloak); for E2E suite runtimes
 * we don't bother refreshing — if a suite runs longer than the access-token
 * lifetime, the cache is just regenerated on the next worker.
 */
import { AuthHelper } from './auth-helper.js';
import { getCanarySuperUserToken } from './canary-prefix.js';

export type RealmName = 'OnlineMenu' | 'questioner' | 'onlinemenu';

export interface RealmTokenAcquisitionResult {
  realm: RealmName;
  accessToken: string | null;
  /** Reason the token could not be acquired, when accessToken is null. */
  unavailableReason: string | null;
  /** Source path used: 'identity-api' (legacy realm) or 'oidc-direct' (new realms). */
  source: 'identity-api' | 'oidc-direct' | null;
}

interface OidcTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Resolves the Keycloak base URL (scheme + host, no trailing `/realms/...`).
 *
 * Resolution order:
 *  1. `KEYCLOAK_URL` — explicit override, used verbatim if set.
 *  2. `KEYCLOAK_ISSUER` — derived by stripping the `/realms/<realm>` suffix.
 *     This is the primary source: every `.env.<target>` file already sets
 *     `KEYCLOAK_ISSUER` (e.g. `https://staging.identity.dloizides.com/realms/OnlineMenu`),
 *     so the KC base falls out for free and there's no separate var to forget.
 *
 * If NEITHER is resolvable we THROW. Silently falling back to a hardcoded
 * prod URL (the previous behaviour) is the actual bug — when run with
 * `E2E_TARGET=staging` and no `KEYCLOAK_URL`, the helper would mint tokens
 * against PROD Keycloak. A missing config must fail loud, not leak to prod.
 *
 * Exported for unit assertions.
 */
export function resolveKeycloakBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.KEYCLOAK_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const issuer = env.KEYCLOAK_ISSUER?.trim();
  if (issuer) {
    // Strip a trailing `/realms/<realm>` (and anything after it) to get the
    // Keycloak base. `https://host/realms/OnlineMenu` -> `https://host`.
    const match = /^(.*?)\/realms\/[^/]+/.exec(issuer);
    if (match && match[1]) {
      return match[1].replace(/\/+$/, '');
    }
    throw new Error(
      `[realm-token-helper] KEYCLOAK_ISSUER="${issuer}" does not contain a ` +
        `'/realms/<realm>' segment — cannot derive the Keycloak base URL. ` +
        `Set KEYCLOAK_URL explicitly or fix KEYCLOAK_ISSUER.`,
    );
  }

  throw new Error(
    '[realm-token-helper] Cannot resolve the Keycloak base URL: neither ' +
      'KEYCLOAK_URL nor KEYCLOAK_ISSUER is set. Refusing to fall back to a ' +
      'hardcoded prod URL — that would mint tokens against PROD Keycloak. ' +
      'Set KEYCLOAK_ISSUER in the active .env.<target> file.',
  );
}

const IDENTITY_API_URL = process.env.IDENTITY_API_URL || 'http://localhost:5002';
const NEW_REALM_CLIENT_ID =
  process.env.CROSS_PRODUCT_REALM_CLIENT_ID || 'online-menu-client';
const TEST_USER_USERNAME = process.env.TEST_USER_USERNAME || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';
// New-realm test users are seeded into the new realms by Phase 2 / Step 3.
// Until then, fall back to the same superUser credentials and let the OIDC
// endpoint refuse — giving a clean unavailable reason in the suite.
const NEW_REALM_TEST_USERNAME =
  process.env.CROSS_PRODUCT_NEW_REALM_USERNAME || TEST_USER_USERNAME;
const NEW_REALM_TEST_PASSWORD =
  process.env.CROSS_PRODUCT_NEW_REALM_PASSWORD || TEST_USER_PASSWORD;

const _cache: Partial<Record<RealmName, RealmTokenAcquisitionResult>> = {};

const FETCH_TIMEOUT_MS = 10_000;

async function postFormUrlEncoded(
  url: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: OidcTokenResponse | string } | { status: -1; body: string }> {
  const body = new URLSearchParams(fields).toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    const rawText = await response.text();
    let parsed: OidcTokenResponse | string;
    try {
      parsed = JSON.parse(rawText) as OidcTokenResponse;
    } catch {
      parsed = rawText;
    }
    return { status: response.status, body: parsed };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: -1, body: `Network error: ${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches a token for the legacy `OnlineMenu` realm via the IdentityService
 * `/api/v1/auth/login` endpoint. This is the path that all existing E2E
 * tests use, so if it fails the whole suite is broken anyway.
 */
async function acquireOnlineMenuLegacyToken(): Promise<RealmTokenAcquisitionResult> {
  // KI-2 fix: in canary mode, `global-setup.canary.ts` has already minted a
  // superUser JWT against this exact realm with the exact same credentials
  // (`TEST_USER_*`). Reuse it instead of doing another `/auth/login` — every
  // avoided login is one less hit against identity-api's `/auth/*` rate
  // limiter (~5 req/window, no `Retry-After`). The token's `iss` is the
  // OnlineMenu/onlinemenu realm, which is exactly what this function returns.
  const canaryToken = getCanarySuperUserToken();
  if (canaryToken) {
    return {
      realm: 'OnlineMenu',
      accessToken: canaryToken,
      unavailableReason: null,
      source: 'identity-api',
    };
  }

  if (!TEST_USER_USERNAME || !TEST_USER_PASSWORD) {
    return {
      realm: 'OnlineMenu',
      accessToken: null,
      unavailableReason: 'TEST_USER_USERNAME / TEST_USER_PASSWORD not set in .env.local',
      source: null,
    };
  }
  try {
    const auth = new AuthHelper(IDENTITY_API_URL);
    const tokens = await auth.loginViaAPI(TEST_USER_USERNAME, TEST_USER_PASSWORD);
    if (!tokens.accessToken) {
      return {
        realm: 'OnlineMenu',
        accessToken: null,
        unavailableReason: 'IdentityService login returned no accessToken',
        source: 'identity-api',
      };
    }
    return {
      realm: 'OnlineMenu',
      accessToken: tokens.accessToken,
      unavailableReason: null,
      source: 'identity-api',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      realm: 'OnlineMenu',
      accessToken: null,
      unavailableReason: `IdentityService login failed: ${message}`,
      source: 'identity-api',
    };
  }
}

/**
 * Attempts to fetch a token for one of the new realms (`questioner` or
 * `onlinemenu`) via Resource Owner Password Credentials against the realm's
 * OIDC token endpoint.
 *
 * Returns a result with `accessToken: null` and a clear `unavailableReason`
 * when the realm doesn't yet have an OAuth client with Direct Access Grants
 * enabled (Phase 2 / Step 3 dependency).
 */
async function acquireNewRealmToken(realm: 'questioner' | 'onlinemenu'): Promise<RealmTokenAcquisitionResult> {
  if (!NEW_REALM_TEST_USERNAME || !NEW_REALM_TEST_PASSWORD) {
    return {
      realm,
      accessToken: null,
      unavailableReason: 'No new-realm test user credentials configured',
      source: 'oidc-direct',
    };
  }

  let keycloakBaseUrl: string;
  try {
    keycloakBaseUrl = resolveKeycloakBaseUrl();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      realm,
      accessToken: null,
      unavailableReason: message,
      source: 'oidc-direct',
    };
  }

  const tokenUrl = `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/token`;

  const result = await postFormUrlEncoded(tokenUrl, {
    grant_type: 'password',
    client_id: NEW_REALM_CLIENT_ID,
    username: NEW_REALM_TEST_USERNAME,
    password: NEW_REALM_TEST_PASSWORD,
    scope: 'openid',
  });

  if (result.status === -1) {
    return {
      realm,
      accessToken: null,
      unavailableReason: `Keycloak unreachable at ${tokenUrl}: ${result.body}`,
      source: 'oidc-direct',
    };
  }

  if (result.status === 200 && typeof result.body === 'object' && result.body.access_token) {
    return {
      realm,
      accessToken: result.body.access_token,
      unavailableReason: null,
      source: 'oidc-direct',
    };
  }

  // Common 400/401 cases when the realm has no OAuth client with DAG yet,
  // when the user doesn't exist in the realm, or when DAG is disabled on
  // the client. We surface the Keycloak error for diagnosis.
  let reason = `Status ${result.status}`;
  if (typeof result.body === 'object') {
    const err = result.body.error ?? '(unknown)';
    const desc = result.body.error_description ?? '';
    reason = `${result.status} ${err}${desc ? ': ' + desc : ''}`;
  } else if (typeof result.body === 'string') {
    reason = `${result.status}: ${result.body.slice(0, 200)}`;
  }

  return {
    realm,
    accessToken: null,
    unavailableReason: `PHASE_2_STEP_3_PENDING — Cannot acquire token from realm '${realm}' via OIDC ROPC. Reason: ${reason}. Likely the OAuth client '${NEW_REALM_CLIENT_ID}' is not yet cloned into the '${realm}' realm or Direct Access Grants is not enabled. Phase 2 / Step 3 (OAuth client migration) must complete before this test can run.`,
    source: 'oidc-direct',
  };
}

export async function getRealmToken(realm: RealmName): Promise<RealmTokenAcquisitionResult> {
  const cached = _cache[realm];
  if (cached) {
    return cached;
  }

  let result: RealmTokenAcquisitionResult;
  if (realm === 'OnlineMenu') {
    result = await acquireOnlineMenuLegacyToken();
  } else {
    result = await acquireNewRealmToken(realm);
  }

  _cache[realm] = result;
  return result;
}

/**
 * Decodes the `iss` claim from a JWT without verifying signature. Used in
 * tests to confirm the token actually came from the expected realm.
 *
 * SECURITY: This is a TEST-only helper. Never use signature-less JWT
 * decoding in production code paths.
 */
export function decodeIssuerClaim(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = Buffer.from(padded + padding, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { iss?: unknown };
    return typeof payload.iss === 'string' ? payload.iss : null;
  } catch {
    return null;
  }
}

/**
 * Resets the per-worker cache. Useful between test files when a token
 * may have been revoked or expired.
 */
export function _resetCacheForTesting(): void {
  for (const k of Object.keys(_cache) as RealmName[]) {
    delete _cache[k];
  }
}
