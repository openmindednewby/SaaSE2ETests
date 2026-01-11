import { expect, Page } from '@playwright/test';
import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { TenantsPage } from '../pages/TenantsPage.js';
import { UsersPage } from '../pages/UsersPage.js';

export async function ensureTenantExists(tenantsPage: TenantsPage, tenantName: string) {
  console.log(`🔍 Checking if tenant exists: ${tenantName}`);
  const exists = await tenantsPage.tenantExists(tenantName);
  console.log(`  Tenant existence result: ${exists}`);

  if (exists) {
    console.log(`⏭️ Tenant ${tenantName} already exists, skipping...`);
    return;
  }

  console.log(`📁 Creating tenant: ${tenantName}`);
  await tenantsPage.createTenant(tenantName);
  console.log(`⏳ Waiting for tenant to appear: ${tenantName}`);
  await expect(tenantsPage.page.getByText(tenantName)).toBeVisible({ timeout: 10000 });
  console.log(`✅ Created tenant: ${tenantName}`);
}

export async function ensureUserExists(usersPage: UsersPage, userData: (typeof TEST_USERS)[keyof typeof TEST_USERS]) {
  console.log(`🔍 Checking if user exists: ${userData.username}`);
  if (await usersPage.userExists(userData.username)) {
    console.log(`⏭️ User ${userData.username} already exists, skipping...`);
    return;
  }

  console.log(`👤 Creating user: ${userData.username} (${userData.roles.join(', ')})`);
  await usersPage.createUser(userData);
  console.log(`✅ Created user: ${userData.username}`);
}

export async function ensureTestTenantsAndUsers(page: Page) {
  const tenantsPage = new TenantsPage(page);
  console.log('📂 Navigating to tenants page...');
  await tenantsPage.goto();

  await ensureTenantExists(tenantsPage, TEST_TENANTS.TENANT_A);
  await ensureTenantExists(tenantsPage, TEST_TENANTS.TENANT_B);
  await ensureTenantExists(tenantsPage, TEST_TENANTS.TENANT_C);

  const usersPage = new UsersPage(page);
  console.log('📂 Navigating to users page...');
  await usersPage.goto();

  console.log('⏳ Waiting for user management header...');
  await expect(usersPage.pageHeader).toBeVisible({ timeout: 10000 });

  for (const userData of Object.values(TEST_USERS)) {
    await ensureUserExists(usersPage, userData);
  }
}

