/**
 * Back-office (platform super-admin) client for the Kefi manual-subscription
 * override E2E (`kefi-backoffice-approval.spec.ts`).
 *
 * Wraps the three platform-admin endpoints the spec needs:
 *   - POST /api/v1/platform/tenants                          (create tenant)
 *   - PUT  /api/v1/platform/tenants/{id}/subscription        (manual set-subscription)
 *   - GET  /api/v1/platform/tenants                          (list, for re-fetch)
 *
 * The platform-admin bearer is reused from `KefiAdminClient.getBearer()` so
 * the secret handling (KEFI_PLATFORM_ADMIN_* + KEFI_BFF_CLIENT_SECRET) stays in
 * one place. The 403 negative case needs a VALID kefi-realm token that LACKS
 * the `kefi-platform-admin` role — `mintNonAdminBearer()` ROPC-mints one for
 * the seeded kefi `superUser` (realm role `superUser` only), distinguishing a
 * genuine 403 (authenticated, wrong role) from a 401 (no/invalid token).
 *
 * Why ROPC: this runs server-side from a Playwright spec (no browser/consent).
 * `bff-kefi-client` is confidential with `directAccessGrantsEnabled=true`;
 * mirrors `kefiAdminClient.ts`.
 */

import axios, { type AxiosInstance } from 'axios';

import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import { KefiAdminClient } from './kefiAdminClient.js';
import { requireSecret, type RawTokenResponse } from './kefiAdminClient.types.js';

const HTTP_TIMEOUT_MS = 30_000;

/** Platform-admin tenant projection — mirrors `Kefi.UseCases.PlatformAdmin.DTOs.TenantDto`. */
export interface KefiTenantDto {
  tenantId: string;
  name: string;
  slug: string;
  /** Lifecycle status (Pending/Active/Suspended/Archived) — NOT the subscription status. */
  status: string;
  ownerUserId: string | null;
  createdDate: string;
  subscriptionPlanCode: string;
  subscriptionStatus: string;
  subscriptionCurrentPeriodEndUtc: string | null;
}

/** Body of `PUT /platform/tenants/{id}/subscription` (camelCase wire shape). */
export interface SetSubscriptionBody {
  planCode: string;
  status: string;
  currentPeriodEndUtc: string | null;
}

/** A raw `{ status, data }` pair so the spec can assert non-2xx (400/403) responses. */
export interface RawResponse<T> {
  status: number;
  data: T;
}

/**
 * Thin wrapper over the Kefi platform-admin tenant + subscription endpoints.
 * Shares one `KefiAdminClient` for the admin bearer; mints its own non-admin
 * bearer on demand.
 */
export class KefiBackofficeClient {
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();
  private readonly admin: KefiAdminClient;

  constructor(admin?: KefiAdminClient) {
    this.admin = admin ?? new KefiAdminClient();
    this.http = axios.create({
      baseURL: this.urls.apiUrl,
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /** Create a platform tenant. Returns the 201 `TenantDto`; throws on any other status. */
  async createTenant(input: { name: string; slug: string }): Promise<KefiTenantDto> {
    const bearer = await this.admin.getBearer();
    const resp = await this.http.post<KefiTenantDto>(
      '/api/v1/platform/tenants',
      { name: input.name, slug: input.slug },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (resp.status !== 201) {
      throw new Error(
        `[kefiBackofficeClient] create-tenant expected 201, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data;
  }

  /**
   * PUT the manual subscription override as the platform admin. Returns the raw
   * `{ status, data }` so the caller can assert both the 200 happy path and the
   * 400 invalid-plan path without try/catch.
   */
  async setSubscription(
    tenantId: string,
    body: SetSubscriptionBody,
  ): Promise<RawResponse<KefiTenantDto>> {
    const bearer = await this.admin.getBearer();
    const resp = await this.http.put<KefiTenantDto>(
      `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/subscription`,
      body,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * PUT the subscription with an explicit bearer — used by the 403 negative
   * case to send a valid-but-non-admin token. Returns the raw status.
   */
  async setSubscriptionWithBearer(
    tenantId: string,
    body: SetSubscriptionBody,
    bearer: string,
  ): Promise<number> {
    const resp = await this.http.put(
      `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/subscription`,
      body,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return resp.status;
  }

  /** List every platform tenant (admin), then return the one matching `tenantId`, or null. */
  async getTenantById(tenantId: string): Promise<KefiTenantDto | null> {
    return this.findTenant((t) => t.tenantId === tenantId);
  }

  /**
   * List every platform tenant (admin), then return the first whose slug starts
   * with `prefix`, or null. Used by the freemium-gate spec to resolve a
   * canary tenant's id (it only knows its `e2c-{canaryId}-` slug prefix) so it
   * can grant Pro via PUT /platform/tenants/{id}/subscription.
   */
  async findTenantBySlugPrefix(prefix: string): Promise<KefiTenantDto | null> {
    return this.findTenant((t) => t.slug.startsWith(prefix));
  }

  /** Shared list-and-find over GET /platform/tenants. Throws on a non-200 list. */
  private async findTenant(
    predicate: (t: KefiTenantDto) => boolean,
  ): Promise<KefiTenantDto | null> {
    const bearer = await this.admin.getBearer();
    const resp = await this.http.get<{ tenants: KefiTenantDto[] }>('/api/v1/platform/tenants', {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (resp.status !== 200) {
      throw new Error(
        `[kefiBackofficeClient] list-tenants expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data.tenants.find(predicate) ?? null;
  }

  /**
   * ROPC-mint a kefi-realm bearer for the given user via the confidential
   * `bff-kefi-client` (direct grant). Used by the 403 case with an ephemeral
   * role-less kefi user — a token that authenticates (kefi issuer, so it clears
   * the product-realm wall) but carries neither `superUser` nor
   * `kefi-platform-admin`, so the endpoint's role filter rejects it with 403.
   */
  async mintUserBearer(input: { username: string; password: string }): Promise<string> {
    const clientSecret = requireSecret('KEFI_BFF_CLIENT_SECRET', undefined);
    const tokenUrl = `${this.urls.kcUrl}/realms/${this.urls.kcRealm}/protocol/openid-connect/token`;
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: this.urls.bffClientId,
      client_secret: clientSecret,
      username: input.username,
      password: input.password,
      scope: 'openid',
    });

    const resp = await axios.post<RawTokenResponse>(tokenUrl, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (resp.status >= 200 && resp.status < 300 && resp.data.access_token) {
      return resp.data.access_token;
    }
    throw new Error(
      `[kefiBackofficeClient] user ROPC mint failed for ${input.username} (${resp.status}): ${resp.data.error ?? ''} ${resp.data.error_description ?? ''}`,
    );
  }
}
