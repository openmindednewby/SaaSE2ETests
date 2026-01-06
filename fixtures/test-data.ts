/**
 * Multi-tenant test data configuration
 * 
 * This file contains the test tenant and user configuration used by
 * multi-tenant.setup.ts to create test data and by test files to login.
 */

// Test tenant names
export const TEST_TENANTS = {
  TENANT_A: 'e2e-TenantA',
  TENANT_B: 'e2e-TenantB',
};

// Test user configuration
export const TEST_USERS = {
  TENANT_A_ADMIN: {
    username: 'e2e-tenantA-admin',
    email: 'e2e-tenantA-admin@test.local',
    password: 'TestPass123!',
    firstName: 'TenantA',
    lastName: 'Admin',
    tenantName: TEST_TENANTS.TENANT_A,
    roles: ['admin'],
  },
  TENANT_A_USER: {
    username: 'e2e-tenantA-user',
    email: 'e2e-tenantA-user@test.local',
    password: 'TestPass123!',
    firstName: 'TenantA',
    lastName: 'User',
    tenantName: TEST_TENANTS.TENANT_A,
    roles: ['user'],
  },
  TENANT_B_ADMIN: {
    username: 'e2e-tenantB-admin',
    email: 'e2e-tenantB-admin@test.local',
    password: 'TestPass123!',
    firstName: 'TenantB',
    lastName: 'Admin',
    tenantName: TEST_TENANTS.TENANT_B,
    roles: ['admin'],
  },
  TENANT_B_USER: {
    username: 'e2e-tenantB-user',
    email: 'e2e-tenantB-user@test.local',
    password: 'TestPass123!',
    firstName: 'TenantB',
    lastName: 'User',
    tenantName: TEST_TENANTS.TENANT_B,
    roles: ['user'],
  },
};
