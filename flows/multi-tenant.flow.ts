import { expect, Page } from '@playwright/test';
import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { TenantsPage } from '../pages/TenantsPage.js';
import { UsersPage } from '../pages/UsersPage.js';

export async function ensureTenantExists(tenantsPage: TenantsPage, tenantName: string) {
  const exists = await tenantsPage.tenantExists(tenantName);

  if (exists) {
    return;
  }

  await tenantsPage.createTenant(tenantName);
  await expect(tenantsPage.page.getByText(tenantName)).toBeVisible({ timeout: 10000 });
}

export async function ensureUserExists(usersPage: UsersPage, userData: (typeof TEST_USERS)[keyof typeof TEST_USERS]) {
  if (await usersPage.userExists(userData.username)) {
    return;
  }

  await usersPage.createUser(userData);
}

export async function ensureTestTenantsAndUsers(page: Page) {
  const tenantsPage = new TenantsPage(page);
  await tenantsPage.goto();

  await ensureTenantExists(tenantsPage, TEST_TENANTS.TENANT_A);
  await ensureTenantExists(tenantsPage, TEST_TENANTS.TENANT_B);
  await ensureTenantExists(tenantsPage, TEST_TENANTS.TENANT_C);

  const usersPage = new UsersPage(page);
  await usersPage.goto();

  await expect(usersPage.pageHeader).toBeVisible({ timeout: 10000 });

  for (const userData of Object.values(TEST_USERS)) {
    await ensureUserExists(usersPage, userData);
  }
}
