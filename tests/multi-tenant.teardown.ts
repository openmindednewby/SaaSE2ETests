import type { FullConfig } from '@playwright/test';
import axios, { type AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';

import { AuthHelper } from '../helpers/auth-helper.js';

/**
 * Multi-tenant test teardown
 * 
 * Cleans up:
 * - All e2e-* users
 * - All e2e-* tenants
 */

const setupStateFile = path.resolve(__dirname, '../playwright/.auth/multi-tenant-setup.json');

type SetupState = { users?: string[]; tenants?: string[] };

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function runBatches<T>(items: T[], batchSize: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (const batch of chunk(items, batchSize)) {
    await Promise.allSettled(batch.map((i) => fn(i)));
  }
}

async function globalTeardown(_config: FullConfig) {
  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;
  const identityApiUrl = process.env.IDENTITY_API_URL || 'http://localhost:5002';

  // Skip cleanup if no credentials
  if (!username || !password) {
    console.log('⏭️ Skipping cleanup: no credentials configured');
    return;
  }

  // Check if setup was run
  if (!fs.existsSync(setupStateFile)) {
    console.log('⏭️ Skipping cleanup: no setup state found');
    return;
  }

  let setupState;
  try {
    setupState = JSON.parse(fs.readFileSync(setupStateFile, 'utf-8')) as SetupState;
  } catch {
    console.log('⏭️ Skipping cleanup: invalid setup state file');
    return;
  }

  console.log('🧹 Starting multi-tenant cleanup...');

  try {
    console.log('✅ Logged in as super user');

    // Use IdentityService API directly (much faster than UI-driven cleanup).
    const authHelper = new AuthHelper(identityApiUrl);
    await authHelper.loginViaAPI(username, password);

    // Ensure trailing slash so relative request URLs resolve under /api/ (axios URL resolution treats
    // baseURL without trailing slash like a "file").
    const apiBase = identityApiUrl.endsWith('/api') ? `${identityApiUrl}/` : `${identityApiUrl}/api/`;
    const accessToken = authHelper.getAccessToken();
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('Failed to acquire access token for teardown');
    }

    // Important: do NOT set `Content-Type: application/json` globally here.
    // IdentityService GET/DELETE endpoints return 400 when Content-Type is set with an empty body.
    const client: AxiosInstance = axios.create({
      baseURL: apiBase,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const usersToDelete = Array.isArray(setupState.users) ? setupState.users : [];
    const tenantsToDelete = Array.isArray(setupState.tenants) ? setupState.tenants : [];

    const _toLower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

    // List tenants (needed both for tenant deletion and to scope user listing by tenantId).
    let allTenants: Array<{ tenantId?: string; name?: string }> = [];
    try {
      const tenantsResp = (await client.get('tenants')).data as { tenants?: Array<{ tenantId?: string; name?: string }> };
      allTenants = Array.isArray(tenantsResp.tenants) ? tenantsResp.tenants : [];
    } catch (e: any) {
      console.warn(`⚠️ Failed to list tenants for cleanup: ${e?.message ?? String(e)}`);
    }

    // Delete users first (tenants may depend on user cleanup).
    // IdentityService user listing is tenant-scoped; query per test-tenant.
    const tenantIdByName = new Map<string, string>();
    for (const t of allTenants) {
      if (typeof t.tenantId === 'string' && t.tenantId.length > 0 && typeof t.name === 'string' && t.name.length > 0) {
        tenantIdByName.set(t.name.toLowerCase(), t.tenantId);
      }
    }

    const userIdByUsername = new Map<string, string>();
    for (const tenantName of tenantsToDelete) {
      const tenantId = tenantIdByName.get(tenantName.toLowerCase());
      if (typeof tenantId !== 'string' || tenantId.length === 0) continue;

      let users: Array<{ id?: string; username?: string }> = [];
      try {
        const usersResp = (await client.get('users', { params: { tenantId } })).data as {
          users?: Array<{ id?: string; username?: string }>;
        };
        users = Array.isArray(usersResp.users) ? usersResp.users : [];
      } catch (e: any) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        const details = status ? `status ${status}` : (e?.message ?? String(e));
        const rawBody = typeof data === 'string' ? data : JSON.stringify(data ?? '');
        const bodyPreview = typeof rawBody === 'string' && rawBody.length > 0 ? rawBody.slice(0, 200) : '';
        console.warn(
          `⚠️ Failed to list users for tenant "${tenantName}" (tenantId=${tenantId}): ${details}${bodyPreview ? `: ${bodyPreview}` : ''}`
        );
      }
      for (const u of users) {
        if (typeof u.id === 'string' && u.id.length > 0 && typeof u.username === 'string' && u.username.length > 0) {
          userIdByUsername.set(u.username.toLowerCase(), u.id);
        }
      }
    }

    await runBatches(usersToDelete, 4, async (u) => {
      const id = userIdByUsername.get(u.toLowerCase());
      if (typeof id !== 'string' || id.length === 0) return;
      console.log(`🗑️ Deleting user: ${u}`);
      try {
        await client.delete(`users/${id}`);
        console.log(`✅ Deleted user: ${u}`);
      } catch (e: any) {
        console.warn(`⚠️ Failed to delete user "${u}": ${e?.message ?? String(e)}`);
      }
    });

    // Delete tenants
    await runBatches(tenantsToDelete, 3, async (t) => {
      const match = allTenants.find((x) => x.name === t);
      const id = match?.tenantId;
      if (typeof id !== 'string' || id.length === 0) return;
      console.log(`🗑️ Deleting tenant: ${t}`);
      try {
        await client.delete(`tenants/${id}`);
        console.log(`✅ Deleted tenant: ${t}`);
      } catch (e: any) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        const details = status ? `status ${status}` : (e?.message ?? String(e));
        const rawBody = typeof data === 'string' ? data : JSON.stringify(data ?? '');
        const bodyPreview = typeof rawBody === 'string' && rawBody.length > 0 ? rawBody.slice(0, 200) : '';
        console.warn(
          `⚠️ Failed to delete tenant "${t}" (tenantId=${id}): ${details}${bodyPreview ? `: ${bodyPreview}` : ''}`
        );
      }
    });

    // Remove setup state file
    fs.unlinkSync(setupStateFile);
    console.log('✅ Multi-tenant cleanup complete!');

  } catch (error: any) {
    console.error('❌ Cleanup failed:', error.message);
  }
}

export default globalTeardown;
