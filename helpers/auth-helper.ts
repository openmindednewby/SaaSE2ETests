import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { canaryHeaders } from './canary-prefix.js';
import { sharedHttpsAgent } from './http-agent.js';
import { withRateLimitRetry } from './rate-limit.js';

/**
 * Auth helper — direct-to-Keycloak (Step 4 of "shrink IdentityService").
 *
 * Background
 * ----------
 * Steps 2 + 3 cut katalogos-web and erevna-web over to ROPC against KC's
 * realm token endpoint directly. Step 4 finishes the cutover by:
 *   1. Flipping BaseClient to the same direct-KC adapter, and
 *   2. Rewiring this helper's `loginViaAPI` / `refreshTokens` / `logout` to
 *      mint tokens against KC instead of POSTing to identity-api `/auth/*`.
 *
 * The proxied identity-api endpoints are deleted in Step 5a; this helper has
 * to be on KC BEFORE that PR ships, otherwise `global-setup.canary.ts` (which
 * mints the superUser JWT in workers) breaks at the merge.
 *
 * Why ROPC, not PKCE: the parent task's 2026-05-17 ADR — preserves the apps'
 * native branded login UX. KC's `direct_access_grants_enabled=true` stays on
 * the `online-menu-client` records post-shrink.
 *
 * Why the X-Realm header went away: the realm is in the URL path now
 * (`/realms/{realm}/protocol/openid-connect/token`). The helper still reads
 * the per-target `IDENTITY_REALM` env var (or parses it out of the
 * `KEYCLOAK_ISSUER` URL when unset) so a single helper can mint tokens for
 * the OnlineMenu / questioner / onlinemenu / etc. realms.
 *
 * Rate limiting: `withRateLimitRetry` stays as defence-in-depth even though
 * KC's brute-force protection is more polite than identity-api's was. Cheap
 * insurance.
 */

interface TokenResponse {
  accessToken: string | null;
  refreshToken: string | null;
  tokenType: string | null;
  expiresIn: number;
  userInfo: {
    sub: string;
    email: string;
    name: string;
    roles: string[];
  } | null;
  errorMessage?: string;
  errorCode?: string;
}

interface LogoutResponse {
  success: boolean;
  errorMessage?: string;
}

interface CredentialMemo {
  username: string;
  password: string;
  tenantId?: string;
}

interface RawKcTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const HTTP_OK_MIN = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const KC_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'online-menu-client';
const DEFAULT_REALM = 'onlinemenu';

/**
 * Resolves the KC base URL (scheme + host, no `/realms/...`) from
 * `KEYCLOAK_ISSUER`. Throws if neither `KEYCLOAK_ISSUER` nor an explicit
 * `KEYCLOAK_URL` is set — silently falling back to a hardcoded prod URL
 * would mint tokens against the wrong cluster. Mirrors the pattern from
 * `realm-token-helper.ts`.
 */
function resolveKcBaseUrl(): string {
  const explicit = process.env.KEYCLOAK_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const issuer = process.env.KEYCLOAK_ISSUER?.trim();
  if (issuer) {
    const match = /^(.*?)\/realms\/[^/]+/.exec(issuer);
    if (match && match[1]) return match[1].replace(/\/+$/, '');
    throw new Error(
      `[auth-helper] KEYCLOAK_ISSUER="${issuer}" missing /realms/<realm> segment — cannot derive KC base URL.`,
    );
  }
  throw new Error(
    '[auth-helper] Cannot resolve the Keycloak base URL: set KEYCLOAK_ISSUER (or KEYCLOAK_URL) in the active .env.<target> file.',
  );
}

/**
 * Resolves the realm name from `IDENTITY_REALM` (preferred — matches what
 * the deployed frontend ConfigMap points at), falling back to parsing the
 * `KEYCLOAK_ISSUER` URL, then to a hardcoded `onlinemenu` last-resort.
 */
function resolveRealm(override?: string): string {
  if (override && override.length > 0) return override;
  const explicit = process.env.IDENTITY_REALM?.trim();
  if (explicit) return explicit;
  const issuer = process.env.KEYCLOAK_ISSUER?.trim();
  if (issuer) {
    const match = /\/realms\/([^/?#]+)/.exec(issuer);
    if (match && match[1]) return match[1];
  }
  return DEFAULT_REALM;
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = Buffer.from(padded + padding, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractRoles(claims: Record<string, unknown> | null): string[] {
  if (!claims) return [];
  const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
  const resourceAccess = claims.resource_access as Record<string, { roles?: string[] }> | undefined;
  const realmRoles = realmAccess?.roles ?? [];
  const resourceRoles = resourceAccess?.[KC_CLIENT_ID]?.roles ?? [];
  return [...realmRoles, ...resourceRoles];
}

function tokenResponseFromRaw(raw: RawKcTokenResponse): TokenResponse {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : null;
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : null;
  const tokenType = typeof raw.token_type === 'string' ? raw.token_type : null;
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 0;
  let userInfo: TokenResponse['userInfo'] = null;
  if (accessToken) {
    const claims = decodeJwtClaims(accessToken);
    if (claims && typeof claims.sub === 'string') {
      userInfo = {
        sub: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : '',
        name: typeof claims.name === 'string' ? claims.name : '',
        roles: extractRoles(claims),
      };
    }
  }
  return { accessToken, refreshToken, tokenType, expiresIn, userInfo };
}

function isHttpOk(status: number): boolean {
  return status >= HTTP_OK_MIN && status < HTTP_MULTIPLE_CHOICES;
}

export class AuthHelper {
  private kcClient: AxiosInstance;
  private realm: string;
  private tokens: TokenResponse | null = null;
  private lastCredentials: CredentialMemo | null = null;

  /**
   * @param baseUrl Legacy compat — accepted but ignored; KC base URL is
   *                resolved from `KEYCLOAK_ISSUER`. Kept so existing callers
   *                (`new AuthHelper(IDENTITY_API_URL)`) compile unchanged.
   * @param realmOverride Per-call realm override — questioner browser tests
   *                use this to mint a 'questioner' token even when the helper
   *                would default to 'onlinemenu'.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(baseUrl?: string, realmOverride?: string) {
    const kcBase = resolveKcBaseUrl();
    this.realm = resolveRealm(realmOverride);
    this.kcClient = axios.create({
      baseURL: `${kcBase}/realms/${this.realm}/protocol/openid-connect`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      httpsAgent: sharedHttpsAgent,
      // 4xx responses (e.g. KC 401 invalid_grant) come back as proper Response
      // objects so we can mine their bodies for the KC error_description.
      validateStatus: () => true,
    });
  }

  /**
   * Login via direct-to-KC ROPC. POSTs `grant_type=password` to the realm's
   * `/protocol/openid-connect/token` endpoint and normalises the response
   * into the legacy `TokenResponse` shape (so callers that destructure
   * `accessToken` / `userInfo.roles` keep working unchanged).
   *
   * The `tenantId` parameter is accepted for API compatibility but no longer
   * sent — KC issues per-realm JWTs without a tenant routing hint. Cleanup
   * endpoints downstream still get tenant context from the JWT's claims.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async loginViaAPI(username: string, password: string, tenantId?: string): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('client_id', KC_CLIENT_ID);
    body.set('scope', 'openid profile email');
    body.set('username', username);
    body.set('password', password);

    const response = await withRateLimitRetry('loginViaAPI', () =>
      this.kcClient.post<RawKcTokenResponse>('/token', body.toString()),
    );

    if (!isHttpOk(response.status)) {
      const raw = response.data ?? {};
      const detail = typeof raw.error_description === 'string' ? raw.error_description : raw.error;
      throw new Error(`Login failed (status ${response.status}): ${detail || 'unknown error'}`);
    }

    const normalised = tokenResponseFromRaw(response.data ?? {});
    if (!normalised.accessToken) {
      throw new Error('Login failed: KC returned no access_token');
    }

    this.tokens = normalised;
    this.lastCredentials = { username, password, tenantId };
    return this.tokens;
  }

  /** Refresh tokens via `grant_type=refresh_token` against KC. */
  async refreshTokens(): Promise<TokenResponse> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('client_id', KC_CLIENT_ID);
    body.set('refresh_token', this.tokens.refreshToken);

    const response = await withRateLimitRetry('refreshTokens', () =>
      this.kcClient.post<RawKcTokenResponse>('/token', body.toString()),
    );

    if (!isHttpOk(response.status)) {
      const raw = response.data ?? {};
      const detail = typeof raw.error_description === 'string' ? raw.error_description : raw.error;
      throw new Error(`Token refresh failed (status ${response.status}): ${detail || 'unknown error'}`);
    }

    const normalised = tokenResponseFromRaw(response.data ?? {});
    if (!normalised.accessToken) {
      throw new Error('Token refresh failed: KC returned no access_token');
    }

    this.tokens = normalised;
    return this.tokens;
  }

  /**
   * Logout via KC end-session endpoint. Best-effort — KC returns 204 when it
   * succeeds and we don't gate on the response shape. Failure is non-fatal.
   */
  async logout(): Promise<LogoutResponse> {
    if (!this.tokens?.accessToken) {
      return { success: true };
    }

    const body = new URLSearchParams();
    body.set('client_id', KC_CLIENT_ID);
    if (this.tokens.refreshToken) body.set('refresh_token', this.tokens.refreshToken);

    try {
      await this.kcClient.post('/logout', body.toString(), {
        headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
      });
    } catch {
      // best-effort — UI state was already cleared by the time this runs
    }

    this.tokens = null;
    return { success: true };
  }

  /** Get current access token */
  getAccessToken(): string | null {
    return this.tokens?.accessToken ?? null;
  }

  /** Get current refresh token */
  getRefreshToken(): string | null {
    return this.tokens?.refreshToken ?? null;
  }

  /** Get current tokens */
  getTokens(): TokenResponse | null {
    return this.tokens;
  }

  /**
   * Create an authenticated axios instance for API calls.
   *
   * When canary mode is active (E2E_CANARY_RUN_ID set by
   * `global-setup.canary.ts`), `X-Canary-Run-Id` is attached to every
   * outbound request via `canaryHeaders()`. Non-canary mode: no-op.
   */
  createAuthenticatedClient(baseURL: string): AxiosInstance {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated');
    }

    return axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.tokens.accessToken}`,
        // canaryHeaders() returns X-Canary-Run-Id only when canary mode is on.
        // We omit its Authorization override here because per-call tokens
        // already authenticated this client.
        ...(canaryHeaders().Authorization ? { 'X-Canary-Run-Id': canaryHeaders()['X-Canary-Run-Id'] } : {}),
      },
      httpsAgent: sharedHttpsAgent,
    });
  }

  /**
   * Create an authenticated axios instance that auto-recovers from token expiry.
   *
   * On 401 from any request:
   *   1. Try refresh-token swap → retry the original request once.
   *   2. If refresh fails AND the helper has cached login credentials, do a
   *      full re-login (username + password) → retry the original request once.
   *   3. If both fail, the original 401 propagates.
   *
   * Required for any suite that might run longer than the access-token TTL
   * (Keycloak default is 5 minutes). The `--workers=1` prod canary at ~17 min
   * serial WILL hit this even on the happy path.
   */
  createAuthenticatedClientWithRefresh(baseURL: string): AxiosInstance {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated');
    }

    const client = axios.create({
      baseURL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
      httpsAgent: sharedHttpsAgent,
    });

    client.interceptors.request.use((config) => {
      if (this.tokens?.accessToken) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${this.tokens.accessToken}`;
      }
      // Inject X-Canary-Run-Id when canary mode is active. Don't override
      // the just-set Authorization header — canary mode pairs the header
      // with the request's own JWT (which must carry the superUser role for
      // canary behavior to be honored backend-side).
      const canary = canaryHeaders();
      if (canary['X-Canary-Run-Id']) {
        config.headers = config.headers ?? {};
        config.headers['X-Canary-Run-Id'] = canary['X-Canary-Run-Id'];
      }
      return config;
    });

    client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const status = error.response?.status;
        const originalRequest = error.config as AxiosRequestConfig & { _retryCount?: number };

        if (status !== 401 || !originalRequest) throw error;

        originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;
        if (originalRequest._retryCount > 2) throw error;

        // Attempt 1: refresh-token swap
        if (originalRequest._retryCount === 1 && this.tokens?.refreshToken) {
          try {
            await this.refreshTokens();
            return await client.request(originalRequest);
          } catch {
            // fall through to re-login attempt
          }
        }

        // Attempt 2 (or refresh failed on attempt 1): full re-login
        if (this.lastCredentials) {
          await this.loginViaAPI(
            this.lastCredentials.username,
            this.lastCredentials.password,
            this.lastCredentials.tenantId,
          );
          return client.request(originalRequest);
        }

        throw error;
      },
    );

    return client;
  }
}
