/**
 * Self-serve signup teardown (P1-08 — Katalogos self-serve signup journey).
 *
 * WHY a bespoke teardown instead of the canary sweep: the PUBLIC register
 * endpoint (`POST /auth/register`) rejects the reserved canary prefix
 * `e2ec-<runId8>-` by design (TenantService `MustNotMatchReservedPrefix`,
 * `^e2ec-[0-9a-f]{8}-`, anti-abuse — real users can't squat the canary
 * namespace). So a real signup can NEVER be canary-named, and the global
 * `canary-cleanup` sweep can never reclaim it. The journey therefore names its
 * tenant/user `p108…` and this helper deletes it explicitly, so the journey can
 * run nightly without leaking orphan tenants/users.
 *
 * Auth: the canary superUser token minted once by `global-setup.canary.ts`
 * (`getCanarySuperUserToken()`). That identity is an onlinemenu-realm
 * Administrator/superUser — the same token `identity-admin.ts` already uses to
 * CRUD tenants + users on prod — so it satisfies `DeleteTenant`'s
 * `Roles(Administrator)` and `DeleteUser`'s. Callers may also pass an explicit
 * token (used by the standalone cleanup/verify script).
 *
 * Delete order: Keycloak user(s) FIRST (`DELETE /users/{id}`, `X-Realm:
 * onlinemenu`), THEN the tenant row (`DELETE /tenants/{tenantId}`).
 * `DeleteTenant` only removes the IdentityDb row; it does NOT cascade to
 * Keycloak, hence the explicit user delete.
 *
 * Safe-by-default + idempotent: missing token / URL → no-op; unknown
 * tenant/user → no-op; 404s are treated as success; this NEVER throws
 * (teardown must never mask a test's pass/fail). Returns a summary for logging
 * and assertions.
 */
import axios, { type AxiosInstance } from 'axios';

import { getCanarySuperUserToken } from './canary-prefix.js';
import { sharedHttpsAgent } from './http-agent.js';

/** Realm the Katalogos self-serve tenants + users live in. */
const REALM = process.env.IDENTITY_REALM ?? 'onlinemenu';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const HTTP_NOT_FOUND = 404;

interface TenantDto {
  tenantId?: string;
  name?: string;
}
interface UserDto {
  id?: string;
  username?: string;
  tenantId?: string | null;
}

/** What to delete. Provide the tenantName + username used at signup (the robust
 * path — looked up server-side), and/or the ids captured from the register
 * network response (the fast path — skips the lookup). */
export interface SignupTeardownTarget {
  /** Exact tenant display name submitted to `/register` (e.g. `"p108abcd1 Bistro"`). */
  tenantName?: string;
  /** Keycloak username submitted to `/register` (e.g. `"p108abcd1"`). */
  username?: string;
  /** Optional tenantId captured from the register response — skips the tenant lookup. */
  tenantId?: string;
  /** Optional userId (sub) captured from the register response — added to the delete set. */
  userId?: string;
}

export interface SignupTeardownResult {
  /** True once auth + URL were present and a delete pass ran. */
  attempted: boolean;
  /** The tenantId that was resolved / supplied, if any. */
  tenantId?: string;
  /** True when the tenant row was deleted (or was already gone). */
  deletedTenant: boolean;
  /** Keycloak userIds successfully deleted (or already gone). */
  deletedUserIds: string[];
  /** Human-readable diagnostics for the log line. */
  notes: string[];
}

function identityApiBase(): string | undefined {
  const raw = process.env.IDENTITY_API_URL;
  if (!raw || raw.length === 0) return undefined;
  if (raw.endsWith('/api/v1/')) return raw;
  if (raw.endsWith('/api/v1')) return `${raw}/`;
  if (raw.endsWith('/')) return `${raw}api/v1/`;
  return `${raw}/api/v1/`;
}

function adminClient(base: string, token: string): AxiosInstance {
  return axios.create({
    baseURL: base,
    timeout: 30_000,
    headers: {
      Authorization: `Bearer ${token}`,
      // X-Realm scopes the Keycloak user operations to the onlinemenu realm.
      // DeleteTenant is realm-agnostic (one IdentityDb row) but the header is
      // harmless there.
      'X-Realm': REALM,
    },
    httpsAgent: sharedHttpsAgent,
    // Handle every status inline — a teardown must never throw.
    validateStatus: () => true,
  });
}

function isOk(status: number): boolean {
  return status >= HTTP_OK_MIN && status < HTTP_OK_MAX;
}

async function resolveTenantId(
  client: AxiosInstance,
  target: SignupTeardownTarget,
  notes: string[],
): Promise<string | undefined> {
  if (target.tenantId) return target.tenantId;
  if (!target.tenantName) return undefined;
  const resp = await client.get('tenants');
  if (!isOk(resp.status)) {
    notes.push(`GET tenants -> ${resp.status}`);
    return undefined;
  }
  const tenants: TenantDto[] = Array.isArray(resp.data?.tenants) ? resp.data.tenants : [];
  const wanted = target.tenantName.toLowerCase();
  const match = tenants.find((t) => typeof t.name === 'string' && t.name.toLowerCase() === wanted);
  if (!match?.tenantId) {
    notes.push(`tenant "${target.tenantName}" not found among ${tenants.length} tenants`);
    return undefined;
  }
  return match.tenantId;
}

async function collectUserIds(
  client: AxiosInstance,
  target: SignupTeardownTarget,
  tenantId: string | undefined,
  notes: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (target.userId) ids.add(target.userId);
  // Scope to the tenant when known (superUser sees all users otherwise).
  const resp = tenantId
    ? await client.get('users', { params: { tenantId } })
    : await client.get('users');
  if (!isOk(resp.status)) {
    notes.push(`GET users -> ${resp.status}`);
    return ids;
  }
  const users: UserDto[] = Array.isArray(resp.data?.users) ? resp.data.users : [];
  const wantedUser = target.username?.toLowerCase();
  for (const u of users) {
    const matchesTenant = Boolean(tenantId) && u.tenantId === tenantId;
    const matchesUsername =
      wantedUser !== undefined && typeof u.username === 'string' && u.username.toLowerCase() === wantedUser;
    if ((matchesTenant || matchesUsername) && typeof u.id === 'string' && u.id.length > 0) {
      ids.add(u.id);
    }
  }
  return ids;
}

async function deleteUsers(
  client: AxiosInstance,
  userIds: Set<string>,
  notes: string[],
): Promise<string[]> {
  const deleted: string[] = [];
  for (const id of userIds) {
    const del = await client.delete(`users/${id}`);
    if (isOk(del.status)) {
      deleted.push(id);
    } else if (del.status === HTTP_NOT_FOUND) {
      deleted.push(id);
      notes.push(`user ${id} already gone`);
    } else {
      notes.push(`DELETE users/${id} -> ${del.status}`);
    }
  }
  return deleted;
}

async function deleteTenant(
  client: AxiosInstance,
  tenantId: string,
  notes: string[],
): Promise<boolean> {
  const del = await client.delete(`tenants/${tenantId}`);
  if (isOk(del.status)) return true;
  if (del.status === HTTP_NOT_FOUND) {
    notes.push('tenant already gone');
    return true;
  }
  notes.push(`DELETE tenants/${tenantId} -> ${del.status}`);
  return false;
}

/**
 * Delete a self-serve tenant + its Keycloak user(s). Never throws.
 *
 * @param target   what to delete (tenantName/username and/or ids)
 * @param options  optional explicit bearer token (defaults to the canary
 *                 superUser token from global-setup)
 */
export async function deleteSelfServeSignup(
  target: SignupTeardownTarget,
  options: { token?: string } = {},
): Promise<SignupTeardownResult> {
  const notes: string[] = [];
  const result: SignupTeardownResult = {
    attempted: false,
    deletedTenant: false,
    deletedUserIds: [],
    notes,
  };

  const token = options.token ?? getCanarySuperUserToken();
  if (!token) {
    notes.push('no superUser token (canary token unset) — skipped');
    return result;
  }
  const base = identityApiBase();
  if (!base) {
    notes.push('IDENTITY_API_URL unset — skipped');
    return result;
  }

  result.attempted = true;
  const client = adminClient(base, token);

  try {
    const tenantId = await resolveTenantId(client, target, notes);
    result.tenantId = tenantId;

    const userIds = await collectUserIds(client, target, tenantId, notes);
    result.deletedUserIds = await deleteUsers(client, userIds, notes);

    if (tenantId) {
      result.deletedTenant = await deleteTenant(client, tenantId, notes);
    } else {
      notes.push('no tenantId resolved — tenant delete skipped');
    }
  } catch (e) {
    // Defensive: any unexpected error is logged, never rethrown.
    notes.push(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/**
 * Read-only check used to PROVE cleanup left nothing behind. Returns whether a
 * tenant with the given name and/or a user with the given username still
 * exist. Never throws — on any transport error it reports `false` for both and
 * appends a note (so a network blip doesn't masquerade as "orphan present").
 */
export async function selfServeSignupExists(
  target: SignupTeardownTarget,
  options: { token?: string } = {},
): Promise<{ tenantFound: boolean; userFound: boolean; notes: string[] }> {
  const notes: string[] = [];
  const token = options.token ?? getCanarySuperUserToken();
  const base = identityApiBase();
  if (!token || !base) {
    notes.push('no token/URL — cannot check');
    return { tenantFound: false, userFound: false, notes };
  }
  const client = adminClient(base, token);
  let tenantFound = false;
  let userFound = false;
  try {
    if (target.tenantName) {
      const resp = await client.get('tenants');
      if (isOk(resp.status)) {
        const tenants: TenantDto[] = Array.isArray(resp.data?.tenants) ? resp.data.tenants : [];
        const wanted = target.tenantName.toLowerCase();
        tenantFound = tenants.some((t) => typeof t.name === 'string' && t.name.toLowerCase() === wanted);
      } else {
        notes.push(`GET tenants -> ${resp.status}`);
      }
    }
    if (target.username) {
      const resp = await client.get('users');
      if (isOk(resp.status)) {
        const users: UserDto[] = Array.isArray(resp.data?.users) ? resp.data.users : [];
        const wanted = target.username.toLowerCase();
        userFound = users.some((u) => typeof u.username === 'string' && u.username.toLowerCase() === wanted);
      } else {
        notes.push(`GET users -> ${resp.status}`);
      }
    }
  } catch (e) {
    notes.push(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { tenantFound, userFound, notes };
}
