import { expect, test as setup } from '@playwright/test';
import console from 'console';
import fs from 'fs';
import path from 'path';
import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { LoginPage } from '../pages/LoginPage.js';
import { ensureTestTenantsAndUsers } from '../flows/multi-tenant.flow.js';

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

    // Always run idempotent setup.
    // Tests rely on these tenants/users existing, and globalTeardown may remove them between runs.

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
      await ensureTestTenantsAndUsers(page);

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
