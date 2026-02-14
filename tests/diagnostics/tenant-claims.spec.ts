import { expect, test } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper.js';
import { TEST_USERS, getProjectUsers } from '../../fixtures/test-data.js';

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT: expected at least 2 parts');
  return JSON.parse(base64UrlDecode(parts[1]));
}

function getTenantIdClaim(payload: Record<string, unknown>): string | undefined {
  const candidates = ['tenantId', 'tenant_id', 'tid'];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

test.describe('Diagnostics: tenant claims', () => {
  // eslint-disable-next-line no-empty-pattern
  test('prints decoded tenantId for the project admin', async ({}, testInfo) => {
    const { admin } = getProjectUsers(testInfo.project.name);
    const auth = new AuthHelper();
    const tokens = await auth.loginViaAPI(admin.username, admin.password);
    expect(tokens.accessToken).toBeTruthy();

    const payload = decodeJwtPayload(tokens.accessToken!);
    const tenantId = getTenantIdClaim(payload);

    expect(tenantId, 'Expected a tenantId claim in access token').toBeTruthy();
  });

  // eslint-disable-next-line no-empty-pattern
  test('tenantId differs across TenantA/B/C admins', async ({}, testInfo) => {
    if (!testInfo.project.name.includes('diagnostics-chromium')) test.skip(true, 'Run once (chromium) only');

    const auth = new AuthHelper();

    const a = await auth.loginViaAPI(TEST_USERS.TENANT_A_ADMIN.username, TEST_USERS.TENANT_A_ADMIN.password);
    const aTenantId = getTenantIdClaim(decodeJwtPayload(a.accessToken!));

    const b = await auth.loginViaAPI(TEST_USERS.TENANT_B_ADMIN.username, TEST_USERS.TENANT_B_ADMIN.password);
    const bTenantId = getTenantIdClaim(decodeJwtPayload(b.accessToken!));

    const c = await auth.loginViaAPI(TEST_USERS.TENANT_C_ADMIN.username, TEST_USERS.TENANT_C_ADMIN.password);
    const cTenantId = getTenantIdClaim(decodeJwtPayload(c.accessToken!));

    expect(aTenantId, 'TenantA tenantId missing').toBeTruthy();
    expect(bTenantId, 'TenantB tenantId missing').toBeTruthy();
    expect(cTenantId, 'TenantC tenantId missing').toBeTruthy();

    expect(aTenantId).not.toEqual(bTenantId);
    expect(aTenantId).not.toEqual(cTenantId);
    expect(bTenantId).not.toEqual(cTenantId);
  });
});

