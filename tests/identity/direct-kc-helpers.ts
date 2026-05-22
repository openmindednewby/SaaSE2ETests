/**
 * Helpers for `login-direct.spec.ts` — direct-to-KC PKCE verification gate.
 * Split solely to satisfy the 300-line lint rule; one caller only.
 *
 * The PKCE primitives mirror `NpmPackages/.../auth-client/src/oidc/pkce.ts`
 * byte-for-byte (RFC 7636 §4.1/§4.2). Duplicated instead of imported: the
 * package isn't an E2E dep, and the spec is the gate that proves the two
 * surfaces agree against a real KC.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import * as crypto from 'node:crypto';
import { retryWhileRateLimited } from '../../helpers/rate-limit.js';

// --- PKCE (RFC 7636) primitives ---

const UNRESERVED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const DEFAULT_VERIFIER_LENGTH = 64;

function generateCodeVerifier(length: number = DEFAULT_VERIFIER_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += UNRESERVED_CHARS[bytes[i] % UNRESERVED_CHARS.length];
  }
  return out;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function deriveCodeChallenge(verifier: string): string {
  const digest = crypto.createHash('sha256').update(verifier, 'utf8').digest();
  return base64UrlEncode(digest);
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

export function randomState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// --- Endpoint config — derived at call time from staging .env ---

/** Realm the Step 1 cutover proves (smallest surface; erevna-web is Step 3). */
export const TARGET_REALM = 'questioner';

/** Shared clientId across all 3 staging app realms (Phase 0.1 audit). */
export const CLIENT_ID = 'online-menu-client';

/**
 * Redirect URI registered on the questioner realm's `online-menu-client`
 * (verified by Phase 0.1 audit + `realms.config.json`).
 */
export const REDIRECT_URI = 'https://staging.erevna.dloizides.com/auth/callback';

/** Seeded by the `keycloak-seed-test-users` Tilt resource. */
export function getTestUser(): { username: string; password: string } {
  const username = process.env.TEST_USER_USERNAME ?? 'superUser';
  const password = process.env.TEST_USER_PASSWORD ?? 'SuperUser123!';
  return { username, password };
}

/**
 * Strip the `/realms/<realm>` suffix from KEYCLOAK_ISSUER to get the bare KC
 * base URL. Mirrors `realm-token-helper.ts#resolveKeycloakBaseUrl` —
 * intentionally duplicated so a divergence surfaces as a real failure.
 */
function resolveKeycloakBaseUrl(): string {
  const issuer = process.env.KEYCLOAK_ISSUER?.trim();
  if (!issuer) {
    throw new Error('KEYCLOAK_ISSUER must be set when running this spec (see .env.staging)');
  }
  const match = /^(.*?)\/realms\/[^/]+/.exec(issuer);
  if (!match?.[1]) {
    throw new Error(`KEYCLOAK_ISSUER='${issuer}' does not contain '/realms/<realm>'`);
  }
  return match[1].replace(/\/+$/, '');
}

export const realmBase = (): string => `${resolveKeycloakBaseUrl()}/realms/${TARGET_REALM}`;
export const authEndpoint = (): string => `${realmBase()}/protocol/openid-connect/auth`;
export const tokenEndpoint = (): string => `${realmBase()}/protocol/openid-connect/token`;
export const expectedIssuer = (): string => realmBase();

// --- Browser-driven auth-code capture ---

export interface AuthCodeResult {
  code: string;
  state: string;
}

interface BuildAuthUrlInput {
  pkce?: PkcePair;
  state: string;
  clientIdOverride?: string;
}

/** Build a fully-parameterised KC `/auth` URL with optional PKCE. */
export function buildAuthUrl(input: BuildAuthUrlInput): URL {
  const url = new URL(authEndpoint());
  url.searchParams.set('client_id', input.clientIdOverride ?? CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', input.state);
  if (input.pkce) {
    url.searchParams.set('code_challenge', input.pkce.codeChallenge);
    url.searchParams.set('code_challenge_method', input.pkce.codeChallengeMethod);
  }
  return url;
}

/**
 * Listen for main-frame navigations to REDIRECT_URI (regardless of query)
 * and stash the full URL into `holder.url`. See `captureAuthCode` for why we
 * use `framenavigated` rather than `page.route()`.
 */
function installRedirectListener(page: Page, holder: { url: string | null }): void {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const navUrl = frame.url();
    try {
      const parsed = new URL(navUrl);
      const stripped = `${parsed.origin}${parsed.pathname}`;
      if (stripped === REDIRECT_URI) holder.url = navUrl;
    } catch {
      // ignore non-URL navigations
    }
  });
}

/**
 * Drive the browser through the KC PKCE auth flow and return the `?code=…`
 * extracted from the redirect URI.
 *
 * Capture mechanism: we listen to `framenavigated` on the main frame. After
 * KC's 302 the main-frame URL transitions to `REDIRECT_URI?code=…&state=…`,
 * even when the redirect target host returns a 404 page (we don't care about
 * its response body — only the URL it was asked to navigate to).
 *
 * We deliberately don't use `page.route()` here. Route interception works for
 * sub-resource fetches but is finicky for top-level document navigation
 * against an unreachable host (Chromium can serve the host's actual response
 * before our handler resolves, depending on caching/timing).
 */
export async function captureAuthCode(
  page: Page,
  pkce: PkcePair,
  state: string,
): Promise<AuthCodeResult> {
  const holder: { url: string | null } = { url: null };
  installRedirectListener(page, holder);

  await page.goto(buildAuthUrl({ pkce, state }).toString());

  const { username, password } = getTestUser();
  await page.locator('input#username, input[name="username"]').fill(username);
  await page.locator('input#password, input[name="password"]').fill(password);
  await page.locator('input#kc-login, button[type="submit"], input[type="submit"]').first().click();

  await expect
    .poll(() => holder.url, { timeout: 15_000, message: 'no redirect to REDIRECT_URI observed' })
    .not.toBeNull();

  const parsed = new URL(holder.url as unknown as string);
  const code = parsed.searchParams.get('code');
  const returnedState = parsed.searchParams.get('state');
  if (!code) throw new Error(`redirect URL has no ?code=…: ${holder.url ?? '<null>'}`);
  if (!returnedState) throw new Error(`redirect URL has no ?state=…: ${holder.url ?? '<null>'}`);
  return { code, state: returnedState };
}

/**
 * Watch the page through a deliberately-misconfigured auth flow. The
 * downgrade + bogus-client tests need to assert "the login form did NOT
 * appear" — that's an absence, so we settle on either of two reachable
 * end-states (a redirect intercept fires, OR the KC error markup renders)
 * and then check that the username input is not present.
 *
 * `redirectHolder` is populated when KC redirects to redirect_uri with an
 * `?error=…` (path (a)). `errorOnKc` is true when a KC error page renders
 * on the KC host (path (b)).
 */
export interface NegativeAuthOutcome {
  redirectError: string | null;
  loginFormVisible: boolean;
  bodyText: string;
}

export async function observeNegativeAuth(page: Page, url: string): Promise<NegativeAuthOutcome> {
  const holder: { url: string | null } = { url: null };
  installRedirectListener(page, holder);

  await page.goto(url).catch(() => {
    // page.goto may reject when the navigation lands on a 4xx/5xx response
    // from the redirect target host. That's an expected end-state for the
    // negative paths and the caller asserts via the outcome shape — swallow.
  });

  const LOGIN_FORM_SELECTOR = 'input#username, input[name="username"]';
  // Either: (a) our intercept fires (redirect happened), OR (b) KC renders an
  // error on its own host, OR (c) the login form appears (which would be a
  // FAILURE for our caller). Wait on the disjunction so we don't hard-sleep.
  const REDIRECT_POLL_MS = 250;
  const SETTLE_TIMEOUT_MS = 10_000;
  await expect
    .poll(
      async () => {
        if (holder.url !== null) return 'redirect';
        const formVisible = await page.locator(LOGIN_FORM_SELECTOR).first().isVisible().catch(() => false);
        if (formVisible) return 'login-form';
        // KC error pages render a stable layout — wait for ANY visible text.
        const hasBodyText = await page.locator('body').innerText().then((t) => t.trim().length > 0).catch(() => false);
        return hasBodyText ? 'kc-error' : null;
      },
      { timeout: SETTLE_TIMEOUT_MS, intervals: [REDIRECT_POLL_MS], message: 'KC did not settle into a redirect, login form, or error page' },
    )
    .not.toBeNull();

  let redirectError: string | null = null;
  if (holder.url !== null) {
    redirectError = new URL(holder.url).searchParams.get('error');
  }

  const loginFormVisible = await page.locator(LOGIN_FORM_SELECTOR).first().isVisible().catch(() => false);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return { redirectError, loginFormVisible, bodyText };
}

// --- Token endpoint helpers ---

export interface KcTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface TokenExchangeResult {
  status: number;
  body: KcTokenResponse;
}

export async function postAuthorizationCode(
  request: APIRequestContext,
  code: string,
  codeVerifier: string,
): Promise<TokenExchangeResult> {
  const response = await retryWhileRateLimited(
    'postAuthorizationCode',
    () =>
      request.post(tokenEndpoint(), {
        form: {
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        },
        failOnStatusCode: false,
      }),
    (r) => r.status(),
    (r) => r.headers()['retry-after'],
  );
  return { status: response.status(), body: (await response.json()) as KcTokenResponse };
}

export async function postRefreshToken(
  request: APIRequestContext,
  refreshToken: string,
): Promise<TokenExchangeResult> {
  const response = await retryWhileRateLimited(
    'postRefreshToken',
    () =>
      request.post(tokenEndpoint(), {
        form: {
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        },
        failOnStatusCode: false,
      }),
    (r) => r.status(),
    (r) => r.headers()['retry-after'],
  );
  return { status: response.status(), body: (await response.json()) as KcTokenResponse };
}

/** Decode the `exp` (unix-seconds) claim from a JWT. Signature not verified. */
export function decodeExpClaim(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = Buffer.from(padded + padding, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
