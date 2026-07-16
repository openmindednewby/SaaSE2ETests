/**
 * Crew-lifecycle client for the Kefi tenant-creation-to-crew-login E2E
 * (`kefi-crew-lifecycle.spec.ts`, task #267). Encodes STEP 5 of the ubb
 * provision flow: invite a crew member, then set their password + emailVerified
 * + clear required-actions via the KC admin API so ROPC sign-in works.
 *
 *   - POST /api/v1/admin/users (as tenant-owner)     — invite (creates KC user + role,
 *                                                       NO password / not set-up).
 *   - PUT  /admin/realms/kefi/users/{id}/reset-password (KC admin) — set the password.
 *   - PUT  /admin/realms/kefi/users/{id}              (KC admin) — emailVerified + enabled +
 *                                                       requiredActions:[].
 *   - ROPC via `bff-kefi-client`                      — verify the crew member can now sign in,
 *                                                       decoding the role + tenantId claim.
 *
 * The PRODUCT GAP (#267): invite alone does NOT yield a loginable account — the
 * KC-admin provisioning is REQUIRED. `tryLogin` returns `{ ok:false }` before
 * provisioning; `login` succeeds after. The spec asserts both.
 *
 * KC-admin token: prefers `KEFI_ADMIN_CLI_SECRET` client-credentials (the
 * flow-doc `kefi-admin-cli` path, works on prod), else master-admin ROPC
 * (`KEYCLOAK_MASTER_ADMIN_*`, staging). `kcCrewAdminAvailable()` lets the spec
 * skip gracefully where neither is configured.
 */

import axios, { type AxiosInstance } from 'axios';

import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { KefiAdminClient } from './kefiAdminClient.js';
import type { OwnerCreds } from './kefiProGatesClient.js';

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_OK = 200;
const ADMIN_CLI_CLIENT_ID = 'kefi-admin-cli';

/** One crew member to invite + provision. `role` is a KefiManagedRoles value. */
export interface CrewMember {
  email: string;
  firstName: string;
  lastName: string;
  /** organizer | ambassador | door-staff | media | dj (tenant-owner-assignable subset). */
  role: string;
}

/** The claims a spec asserts on a crew member's ROPC token. */
export interface DecodedCrewToken {
  /** realm_access.roles — must include the crew member's assigned role. */
  roles: string[];
  /** The `tenantId` claim — must equal the tenant's externalId. */
  tenantId: string | undefined;
}

interface KcTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/** True when SOME KC-admin credential is configured (client-creds OR master-admin). */
export function kcCrewAdminAvailable(): boolean {
  const clientCreds = Boolean(process.env.KEFI_ADMIN_CLI_SECRET);
  const masterAdmin = Boolean(
    process.env.KEYCLOAK_MASTER_ADMIN_USER && process.env.KEYCLOAK_MASTER_ADMIN_PASSWORD,
  );
  return clientCreds || masterAdmin;
}

/** Decode a JWT payload (base64url) → the role + tenantId claims. Never throws. */
function decodeToken(accessToken: string): DecodedCrewToken {
  const payload = accessToken.split('.')[1] ?? '';
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  const claims = JSON.parse(json) as {
    realm_access?: { roles?: string[] };
    tenantId?: string;
  };
  return {
    roles: claims.realm_access?.roles ?? [],
    tenantId: claims.tenantId,
  };
}

export class KefiCrewClient {
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();
  private kcAdminToken: string | null = null;

  constructor(private readonly admin: KefiAdminClient) {
    this.http = axios.create({
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /**
   * Invite a crew member as the tenant owner. Returns the new KC user id. The
   * invited account has a role + a tenantId attribute but NO password — it
   * cannot log in until {@link provisionLogin} runs (the #267 gap).
   */
  async invite(owner: OwnerCreds, member: CrewMember): Promise<string> {
    const bearer = await this.admin.getTenantOwnerBearer({
      email: owner.ownerEmail,
      password: owner.ownerPassword,
    });
    const resp = await this.http.post<{ userId?: string }>(
      `${this.urls.apiUrl}/api/v1/admin/users`,
      {
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        roles: [member.role],
      },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (resp.status !== HTTP_CREATED) {
      throw new Error(
        `[kefiCrewClient] invite ${member.email} (${member.role}) expected 201, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    const userId = resp.data.userId;
    if (!userId) {
      throw new Error(`[kefiCrewClient] invite ${member.email} returned no userId`);
    }
    return userId;
  }

  /**
   * The #267 operator step: set the crew member's password + emailVerified +
   * clear requiredActions via the KC admin API, so ROPC sign-in works.
   */
  async provisionLogin(userId: string, password: string): Promise<void> {
    const token = await this.getKcAdminToken();
    const base = `${this.urls.kcUrl}/admin/realms/${this.urls.kcRealm}/users/${userId}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const pwResp = await this.http.put(
      `${base}/reset-password`,
      { type: 'password', value: password, temporary: false },
      { headers },
    );
    if (pwResp.status !== HTTP_NO_CONTENT) {
      throw new Error(
        `[kefiCrewClient] reset-password ${userId} expected 204, got ${pwResp.status}: ${JSON.stringify(pwResp.data)}`,
      );
    }

    const userResp = await this.http.put(
      base,
      { emailVerified: true, enabled: true, requiredActions: [] },
      { headers },
    );
    if (userResp.status !== HTTP_NO_CONTENT) {
      throw new Error(
        `[kefiCrewClient] set-user ${userId} expected 204, got ${userResp.status}: ${JSON.stringify(userResp.data)}`,
      );
    }
  }

  /**
   * ROPC sign-in as a crew member; returns the decoded role + tenantId claims.
   * THROWS if sign-in fails — call {@link tryLogin} for the negative
   * (pre-provision) path.
   */
  async login(email: string, password: string): Promise<DecodedCrewToken> {
    const resp = await this.ropc(email, password);
    if (resp.status < HTTP_OK || resp.status >= 300 || !resp.data.access_token) {
      throw new Error(
        `[kefiCrewClient] crew ROPC failed for ${email} (${resp.status}): ${resp.data.error ?? ''} ${resp.data.error_description ?? ''}`,
      );
    }
    return decodeToken(resp.data.access_token);
  }

  /**
   * ROPC sign-in that does NOT throw — returns `{ ok:false }` on any non-2xx.
   * Used to assert the #267 gap: an invited-but-un-provisioned account fails.
   */
  async tryLogin(email: string, password: string): Promise<{ ok: boolean; status: number }> {
    const resp = await this.ropc(email, password);
    const ok = resp.status >= HTTP_OK && resp.status < 300 && Boolean(resp.data.access_token);
    return { ok, status: resp.status };
  }

  /** Best-effort KC delete of a crew user (teardown; the canary sweep keys off tenant slug). */
  async deleteUser(userId: string): Promise<void> {
    try {
      const token = await this.getKcAdminToken();
      const resp = await this.http.delete(
        `${this.urls.kcUrl}/admin/realms/${this.urls.kcRealm}/users/${userId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (resp.status !== HTTP_NO_CONTENT && resp.status !== HTTP_OK) {
        process.stderr.write(`[kefiCrewClient] WARN delete-user ${userId} returned ${resp.status}\n`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[kefiCrewClient] WARN delete-user ${userId} failed — ${msg}\n`);
    }
  }

  private async ropc(username: string, password: string): Promise<{ status: number; data: KcTokenResponse }> {
    const clientSecret = process.env.KEFI_BFF_CLIENT_SECRET ?? '';
    if (!clientSecret) throw new Error('[kefiCrewClient] KEFI_BFF_CLIENT_SECRET is unset');
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: this.urls.bffClientId,
      client_secret: clientSecret,
      username,
      password,
      scope: 'openid',
    });
    const resp = await this.http.post<KcTokenResponse>(
      `${this.urls.kcUrl}/realms/${this.urls.kcRealm}/protocol/openid-connect/token`,
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Mint (and cache) a KC-admin token — client-creds preferred, else master-admin ROPC. */
  private async getKcAdminToken(): Promise<string> {
    if (this.kcAdminToken) return this.kcAdminToken;
    const token = process.env.KEFI_ADMIN_CLI_SECRET
      ? await this.mintClientCredsToken()
      : await this.mintMasterAdminToken();
    this.kcAdminToken = token;
    return token;
  }

  private async mintClientCredsToken(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KEFI_ADMIN_CLI_CLIENT_ID ?? ADMIN_CLI_CLIENT_ID,
      client_secret: process.env.KEFI_ADMIN_CLI_SECRET ?? '',
    });
    const resp = await this.http.post<KcTokenResponse>(
      `${this.urls.kcUrl}/realms/${this.urls.kcRealm}/protocol/openid-connect/token`,
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    if (resp.status < HTTP_OK || resp.status >= 300 || !resp.data.access_token) {
      throw new Error(
        `[kefiCrewClient] kefi-admin-cli client-creds mint failed (${resp.status}): ${resp.data.error_description ?? resp.data.error ?? ''}`,
      );
    }
    return resp.data.access_token;
  }

  private async mintMasterAdminToken(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env.KEYCLOAK_MASTER_ADMIN_USER ?? '',
      password: process.env.KEYCLOAK_MASTER_ADMIN_PASSWORD ?? '',
    });
    const resp = await this.http.post<KcTokenResponse>(
      `${this.urls.kcUrl}/realms/master/protocol/openid-connect/token`,
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    if (resp.status < HTTP_OK || resp.status >= 300 || !resp.data.access_token) {
      throw new Error(
        `[kefiCrewClient] master-admin mint failed (${resp.status}): ${resp.data.error_description ?? resp.data.error ?? ''}`,
      );
    }
    return resp.data.access_token;
  }
}
