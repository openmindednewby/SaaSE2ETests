import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { canaryHeaders } from './canary-prefix.js';
import { sharedHttpsAgent } from './http-agent.js';
import { withRateLimitRetry } from './rate-limit.js';

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

export class AuthHelper {
  private apiClient: AxiosInstance;
  private tokens: TokenResponse | null = null;
  private lastCredentials: CredentialMemo | null = null;

  constructor(baseUrl?: string) {
    // The IdentityService uses /api/v1 prefix for all endpoints
    const apiBase = baseUrl || process.env.IDENTITY_API_URL || 'http://localhost:5002';
    // The realm resolver added in the cookie-auth task rejects requests with no
    // X-Realm header when the service is configured for multi-realm. The legacy
    // E2E tests (questioner-realm) need to declare their realm explicitly.
    const realm = process.env.IDENTITY_REALM || 'questioner';
    this.apiClient = axios.create({
      baseURL: apiBase.endsWith('/api/v1') ? apiBase : `${apiBase}/api/v1`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Realm': realm,
      },
      httpsAgent: sharedHttpsAgent,
    });
  }

  /**
   * Login via API using username and password
   */
  async loginViaAPI(username: string, password: string, tenantId?: string): Promise<TokenResponse> {
    const response = await withRateLimitRetry('loginViaAPI', () =>
      this.apiClient.post<TokenResponse>('/auth/login', {
        method: 0, // AuthMethod.UsernamePassword
        username,
        password,
        tenantId,
      }),
    );

    if (!response.data.accessToken) {
      throw new Error(`Login failed: ${response.data.errorMessage || 'Unknown error'}`);
    }

    this.tokens = response.data;
    this.lastCredentials = { username, password, tenantId };
    return this.tokens;
  }

  /**
   * Refresh tokens using refresh token
   */
  async refreshTokens(): Promise<TokenResponse> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await withRateLimitRetry('refreshTokens', () =>
      this.apiClient.post<TokenResponse>('/auth/refresh', {
        refreshToken: this.tokens?.refreshToken,
      }),
    );

    if (!response.data.accessToken) {
      throw new Error(`Token refresh failed: ${response.data.errorMessage || 'Unknown error'}`);
    }

    this.tokens = response.data;
    return this.tokens;
  }

  /**
   * Logout and revoke tokens
   */
  async logout(): Promise<LogoutResponse> {
    if (!this.tokens?.accessToken) {
      return { success: true };
    }

    const response = await this.apiClient.post<LogoutResponse>('/auth/logout', {
      token: this.tokens.accessToken,
    });

    this.tokens = null;
    return response.data;
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return this.tokens?.accessToken ?? null;
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    return this.tokens?.refreshToken ?? null;
  }

  /**
   * Get current tokens
   */
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
