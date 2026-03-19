import { test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { TEST_TENANTS, TEST_USERS } from '../fixtures/test-data.js';
import { ensureTenantsAndUsersExist } from '../helpers/identity-admin.js';
import { ensureProSubscriptions } from '../helpers/subscription-admin.js';

// File to store setup state (prevents re-running if already set up)
const setupStateFile = path.resolve(__dirname, '../playwright/.auth/multi-tenant-setup.json');

setup.describe('Multi-Tenant Test Setup', () => {
  setup('create test tenants and users', async ({ page: _page, baseURL: _baseURL }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;
    const identityApiUrl = process.env.IDENTITY_API_URL || 'http://localhost:5002';
    const paymentApiUrl = process.env.PAYMENT_API_URL || 'http://localhost:5018';

    // Skip if credentials not configured
    if (!username || !password) {
      setup.skip(true, 'TEST_USER_USERNAME or TEST_USER_PASSWORD not set in .env.local');
      return;
    }

    // Always run idempotent setup.
    // Tests rely on these tenants/users existing, and globalTeardown may remove them between runs.

    // Fast path: use IdentityService API directly (no UI navigation).
    await ensureTenantsAndUsersExist(identityApiUrl, username, password);

    // Provision Pro subscriptions for all test tenants.
    // Free tier limits maxMenus to 1, which blocks multi-menu E2E tests.
    // Uses the tenant "user" role users because PaymentService requires "User" role.
    const tenantUsers = [
      { tenantName: TEST_TENANTS.TENANT_A, username: TEST_USERS.TENANT_A_USER.username, password: TEST_USERS.TENANT_A_USER.password },
      { tenantName: TEST_TENANTS.TENANT_B, username: TEST_USERS.TENANT_B_USER.username, password: TEST_USERS.TENANT_B_USER.password },
      { tenantName: TEST_TENANTS.TENANT_C, username: TEST_USERS.TENANT_C_USER.username, password: TEST_USERS.TENANT_C_USER.password },
    ];

    const subscriptionResults = await ensureProSubscriptions(identityApiUrl, paymentApiUrl, tenantUsers);

    const created = subscriptionResults.filter((r) => r.status === 'created').length;
    const existing = subscriptionResults.filter((r) => r.status === 'already-exists').length;
    const errors = subscriptionResults.filter((r) => r.status === 'error').length;
    // eslint-disable-next-line no-console-in-tests/no-console-in-tests -- setup logging, not a test
    console.log(`  [multi-tenant-setup] Pro subscriptions: ${created} created, ${existing} already existed, ${errors} errors`);

    // Save setup state
    const authDir = path.dirname(setupStateFile);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    fs.writeFileSync(setupStateFile, JSON.stringify({
      setupComplete: true,
      timestamp: Date.now(),
      tenants: Object.values(TEST_TENANTS),
      users: Object.values(TEST_USERS).map((u) => u.username),
      subscriptions: subscriptionResults,
    }));
  });
});
