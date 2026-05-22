/**
 * Step 1 verification gate — direct-to-KC PKCE flow against staging Keycloak.
 *
 * Purpose
 * -------
 * `@dloizides/auth-client@2.1.0` adds the `useDirectKcAuth` flag + shared OIDC
 * primitives in `src/oidc/`. Steps 2-4 of the "shrink identity service"
 * migration will flip that flag on per-app, cutting out the identity-api
 * `/auth/*` proxy.
 *
 * Before any app cutover, this spec proves the direct path itself works
 * end-to-end against the staging Keycloak deployment:
 *
 *   Browser → KC `/realms/questioner/protocol/openid-connect/auth` (PKCE S256)
 *     → KC login form (seeded `superUser`)
 *     → 302 to redirect_uri with `?code=…`
 *     → POST `/protocol/openid-connect/token` (grant=authorization_code + verifier)
 *     → JWT with `iss = …/realms/questioner`
 *
 * Plus three security/regression pins:
 *   - Refresh token works (grant=refresh_token returns a fresh access token).
 *   - PKCE downgrade is blocked (auth request with NO code_challenge fails).
 *     Pins the Phase 0.1 audit's `pkce.code.challenge.method=S256` enforcement.
 *   - Wrong `client_id` is rejected. Pins the shared `online-menu-client`
 *     literal — a future rename will fail this test loudly.
 *
 * Scope
 * -----
 *   - STAGING ONLY. `test.skip(!isStagingTarget())` keeps the local suite
 *     fast and avoids depending on local KC seeding shape.
 *   - Chromium only. Firefox can't reach staging hostnames (see helpers/target).
 *   - Drives the `questioner` realm because that's the smallest end-to-end
 *     surface where the direct-KC path will be flipped on (Step 3 — erevna-web).
 *
 * PKCE/token-endpoint helpers live in `direct-kc-helpers.ts` (split for the
 * 300-line lint rule). Those helpers inline the auth-client OIDC primitives
 * since the package isn't a dependency of E2ETests; the spec acts as the
 * gate that proves the inlined surface agrees with the package surface
 * against a real KC.
 */
import { test, expect } from '@playwright/test';
import {
  isStagingTarget,
  FIREFOX_STAGING_SKIP_REASON,
  firefoxCannotReachStaging,
} from '../../helpers/target.js';
import { decodeIssuerClaim } from '../../helpers/realm-token-helper.js';
import {
  buildAuthUrl,
  captureAuthCode,
  decodeExpClaim,
  expectedIssuer,
  generatePkcePair,
  observeNegativeAuth,
  postAuthorizationCode,
  postRefreshToken,
  randomState,
} from './direct-kc-helpers.js';

test.describe('Direct-to-KC PKCE Login @identity @auth @direct-kc', () => {
  // Staging-only by design (Step 1 verification gate).
  test.skip(
    !isStagingTarget(),
    'login-direct.spec.ts is a staging-only verification gate (set E2E_TARGET=staging)',
  );

  // Firefox can't reach staging hostnames (Chromium --host-resolver-rules only).
  test.skip(({ browserName }) => firefoxCannotReachStaging(browserName), FIREFOX_STAGING_SKIP_REASON);

  // Slow-test allowance for the browser-driven flow (KC login form + redirect).
  test.slow();

  test('happy path: PKCE auth-code exchange yields a JWT issued by the questioner realm', async ({ page, request }) => {
    const pkce = generatePkcePair();
    const state = randomState();

    const { code, state: returnedState } = await captureAuthCode(page, pkce, state);
    expect(returnedState, 'state round-tripped from KC must equal the one we sent (CSRF protection)').toBe(state);

    const { status, body } = await postAuthorizationCode(request, code, pkce.codeVerifier);
    expect(status, `token exchange failed: ${body.error ?? ''} ${body.error_description ?? ''}`.trim()).toBe(200);
    expect(body.access_token, 'KC returned no access_token').toBeTruthy();
    expect(body.refresh_token, 'KC returned no refresh_token').toBeTruthy();
    expect(body.token_type?.toLowerCase()).toBe('bearer');

    const issuer = decodeIssuerClaim(body.access_token as string);
    expect(issuer, 'access_token iss claim must match the staging questioner realm').toBe(expectedIssuer());

    const exp = decodeExpClaim(body.access_token as string);
    expect(exp, 'access_token must carry an exp claim').not.toBeNull();
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(exp as number, 'access_token exp must be in the future').toBeGreaterThan(nowSeconds);
  });

  test('refresh: grant_type=refresh_token returns a fresh access token', async ({ page, request }) => {
    // Mint a fresh token pair (we can't reuse the happy-path one — Playwright
    // tests must be isolated; each test gets its own page+request context).
    const pkce = generatePkcePair();
    const { code } = await captureAuthCode(page, pkce, randomState());
    const initial = await postAuthorizationCode(request, code, pkce.codeVerifier);
    expect(initial.status, 'precondition: initial token exchange must succeed').toBe(200);
    expect(initial.body.refresh_token).toBeTruthy();

    const initialAccessToken = initial.body.access_token as string;
    const initialExp = decodeExpClaim(initialAccessToken) ?? 0;

    const refreshed = await postRefreshToken(request, initial.body.refresh_token as string);
    expect(
      refreshed.status,
      `refresh failed: ${refreshed.body.error ?? ''} ${refreshed.body.error_description ?? ''}`.trim(),
    ).toBe(200);
    expect(refreshed.body.access_token, 'refresh returned no access_token').toBeTruthy();

    const refreshedAccessToken = refreshed.body.access_token as string;

    // KC issues `exp` at second granularity. When the refresh lands in the same
    // wall-clock second as the original mint, the new `exp` *equals* the old
    // one — a strict `>` assertion would flake. Assert `>=` for `exp` AND that
    // the access-token string itself changed: a genuine refresh always returns
    // a freshly-signed token (new `iat`/`jti`/signature) even when both tokens
    // share an `exp` second-bucket. The pair proves a real refresh happened
    // without an artificial sleep.
    const refreshedExp = decodeExpClaim(refreshedAccessToken) ?? 0;
    expect(
      refreshedExp,
      'refreshed access_token exp must be at least as late as the initial one',
    ).toBeGreaterThanOrEqual(initialExp);
    expect(
      refreshedAccessToken,
      'refresh must return a freshly-signed access_token distinct from the original',
    ).not.toBe(initialAccessToken);

    // Issuer must still be the questioner realm.
    expect(decodeIssuerClaim(refreshedAccessToken)).toBe(expectedIssuer());
  });

  test('downgrade: PKCE-less auth request is rejected (S256 enforcement regression test)', async ({ page }) => {
    // Phase 0.1 audit pinned `pkce.code.challenge.method=S256` on
    // `online-menu-client` across all 3 staging realms. A future regression
    // (e.g. someone re-runs `provision-realms.ps1` without `-PatchClientAttributes`)
    // would re-allow PKCE-less flows. This test fires the exact downgrade
    // attack and asserts KC refuses it.
    const url = buildAuthUrl({ state: randomState() }).toString(); // no pkce → PKCE-less request
    const outcome = await observeNegativeAuth(page, url);

    // KC rejects this two ways depending on theme/version:
    //  (a) it redirects back to redirect_uri with ?error=invalid_request, OR
    //  (b) it shows an in-page error page on the KC host.
    // Both are pass conditions; the failure case would be reaching the login
    // form (which would mean PKCE is no longer required).
    const REDIRECT_ERR_VARIANT = '(a) redirect to redirect_uri with ?error=invalid_request';
    const KC_ERR_VARIANT = '(b) KC in-page error';
    const observed = outcome.redirectError !== null
      ? `${REDIRECT_ERR_VARIANT}: error=${outcome.redirectError}`
      : outcome.loginFormVisible
        ? 'login form rendered — PKCE NO LONGER ENFORCED (regression of Phase 0.1)'
        : KC_ERR_VARIANT;

    expect(
      outcome.loginFormVisible,
      `Expected KC to reject PKCE-less request, observed: ${observed}. ` +
        `Check pkce.code.challenge.method=S256 on the questioner realm's online-menu-client.`,
    ).toBe(false);
  });

  test('client_id: bogus client_id is rejected by KC', async ({ page }) => {
    // Pins the shared `online-menu-client` literal. A future rename (e.g.
    // someone splits to per-app clients without updating apps) would fail
    // this test loudly with "login form never appeared" or "KC error page".
    const pkce = generatePkcePair();
    const url = buildAuthUrl({
      pkce,
      state: randomState(),
      clientIdOverride: 'nonexistent-client-for-e2e',
    }).toString();
    const outcome = await observeNegativeAuth(page, url);

    // The login form must NOT appear — that would mean the bogus client was accepted.
    expect(outcome.loginFormVisible, 'KC accepted a bogus client_id (security regression)').toBe(false);

    // The KC error page contains one of these markers (varies by theme).
    const errorMarkers = [
      'Client not found',
      'Invalid parameter: client_id',
      'We are sorry',
      'invalid_client',
    ];
    const hasErrorMarker = errorMarkers.some((m) => outcome.bodyText.includes(m));
    expect(
      hasErrorMarker,
      `Expected a KC error page for unknown client_id. body text (first 500 chars): ${outcome.bodyText.slice(0, 500)}`,
    ).toBe(true);
  });
});
