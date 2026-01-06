import { expect, test as setup } from '@playwright/test';
import console from 'console';
import fs from 'fs';
import path from 'path';
import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { LoginPage } from '../pages/LoginPage.js';
import { TenantsPage } from '../pages/TenantsPage.js';
import { UsersPage } from '../pages/UsersPage.js';

// File to store setup state (prevents re-running if already set up)
const setupStateFile = path.resolve(__dirname, '../playwright/.auth/multi-tenant-setup.json');

setup.describe('Multi-Tenant Test Setup', () => {
  setup('create test tenants and users', async ({ page, baseURL }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;

    // Skip if credentials not configured
    if (!username || !password) {
      setup.skip(true, 'TEST_USER_USERNAME or TEST_USER_PASSWORD not set in .env.local');
      return;
    }

    // Check if already set up
    if (fs.existsSync(setupStateFile)) {
      try {
        const setupState = JSON.parse(fs.readFileSync(setupStateFile, 'utf-8'));
        if (setupState.setupComplete && Date.now() - setupState.timestamp < 3600000) {
          console.log('Multi-tenant setup already complete (less than 1 hour ago), skipping...');
          return;
        }
      } catch {
        // Continue with setup if file is invalid
      }
    }

    try {
      console.log('🏗️ Starting multi-tenant test setup...');

      // Login as super user
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      
      try {
        await expect(loginPage.usernameInput).toBeVisible({ timeout: 10000 });
        await loginPage.loginAndWait(username, password);
        console.log('✅ Logged in as super user');
      } catch (error: any) {
        console.error('❌ Failed to login:', error.message);
        setup.skip(true, `Login failed: ${error.message}`);
        return;
      }

      // Create tenants
      const tenantsPage = new TenantsPage(page);
      console.log('📂 Navigating to tenants page...');
      await tenantsPage.goto();

      // Create TenantA if it doesn't exist
      console.log(`🔍 Checking if tenant A exists: ${TEST_TENANTS.TENANT_A}`);
      const tAExists = await tenantsPage.tenantExists(TEST_TENANTS.TENANT_A);
      console.log(`  Tenant A existence result: ${tAExists}`);
      if (!tAExists) {
        console.log(`📁 Creating tenant: ${TEST_TENANTS.TENANT_A}`);
        await tenantsPage.createTenant(TEST_TENANTS.TENANT_A);
        console.log(`⏳ Waiting for tenant A to appear: ${TEST_TENANTS.TENANT_A}`);
        await expect(page.getByText(TEST_TENANTS.TENANT_A)).toBeVisible({ timeout: 10000 });
        console.log(`✅ Created tenant: ${TEST_TENANTS.TENANT_A}`);
      } else {
        console.log(`⏭️ Tenant ${TEST_TENANTS.TENANT_A} already exists, skipping...`);
      }

      // Create TenantB if it doesn't exist
      console.log(`🔍 Checking if tenant B exists: ${TEST_TENANTS.TENANT_B}`);
      const tBExists = await tenantsPage.tenantExists(TEST_TENANTS.TENANT_B);
      console.log(`  Tenant B existence result: ${tBExists}`);
      if (!tBExists) {
        console.log(`📁 Creating tenant: ${TEST_TENANTS.TENANT_B}`);
        await tenantsPage.createTenant(TEST_TENANTS.TENANT_B);
        console.log(`⏳ Waiting for tenant B to appear: ${TEST_TENANTS.TENANT_B}`);
        await expect(page.getByText(TEST_TENANTS.TENANT_B)).toBeVisible({ timeout: 10000 });
        console.log(`✅ Created tenant: ${TEST_TENANTS.TENANT_B}`);
      } else {
        console.log(`⏭️ Tenant ${TEST_TENANTS.TENANT_B} already exists, skipping...`);
      }

      // Create users
      const usersPage = new UsersPage(page);
      console.log('📂 Navigating to users page...');
      await usersPage.goto();

      // Wait for user management page to load
      console.log('⏳ Waiting for user management header...');
      await expect(usersPage.pageHeader).toBeVisible({ timeout: 10000 });

      // Create all test users
      for (const [key, userData] of Object.entries(TEST_USERS)) {
        console.log(`🔍 Checking if user exists: ${userData.username}`);
        // Check if user exists first
        if (await usersPage.userExists(userData.username)) {
          console.log(`⏭️ User ${userData.username} already exists, skipping...`);
          continue;
        }

        console.log(`👤 Creating user: ${userData.username} (${userData.roles.join(', ')})`);
        await usersPage.createUser(userData);
        console.log(`✅ Created user: ${userData.username}`);
      }

      // Save setup state
      const authDir = path.dirname(setupStateFile);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      fs.writeFileSync(setupStateFile, JSON.stringify({
        setupComplete: true,
        timestamp: Date.now(),
        tenants: Object.values(TEST_TENANTS),
        users: Object.values(TEST_USERS).map(u => u.username),
      }));

      console.log('✅ Multi-tenant setup complete!');
    } catch (error: any) {
      console.error('❌ MULTI-TENANT SETUP FAILED:', error.message);
      if (error.stack) console.error(error.stack);
      throw error;
    }
  });
});
