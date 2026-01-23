import axios, { type AxiosInstance } from 'axios';

import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { AuthHelper } from './auth-helper.js';

type TenantDto = {
  tenantId?: string;
  name?: string;
  tenantStatus?: number;
  logoUrl?: string | null;
  primaryColor?: string | null;
  primaryAuthMethod?: number;
  allowPhoneAuth?: boolean;
  allowEmailAuth?: boolean;
  otpCodeLength?: number;
  otpExpiryMinutes?: number;
  smsProvider?: string | null;
  requireSmsVerification?: boolean;
};

type ListTenantsResponse = { tenants?: TenantDto[] };

type CreateTenantResponse = { tenantId?: string };

type UserListItem = { id?: string; username?: string; tenantId?: string | null; enabled?: boolean; roles?: string[] };
type ListUsersResponse = { users?: UserListItem[] };

type CreateUserResponse = { userId?: string; success?: boolean; errorMessage?: string };

function normalizeIdentityApiBase(identityApiUrl: string): string {
  // Ensure trailing slash so relative URLs resolve under /api/ correctly.
  // axios treats baseURL without trailing slash like a "file".
  if (identityApiUrl.endsWith('/api/')) return identityApiUrl;
  if (identityApiUrl.endsWith('/api')) return `${identityApiUrl}/`;
  return `${identityApiUrl}/api/`;
}

export function createIdentityAdminClient(identityApiUrl: string, accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: normalizeIdentityApiBase(identityApiUrl),
    timeout: 30000,
    // Important: do NOT set `Content-Type` globally. Some IdentityService GET/DELETE endpoints
    // return 400 when Content-Type is set with an empty body.
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function loginSuperUser(identityApiUrl: string, username: string, password: string): Promise<string> {
  const auth = new AuthHelper(identityApiUrl);
  await auth.loginViaAPI(username, password);
  const accessToken = auth.getAccessToken();
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Failed to acquire access token');
  }
  return accessToken;
}

export async function ensureTenantsAndUsersExist(identityApiUrl: string, username: string, password: string): Promise<{
  tenants: string[];
  users: string[];
}> {
  const accessToken = await loginSuperUser(identityApiUrl, username, password);
  const client = createIdentityAdminClient(identityApiUrl, accessToken);

  const listTenants = async (): Promise<TenantDto[]> => {
    const resp = await client.get('tenants');
    const data = resp.data as ListTenantsResponse;
    return Array.isArray(data.tenants) ? data.tenants : [];
  };

  const tenants = await listTenants();
  const tenantByName = new Map<string, TenantDto>();
  for (const t of tenants) {
    if (typeof t.name === 'string' && t.name.length > 0) tenantByName.set(t.name.toLowerCase(), t);
  }

  const desiredTenants = Object.values(TEST_TENANTS);
  for (const name of desiredTenants) {
    const existing = tenantByName.get(name.toLowerCase());
    if (existing?.tenantId) continue;
    const createResp = await client.post('tenants', { name, tenantStatus: 1 });
    const created = createResp.data as CreateTenantResponse;
    const id = created.tenantId;
    tenantByName.set(name.toLowerCase(), { tenantId: id, name, tenantStatus: 1 });
  }

  // Refresh tenants after creates to capture server-generated IDs and ensure status.
  const refreshedTenants = await listTenants();
  const tenantIdByName = new Map<string, string>();
  for (const t of refreshedTenants) {
    if (typeof t.name === 'string' && t.name.length > 0 && typeof t.tenantId === 'string' && t.tenantId.length > 0) {
      tenantIdByName.set(t.name.toLowerCase(), t.tenantId);
    }
  }

  // Ensure tenants are enabled (some environments may create them disabled by default).
  await Promise.all(
    refreshedTenants.map(async (t) => {
      if (typeof t.tenantId !== 'string' || t.tenantId.length === 0) return;
      if (typeof t.name !== 'string' || t.name.length === 0) return;
      if (desiredTenants.map((x) => x.toLowerCase()).includes(t.name.toLowerCase()) && t.tenantStatus !== 1) {
        // Fetch full tenant details then update status to enabled.
        const full = (await client.get(`tenants/${t.tenantId}`)).data as TenantDto;
        await client.put('tenants', {
          tenantId: t.tenantId,
          name: full.name ?? t.name,
          tenantStatus: 1,
          logoUrl: full.logoUrl ?? null,
          primaryColor: full.primaryColor ?? null,
          primaryAuthMethod: full.primaryAuthMethod ?? 0,
          allowPhoneAuth: full.allowPhoneAuth ?? false,
          allowEmailAuth: full.allowEmailAuth ?? false,
          otpCodeLength: full.otpCodeLength ?? 6,
          otpExpiryMinutes: full.otpExpiryMinutes ?? 5,
          smsProvider: full.smsProvider ?? null,
          requireSmsVerification: full.requireSmsVerification ?? true,
        });
      }
    })
  );

  const listAllUsers = async (): Promise<UserListItem[]> => {
    const resp = await client.get('users');
    const data = resp.data as ListUsersResponse;
    return Array.isArray(data.users) ? data.users : [];
  };

  const allUsers = await listAllUsers();
  const userByUsername = new Map<string, UserListItem>();
  for (const u of allUsers) {
    if (typeof u.username === 'string' && u.username.length > 0) userByUsername.set(u.username.toLowerCase(), u);
  }

  const deleteUserById = async (userId: string, usernameToLog: string): Promise<void> => {
    try {
      await client.delete(`users/${userId}`);
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const details = status ? `status ${status}` : (e?.message ?? String(e));
      const rawBody = typeof data === 'string' ? data : JSON.stringify(data ?? '');
      const bodyPreview = typeof rawBody === 'string' && rawBody.length > 0 ? rawBody.slice(0, 300) : '';
      throw new Error(`Failed to delete user "${usernameToLog}" (userId=${userId}): ${details}${bodyPreview ? `: ${bodyPreview}` : ''}`);
    }
  };

  const createUser = async (userData: (typeof TEST_USERS)[keyof typeof TEST_USERS], tenantId: string): Promise<void> => {
    try {
      const resp = await client.post('users', {
        username: userData.username,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        password: userData.password,
        enabled: true,
        tenantId,
        roles: userData.roles,
      });
      const data = resp.data as CreateUserResponse;
      if (data.success === false) {
        throw new Error(data.errorMessage ?? 'Unknown error');
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const details = status ? `status ${status}` : (e?.message ?? String(e));
      const rawBody = typeof data === 'string' ? data : JSON.stringify(data ?? '');
      const bodyPreview = typeof rawBody === 'string' && rawBody.length > 0 ? rawBody.slice(0, 300) : '';
      throw new Error(`Failed to create user "${userData.username}": ${details}${bodyPreview ? `: ${bodyPreview}` : ''}`);
    }
  };

  const ensureUser = async (userData: (typeof TEST_USERS)[keyof typeof TEST_USERS]): Promise<void> => {
    const tenantId = tenantIdByName.get(userData.tenantName.toLowerCase());
    if (!tenantId) throw new Error(`Missing tenantId for tenant "${userData.tenantName}"`);

    const existing = userByUsername.get(userData.username.toLowerCase());
    if (existing?.id) {
      const existingTenantId = typeof existing.tenantId === 'string' ? existing.tenantId : null;
      const roles = Array.isArray(existing.roles) ? existing.roles : [];
      const enabled = typeof existing.enabled === 'boolean' ? existing.enabled : true;
      const expectedRoles = userData.roles.map((r) => r.toLowerCase()).sort().join(',');
      const actualRoles = roles.map((r) => String(r).toLowerCase()).sort().join(',');

      const needsRecreate =
        existingTenantId !== tenantId ||
        actualRoles !== expectedRoles ||
        enabled !== true;

      if (!needsRecreate) return;

      await deleteUserById(existing.id, userData.username);
      userByUsername.delete(userData.username.toLowerCase());
    }

    // Create (or re-create) user. Retry briefly in case deletion is eventually consistent.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await createUser(userData, tenantId);
        return;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 200 * attempt));
        const latestUsers = await listAllUsers().catch(() => []);
        for (const u of latestUsers) {
          if (typeof u.username === 'string' && u.username.length > 0) userByUsername.set(u.username.toLowerCase(), u);
        }
        if (userByUsername.has(userData.username.toLowerCase())) return;
      }
    }
  };

  // Create missing users concurrently (small batch; avoid hammering identity provider).
  const usersToEnsure = Object.values(TEST_USERS);
  const batchSize = 2;
  for (let i = 0; i < usersToEnsure.length; i += batchSize) {
    await Promise.all(usersToEnsure.slice(i, i + batchSize).map((u) => ensureUser(u)));
  }

  return {
    tenants: desiredTenants,
    users: Object.values(TEST_USERS).map((u) => u.username),
  };
}
