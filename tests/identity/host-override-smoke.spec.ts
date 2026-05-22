/**
 * Host-override smoke spec — proves the `E2E_HOST_OVERRIDE_IP` mechanism
 * (fixtures/host-override.ts) actually reaches the configured cluster.
 *
 * Two assertions, both tagged `@hostresolve` so the spec is grep-able from the
 * README without dragging in the full identity suite:
 *
 * 1. `APIRequestContext.get(IDENTITY_API_URL + '/health/live')` returns 200
 *    with body "Healthy" — confirms Node-side `dns.lookup` patch routes
 *    `staging.identity-api.dloizides.com` to the override IP.
 *
 * 2. A direct-to-Keycloak ROPC token mint (`grant_type=password`) with the
 *    configured TEST_USER credentials succeeds, and the JWT's `iss` claim
 *    contains the configured KC hostname from `KEYCLOAK_ISSUER` env var —
 *    confirms the token was minted by the cluster the override points at, not
 *    by leakage to a different cluster.
 *
 *    NOTE: Step 5a of the identity-service shrink deleted the identity-api
 *    `/auth/login` proxy; frontends now do ROPC directly against Keycloak. This
 *    leg therefore mints against KC's `/protocol/openid-connect/token` endpoint
 *    (same path `login-direct.spec.ts` uses). The DNS-patch leg above is
 *    unaffected — identity-api's `/health/live` still exists.
 *
 * Skipped automatically when:
 *   - `E2E_HOST_OVERRIDE_IP` is unset (mechanism not active — no point checking)
 *   - `TEST_USER_USERNAME` / `TEST_USER_PASSWORD` unset (can't run the login leg)
 */
import { test, expect, request } from '@playwright/test';
import { retryWhileRateLimited } from '../../helpers/rate-limit.js';

const overrideIp = process.env.E2E_HOST_OVERRIDE_IP?.trim();
const identityApiUrl = process.env.IDENTITY_API_URL?.trim();
const keycloakIssuer = process.env.KEYCLOAK_ISSUER?.trim();
const username = process.env.TEST_USER_USERNAME?.trim();
const password = process.env.TEST_USER_PASSWORD?.trim();
const realm = process.env.IDENTITY_REALM?.trim() || 'OnlineMenu';
// Shared OAuth client across all app realms (Phase 0.1 audit). Direct Access
// Grants stays enabled post-shrink (ADR: ROPC over PKCE, 2026-05-17).
const KC_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID?.trim() || 'online-menu-client';

/**
 * Derive the realm-scoped KC token endpoint from KEYCLOAK_ISSUER. The issuer
 * is `<kc-base>/realms/<realm>`; strip the `/realms/<realm>` suffix to get the
 * base, then re-append the spec's configured `realm`. Mirrors
 * `realm-token-helper.ts#resolveKeycloakBaseUrl`.
 */
function kcTokenEndpoint(): string {
  const match = /^(.*?)\/realms\/[^/]+/.exec(keycloakIssuer as string);
  if (!match?.[1]) {
    throw new Error(`KEYCLOAK_ISSUER='${keycloakIssuer}' does not contain '/realms/<realm>'`);
  }
  const base = match[1].replace(/\/+$/, '');
  return `${base}/realms/${realm}/protocol/openid-connect/token`;
}

test.describe('Host override smoke @hostresolve', () => {
  test.skip(
    !overrideIp,
    'E2E_HOST_OVERRIDE_IP is not set — host override mechanism inactive, smoke not applicable',
  );
  test.skip(!identityApiUrl, 'IDENTITY_API_URL must be set');

  test('Node-side dns.lookup patch routes identity-api to the override IP @hostresolve', async () => {
    // Bare APIRequestContext — no fixture wiring, so the assertion isolates the
    // dns.lookup patch from any test infrastructure that might add its own
    // resolution logic. ignoreHTTPSErrors needed for Traefik default cert.
    const ctx = await request.newContext({ ignoreHTTPSErrors: true, timeout: 10_000 });
    try {
      const response = await ctx.get(`${identityApiUrl}/health/live`);
      expect(response.status()).toBe(200);
      const body = (await response.text()).trim();
      // Identity-api /health/live emits "Healthy" plain-text body.
      expect(body.toLowerCase()).toContain('healthy');
    } finally {
      await ctx.dispose();
    }
  });

  test('JWT iss claim from a real login matches the configured Keycloak issuer @hostresolve', async () => {
    test.skip(!username || !password, 'TEST_USER credentials not configured — JWT leg not runnable');
    test.skip(!keycloakIssuer, 'KEYCLOAK_ISSUER not configured — cannot assert iss claim');
    // Rate-limit retry backoff (Retry-After-aware, up to ~30s cumulative) can
    // eat the default 30s test budget when staging Keycloak is throttling.
    // `test.slow()` triples it to 90s so a throttled login still completes.
    test.slow();

    const ctx = await request.newContext({ ignoreHTTPSErrors: true, timeout: 15_000 });
    try {
      // Step 5a deleted the identity-api /auth/login proxy — mint the token
      // directly against Keycloak via ROPC (grant_type=password), the same
      // path login-direct.spec.ts uses. Keycloak fronts this with brute-force
      // / rate-limiting protection; when this spec runs inside the full
      // identity suite (50+ sequential logins) the limiter can transiently
      // return HTTP 429. `retryWhileRateLimited` retries on 429 only with
      // Retry-After-aware backoff — any other non-200 surfaces immediately via
      // the assertion below, and a persistent 429 still fails the test.
      const loginResponse = await retryWhileRateLimited(
        'host-override-smoke ROPC token mint',
        () =>
          ctx.post(kcTokenEndpoint(), {
            form: {
              grant_type: 'password',
              client_id: KC_CLIENT_ID,
              username: username as string,
              password: password as string,
              scope: 'openid',
            },
          }),
        (response) => response.status(),
        (response) => response.headers()['retry-after'],
      );

      // 401 is a legit auth-rejection — if creds are stale, the test should
      // surface that, not pretend the override is broken.
      expect(
        loginResponse.status(),
        `ROPC token mint at ${kcTokenEndpoint()} failed; if 401, refresh TEST_USER_PASSWORD in .env.<target>.secrets`,
      ).toBe(200);

      const json = (await loginResponse.json()) as { access_token?: string };
      expect(json.access_token, 'Token response missing access_token').toBeTruthy();

      const payload = decodeJwtPayload(json.access_token as string);
      expect(payload.iss, 'JWT iss claim missing').toBeTruthy();

      // KEYCLOAK_ISSUER is the full URL incl. realm path; we only need the
      // hostname segment to be present in the iss claim.
      const issuerHost = new URL(keycloakIssuer as string).hostname;
      expect(
        payload.iss,
        `JWT iss="${payload.iss}" should contain hostname "${issuerHost}" from KEYCLOAK_ISSUER (${keycloakIssuer}). If this fails, the cluster mint'd a token from a different KC than expected — host override is hitting the wrong place.`,
      ).toContain(issuerHost);
    } finally {
      await ctx.dispose();
    }
  });
});

function decodeJwtPayload(jwt: string): { iss?: string;[k: string]: unknown } {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error(`Malformed JWT (expected 3 segments, got ${parts.length})`);
  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json) as { iss?: string };
}
