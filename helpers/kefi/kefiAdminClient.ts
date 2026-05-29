/**
 * Server-side admin helper for the Kefi tenant-lifecycle E2E.
 *
 * Mints bearers via ROPC against the kefi realm
 * (`bff-kefi-client` confidential + direct-grant) and exposes thin wrappers
 * around the admin endpoints the spec needs:
 *   - POST   /api/v1/admin/lifecycle/trigger-welcome-sweep        (platform-admin)
 *   - DELETE /api/v1/internal/canary-cleanup?canaryId=...         (platform-admin)
 *   - PUT    /api/v1/admin/landing-config                         (tenant-owner)
 *   - POST   /api/v1/admin/landing-config/publish                 (tenant-owner)
 *   - GET    /api/v1/admin/landing-config/publish/{jobName}       (tenant-owner)
 *
 * Why ROPC over PKCE: this helper runs server-side from a Playwright spec
 * (no browser, no consent screen). `bff-kefi-client` has
 * `directAccessGrantsEnabled=true`; `kefi-web` (public) does not. Mirrors
 * the existing `helpers/auth-helper.ts` ROPC pattern but against the kefi
 * realm.
 *
 * Two separate bearer caches: one for the platform-admin user (Phase A's
 * sweep/cleanup endpoints), one keyed by the canary-tenant-owner's email
 * (Phase C's landing-config + publish endpoints). They never collide
 * because the tenant-owner cache is freshly created per-spec; the
 * platform-admin cache lives for the whole client instance.
 */

import axios, { type AxiosInstance } from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { SavedLandingDto } from './kefiKucyShapedConfig.js';
import {
  type AdminClientOptions,
  type CanaryCleanupResult,
  type CanaryTenantState,
  type PublishLandingResult,
  type RawTokenResponse,
  type WelcomeSweepResult,
  PUBLISH_TERMINAL_STATUSES,
  requireSecret,
} from './kefiAdminClient.types.js';

// Re-export so callers that imported from kefiAdminClient continue to work.
export type {
  CanaryCleanupResult,
  CanaryTenantState,
  PublishLandingResult,
  WelcomeSweepResult,
} from './kefiAdminClient.types.js';

/**
 * Mint a fresh kefi-platform-admin bearer. Cached for the lifetime of one
 * helper instance — KC tokens live for 5 min by default and the whole spec
 * runs in well under that.
 */
export class KefiAdminClient {
  private token: string | null = null;
  /** Cache of tenant-owner ROPC tokens, keyed by `{username}::{clientSecret}`. */
  private readonly tenantOwnerTokens = new Map<string, string>();
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

  /**
   * Read the canary tenant's lifecycle-column snapshot (Phase-D follow-up).
   * Returns `found: false` when no tenant matches — never throws on a clean
   * sweep, only on a non-200 (auth/validation) response.
   */
  async getCanaryTenantState(canaryId: string): Promise<CanaryTenantState> {
    const bearer = await this.getBearer();
    const resp = await this.http.get<CanaryTenantState>('/api/v1/internal/canary-tenant', {
      params: { canaryId },
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (resp.status !== 200) {
      throw new Error(
        `[kefiAdminClient] canary-tenant expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data;
  }

  /**
   * Mint a tenant-owner bearer for the given canary signup credentials.
   * Cached per-spec so a subsequent putLandingConfig + publish reuse the
   * same token (KC default access-token lifetime is 5 min; spec is faster).
   */
  async getTenantOwnerBearer(input: {
    email: string;
    password: string;
  }): Promise<string> {
    const clientSecret = requireSecret('KEFI_BFF_CLIENT_SECRET', this.options.clientSecret);
    const cacheKey = `${input.email}::${clientSecret.slice(0, 8)}`;
    const cached = this.tenantOwnerTokens.get(cacheKey);
    if (cached) return cached;

    const tokenUrl = `${this.urls.kcUrl}/realms/${this.urls.kcRealm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.urls.bffClientId,
      client_secret: clientSecret,
      username: input.email,
      password: input.password,
      scope: 'openid',
    });

    const resp = await axios.post<RawTokenResponse>(tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: sharedHttpsAgent,
      timeout: 30000,
      validateStatus: () => true,
    });

    if (resp.status >= 200 && resp.status < 300 && resp.data.access_token) {
      this.tenantOwnerTokens.set(cacheKey, resp.data.access_token);
      return resp.data.access_token;
    }
    throw new Error(
      `[kefiAdminClient] tenant-owner ROPC mint failed for ${input.email} (${resp.status}): ${resp.data.error ?? ''} ${resp.data.error_description ?? ''}`,
    );
  }

  /** PUT /admin/landing-config — overwrites the calling tenant's saved config. */
  async putLandingConfig(input: {
    ownerEmail: string;
    ownerPassword: string;
    dto: SavedLandingDto;
  }): Promise<void> {
    const bearer = await this.getTenantOwnerBearer({
      email: input.ownerEmail,
      password: input.ownerPassword,
    });
    const resp = await this.http.put('/api/v1/admin/landing-config', input.dto, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (resp.status !== 200) {
      throw new Error(
        `[kefiAdminClient] put landing-config expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
  }

  /**
   * POST /admin/landing-config/publish — enqueues the publish K8s Job. The
   * Pro+ plan gate is enforced inside the handler; the canary tenant picks
   * `pro` in the wizard so the gate passes without Stripe involvement.
   */
  async publishLanding(input: {
    ownerEmail: string;
    ownerPassword: string;
  }): Promise<PublishLandingResult> {
    const bearer = await this.getTenantOwnerBearer({
      email: input.ownerEmail,
      password: input.ownerPassword,
    });
    const resp = await this.http.post<PublishLandingResult>(
      '/api/v1/admin/landing-config/publish',
      undefined,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (resp.status !== 202) {
      throw new Error(
        `[kefiAdminClient] publish expected 202, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data;
  }

  /**
   * Poll GET /admin/landing-config/publish/{jobName} until terminal
   * (`Succeeded` or `Failed`) or the budget expires. Throws on `Failed` or
   * on timeout — the caller can wrap in a `try` if a non-terminal job is OK.
   *
   * Budget defaults to 240s — kaniko build + kefi-landings rollout takes
   * 60-180s in practice on prod; staging is slower.
   */
  async pollPublishStatus(input: {
    ownerEmail: string;
    ownerPassword: string;
    jobName: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<PublishLandingResult> {
    const timeoutMs = input.timeoutMs ?? 240_000;
    const pollIntervalMs = input.pollIntervalMs ?? 5_000;
    const bearer = await this.getTenantOwnerBearer({
      email: input.ownerEmail,
      password: input.ownerPassword,
    });
    const deadline = Date.now() + timeoutMs;
    let lastStatus: PublishLandingResult | null = null;

    while (Date.now() < deadline) {
      const resp = await this.http.get<PublishLandingResult>(
        `/api/v1/admin/landing-config/publish/${encodeURIComponent(input.jobName)}`,
        { headers: { Authorization: `Bearer ${bearer}` } },
      );
      if (resp.status === 200) {
        lastStatus = resp.data;
        if (PUBLISH_TERMINAL_STATUSES.has(lastStatus.status)) {
          if (lastStatus.status === 'Failed') {
            throw new Error(
              `[kefiAdminClient] publish job ${input.jobName} terminal Failed: ${lastStatus.message}`,
            );
          }
          return lastStatus;
        }
      } else if (resp.status === 404) {
        // The Job hasn't been visible to the K8s informer yet — keep polling.
      } else {
        throw new Error(
          `[kefiAdminClient] publish-status expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
        );
      }
      await delay(pollIntervalMs);
    }
    throw new Error(
      `[kefiAdminClient] publish job ${input.jobName} did not reach terminal in ${String(timeoutMs)}ms (last status: ${lastStatus?.status ?? 'unknown'})`,
    );
  }
}
