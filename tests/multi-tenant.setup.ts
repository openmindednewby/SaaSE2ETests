import { expect, test as setup } from '@playwright/test';
import console from 'console';
import fs from 'fs';
import path from 'path';
import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { ensureTenantsAndUsersExist } from '../helpers/identity-admin.js';

// File to store setup state (prevents re-running if already set up)
const setupStateFile = path.resolve(__dirname, '../playwright/.auth/multi-tenant-setup.json');

setup.describe('Multi-Tenant Test Setup', () => {
  setup('create test tenants and users', async ({ page, baseURL }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;
    const identityApiUrl = process.env.IDENTITY_API_URL || 'http://localhost:5002';

    // Skip if credentials not configured
    if (!username || !password) {
      setup.skip(true, 'TEST_USER_USERNAME or TEST_USER_PASSWORD not set in .env.local');
      return;
    }

    // Always run idempotent setup.
    // Tests rely on these tenants/users existing, and globalTeardown may remove them between runs.

    try {
      console.log('🏗️ Starting multi-tenant test setup...');

      // Fast path: use IdentityService API directly (no UI navigation).
      await ensureTenantsAndUsersExist(identityApiUrl, username, password);

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
