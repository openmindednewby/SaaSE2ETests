/**
 * Minimal Keycloak master-admin helper for the Kefi back-office E2E.
 *
 * The kefi realm's only seeded users (`superUser`, `otp-bot`) both carry the
 * platform-wide `superUser` role, which the kefi-api's SuperUserAuthorizationHandler
 * places ABOVE the role wall — so neither can stand in for an "authenticated but
 * NON-admin" identity in the 403 negative case. This helper mints an ephemeral
 * kefi-realm user with NO privileged role via the KC Admin REST API, so the
 * spec can prove the role wall (403) rather than just the auth wall (401).
 *
 * It is only usable where the master-admin credentials are present — staging's
 * E2E secrets carry them; prod deliberately does NOT (you do not hand prod
 * master-admin to the E2E runner). `masterAdminAvailable()` lets the spec
 * degrade gracefully when they're absent.
 */

import axios from 'axios';

import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { RawTokenResponse } from './kefiAdminClient.types.js';

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

/** True when the KC master-admin credentials are configured for this target. */
export function masterAdminAvailable(): boolean {
  return Boolean(
    process.env.KEYCLOAK_MASTER_ADMIN_USER && process.env.KEYCLOAK_MASTER_ADMIN_PASSWORD,
  );
}

/** Mint a master-realm admin token via `admin-cli` ROPC. */
async function mintMasterAdminToken(): Promise<string> {
  const { kcUrl } = getKefiUrls();
  const username = process.env.KEYCLOAK_MASTER_ADMIN_USER ?? '';
  const password = process.env.KEYCLOAK_MASTER_ADMIN_PASSWORD ?? '';
  const form = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username,
    password,
  });
  const resp = await axios.post<RawTokenResponse>(
    `${kcUrl}/realms/master/protocol/openid-connect/token`,
    form.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    },
  );
  if (resp.status >= 200 && resp.status < 300 && resp.data.access_token) {
    return resp.data.access_token;
  }
  throw new Error(
    `[kefiKeycloakAdmin] master admin token mint failed (${resp.status}): ${resp.data.error_description ?? resp.data.error ?? ''}`,
  );
}

/** An ephemeral kefi-realm user created for the 403 negative case. */
export interface EphemeralKefiUser {
  userId: string;
  username: string;
  password: string;
}

/**
 * Create an ephemeral, role-less user in the kefi realm. The username is
 * canary-prefixed so it is recognisable as E2E residue; the caller MUST
 * `deleteEphemeralUser` it in teardown (no tenant links it, so the kefi
 * canary-cleanup sweep won't catch it).
 */
export async function createEphemeralNonAdminUser(input: {
  username: string;
  password: string;
}): Promise<EphemeralKefiUser> {
  const { kcUrl, kcRealm } = getKefiUrls();
  const adminToken = await mintMasterAdminToken();
  const resp = await axios.post(
    `${kcUrl}/admin/realms/${kcRealm}/users`,
    {
      username: input.username,
      // A fully-set-up user — KC rejects ROPC ("Account is not fully set up")
      // when profile fields are missing or required actions are pending, so
      // stamp them all and clear required actions explicitly.
      enabled: true,
      email: `${input.username}@e2e.kefi.test`,
      emailVerified: true,
      firstName: 'E2E',
      lastName: 'NonAdmin',
      requiredActions: [],
      credentials: [{ type: 'password', value: input.password, temporary: false }],
    },
    {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    },
  );
  if (resp.status !== HTTP_CREATED) {
    throw new Error(
      `[kefiKeycloakAdmin] create-user expected 201, got ${resp.status}: ${JSON.stringify(resp.data)}`,
    );
  }
  const location = (resp.headers.location ?? resp.headers.Location) as string | undefined;
  const userId = location?.split('/').pop() ?? '';
  if (!userId) {
    throw new Error('[kefiKeycloakAdmin] create-user returned no Location/user-id');
  }
  return { userId, username: input.username, password: input.password };
}

/** The kefi realm role every tenant owner holds — mirrors `KefiRoles.TenantOwner`. */
const TENANT_OWNER_ROLE = 'tenant-owner';

/** The three KC Admin API params threaded through the owner-provisioning calls. */
interface KcAdminCtx {
  kcUrl: string;
  kcRealm: string;
  adminToken: string;
}

/**
 * Create a fully-set-up kefi-realm TENANT-OWNER user via the KC Admin API and
 * link it to an existing tenant — the fast, no-wizard owner the API-tier
 * freemium-gate spec ROPCs as.
 *
 * It mirrors the product's `BuildCreatePublicSignupUserRequest` (username =
 * email, non-empty firstName/lastName for VERIFY_PROFILE, the `tenantId`
 * attribute that drives the token's tenant claim) and assigns the
 * `tenant-owner` realm role that every gated `/admin` endpoint requires — but
 * with `emailVerified: true` + no required actions so ROPC sign-in works
 * immediately (the real signup leaves VERIFY_EMAIL to the app layer).
 *
 * Master-admin-only (staging carries the creds; prod does not). The caller MUST
 * `deleteEphemeralUser` it in teardown — the kefi canary sweep keys off the
 * tenant slug, and this user is provisioned independently of that flow.
 */
export async function createTenantOwnerUser(input: {
  email: string;
  password: string;
  tenantId: string;
}): Promise<EphemeralKefiUser> {
  const { kcUrl, kcRealm } = getKefiUrls();
  const adminToken = await mintMasterAdminToken();
  const ctx: KcAdminCtx = { kcUrl, kcRealm, adminToken };
  const userId = await createOwnerUserRecord(ctx, input);
  await assignRealmRole(ctx, userId, TENANT_OWNER_ROLE);
  return { userId, username: input.email, password: input.password };
}

/** POST the owner user record; returns its KC id (parsed from the Location header). */
async function createOwnerUserRecord(
  ctx: KcAdminCtx,
  input: { email: string; password: string; tenantId: string },
): Promise<string> {
  const resp = await axios.post(
    `${ctx.kcUrl}/admin/realms/${ctx.kcRealm}/users`,
    {
      username: input.email,
      email: input.email,
      enabled: true,
      emailVerified: true,
      firstName: 'E2E',
      lastName: 'Owner',
      requiredActions: [],
      attributes: { tenantId: [input.tenantId] },
      credentials: [{ type: 'password', value: input.password, temporary: false }],
    },
    {
      headers: { Authorization: `Bearer ${ctx.adminToken}`, 'Content-Type': 'application/json' },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    },
  );
  if (resp.status !== HTTP_CREATED) {
    throw new Error(
      `[kefiKeycloakAdmin] create-owner-user expected 201, got ${resp.status}: ${JSON.stringify(resp.data)}`,
    );
  }
  const location = (resp.headers.location ?? resp.headers.Location) as string | undefined;
  const userId = location?.split('/').pop() ?? '';
  if (!userId) {
    throw new Error('[kefiKeycloakAdmin] create-owner-user returned no Location/user-id');
  }
  return userId;
}

/** Look the realm role up by name, then add it to the user's realm role-mappings. */
async function assignRealmRole(ctx: KcAdminCtx, userId: string, roleName: string): Promise<void> {
  const roleResp = await axios.get(
    `${ctx.kcUrl}/admin/realms/${ctx.kcRealm}/roles/${encodeURIComponent(roleName)}`,
    {
      headers: { Authorization: `Bearer ${ctx.adminToken}` },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    },
  );
  if (roleResp.status !== HTTP_OK) {
    throw new Error(
      `[kefiKeycloakAdmin] get-role '${roleName}' expected 200, got ${roleResp.status}: ${JSON.stringify(roleResp.data)}`,
    );
  }
  const role = roleResp.data as { id?: string; name?: string };
  if (!role.id || !role.name) {
    throw new Error(`[kefiKeycloakAdmin] role '${roleName}' response missing id/name`);
  }
  const mapResp = await axios.post(
    `${ctx.kcUrl}/admin/realms/${ctx.kcRealm}/users/${userId}/role-mappings/realm`,
    [{ id: role.id, name: role.name }],
    {
      headers: { Authorization: `Bearer ${ctx.adminToken}`, 'Content-Type': 'application/json' },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    },
  );
  if (mapResp.status !== HTTP_NO_CONTENT && mapResp.status !== HTTP_OK) {
    throw new Error(
      `[kefiKeycloakAdmin] assign-role '${roleName}' expected 204, got ${mapResp.status}: ${JSON.stringify(mapResp.data)}`,
    );
  }
}

/** Delete an ephemeral user by id. Never throws — teardown must not mask failures. */
export async function deleteEphemeralUser(userId: string): Promise<void> {
  try {
    const { kcUrl, kcRealm } = getKefiUrls();
    const adminToken = await mintMasterAdminToken();
    const resp = await axios.delete(`${kcUrl}/admin/realms/${kcRealm}/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      httpsAgent: sharedHttpsAgent,
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (resp.status !== HTTP_NO_CONTENT && resp.status !== HTTP_OK) {
      process.stderr.write(
        `[kefiKeycloakAdmin] WARN delete-user ${userId} returned ${resp.status}\n`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[kefiKeycloakAdmin] WARN delete-user ${userId} failed — ${msg}\n`);
  }
}
