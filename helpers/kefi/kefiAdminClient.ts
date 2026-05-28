/**
 * Server-side admin helper for the Phase B Kefi tenant-lifecycle E2E.
 *
 * Mints a platform-admin bearer via ROPC against the kefi realm
 * (`bff-kefi-client` confidential + direct-grant + `kefi-platformadmin`
 * test user) and exposes thin wrappers around the two Phase-A admin
 * endpoints:
 *   - POST /api/v1/admin/lifecycle/trigger-welcome-sweep
 *   - DELETE /api/v1/internal/canary-cleanup?canaryId=...
 *
 * Why ROPC over PKCE: this helper runs server-side from a Playwright spec
 * (no browser, no consent screen). `bff-kefi-client` has
 * `directAccessGrantsEnabled=true`; `kefi-web` (public) does not. Mirrors
 * the existing `helpers/auth-helper.ts` ROPC pattern but against the kefi
 * realm + the platform-admin role instead of the OnlineMenu realm.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

interface AdminClientOptions {
  /** Username of the kefi-platform-admin user. Reads KEFI_PLATFORM_ADMIN_USERNAME by default. */
  username?: string;
  /** Password for the user. Reads KEFI_PLATFORM_ADMIN_PASSWORD by default. */
  password?: string;
  /** bff-kefi-client secret. Reads KEFI_BFF_CLIENT_SECRET by default. */
  clientSecret?: string;
}

export interface WelcomeSweepResult {
  eligibleCount: number;
  sentCount: number;
  skippedCount: number;
}

export interface CanaryCleanupResult {
  canaryId: string;
  tenantsDeleted: number;
  usersDeleted: number;
  ingressesDeleted: number;
  certificatesDeleted: number;
  secretsDeleted: number;
}

interface RawTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

function requireSecret(name: string, override: string | undefined): string {
  if (override && override.length > 0) return override;
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[kefiAdminClient] Required env var ${name} is unset. Add it to .env.<target>.secrets.`,
    );
  }
  return value;
}

/**
 * Mint a fresh kefi-platform-admin bearer. Cached for the lifetime of one
 * helper instance — KC tokens live for 5 min by default and the whole spec
 * runs in well under that.
 */
export class KefiAdminClient {
  private token: string | null = null;
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();
  private readonly options: AdminClientOptions;

  constructor(options: AdminClientOptions = {}) {
    this.options = options;
    this.http = axios.create({
      baseURL: this.urls.apiUrl,
      timeout: 30000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  async getBearer(): Promise<string> {
    if (this.token) return this.token;

    const username = requireSecret('KEFI_PLATFORM_ADMIN_USERNAME', this.options.username);
    const password = requireSecret('KEFI_PLATFORM_ADMIN_PASSWORD', this.options.password);
    const clientSecret = requireSecret('KEFI_BFF_CLIENT_SECRET', this.options.clientSecret);

    const tokenUrl = `${this.urls.kcUrl}/realms/${this.urls.kcRealm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.urls.bffClientId,
      client_secret: clientSecret,
      username,
      password,
      scope: 'openid',
    });

    const resp = await axios.post<RawTokenResponse>(tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: sharedHttpsAgent,
      timeout: 30000,
      validateStatus: () => true,
    });

    if (resp.status >= 200 && resp.status < 300 && resp.data.access_token) {
      this.token = resp.data.access_token;
      return this.token;
    }
    throw new Error(
      `[kefiAdminClient] ROPC token mint failed (${resp.status}): ${resp.data.error ?? ''} ${resp.data.error_description ?? ''}`,
    );
  }

  /** Fire one welcome-email sweep. Returns the per-bucket counts. */
  async triggerWelcomeSweep(): Promise<WelcomeSweepResult> {
    const bearer = await this.getBearer();
    const resp = await this.http.post<WelcomeSweepResult>(
      '/api/v1/admin/lifecycle/trigger-welcome-sweep',
      undefined,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (resp.status !== 202) {
      throw new Error(
        `[kefiAdminClient] trigger-welcome-sweep expected 202, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data;
  }

  /** Sweep every Kefi resource for the given canary id. Idempotent — re-runs return 0s. */
  async canaryCleanup(canaryId: string): Promise<CanaryCleanupResult> {
    const bearer = await this.getBearer();
    const resp = await this.http.delete<CanaryCleanupResult>('/api/v1/internal/canary-cleanup', {
      params: { canaryId },
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (resp.status !== 200) {
      throw new Error(
        `[kefiAdminClient] canary-cleanup expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data;
  }
}
