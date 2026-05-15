/**
 * Multi-tenant test data configuration
 *
 * This file contains the test tenant and user configuration used by
 * multi-tenant.setup.ts to create test data and by test files to login.
 *
 * Canary-mode awareness
 * ---------------------
 * When the canary `global-setup.canary.ts` runs (E2E_TARGET in {staging, prod})
 * it sets `process.env.E2E_CANARY_PREFIX` to `e2ec-{runId8}-`. All exported
 * names here are computed via lazy property accessors that read that env var
 * AT ACCESS TIME — so the same `TEST_TENANTS.TENANT_A` ref returns:
 *
 *   - `e2e-TenantA`            when canary mode is off (local target)
 *   - `e2ec-a1b2c3d4-e2e-TenantA` when canary mode is on (staging/prod)
 *
 * The legacy `e2e-` prefix is preserved INSIDE the canary prefix to keep
 * backward-compat with any existing test that does substring matching, while
 * the outer `e2ec-{runId8}-` is what the cleanup endpoints sweep on.
 *
 * IMPORTANT: don't destructure the constants at module top-level into local
 * vars. Always reference them via `TEST_TENANTS.TENANT_A` or pass them through
 * the wrapper functions in `helpers/canary-prefix.ts`. The lazy property
 * accessors only fire on real access.
 */
import { canaryName } from '../helpers/canary-prefix.js';

// Internal base names — never exported. The exported objects below run each
// through `canaryName()` at access time so the canary prefix is applied when
// E2E_CANARY_PREFIX is set.
const BASE_TENANTS = {
  TENANT_A: 'e2e-TenantA',
  TENANT_B: 'e2e-TenantB',
  TENANT_C: 'e2e-TenantC',
} as const;

const BASE_USERS = {
  TENANT_A_ADMIN: {
    username: 'e2e-tenantA-admin',
    email: 'e2e-tenantA-admin@test.local',
    password: 'TestPass123!',
    firstName: 'TenantA',
    lastName: 'Admin',
    tenantBaseKey: 'TENANT_A' as const,
    roles: ['admin', 'user'],
  },
  TENANT_A_USER: {
    username: 'e2e-tenantA-user',
    email: 'e2e-tenantA-user@test.local',
    password: 'TestPass123!',
    firstName: 'TenantA',
    lastName: 'User',
    tenantBaseKey: 'TENANT_A' as const,
    roles: ['user'],
  },
  TENANT_B_ADMIN: {
    username: 'e2e-tenantB-admin',
    email: 'e2e-tenantB-admin@test.local',
    password: 'TestPass123!',
    firstName: 'TenantB',
    lastName: 'Admin',
    tenantBaseKey: 'TENANT_B' as const,
    roles: ['admin', 'user'],
  },
  TENANT_B_USER: {
    username: 'e2e-tenantB-user',
    email: 'e2e-tenantB-user@test.local',
    password: 'TestPass123!',
    firstName: 'TenantB',
    lastName: 'User',
    tenantBaseKey: 'TENANT_B' as const,
    roles: ['user'],
  },
  TENANT_C_ADMIN: {
    username: 'e2e-tenantC-admin',
    email: 'e2e-tenantC-admin@test.local',
    password: 'TestPass123!',
    firstName: 'TenantC',
    lastName: 'Admin',
    tenantBaseKey: 'TENANT_C' as const,
    roles: ['admin', 'user'],
  },
  TENANT_C_USER: {
    username: 'e2e-tenantC-user',
    email: 'e2e-tenantC-user@test.local',
    password: 'TestPass123!',
    firstName: 'TenantC',
    lastName: 'User',
    tenantBaseKey: 'TENANT_C' as const,
    roles: ['user'],
  },
} as const;

type TenantKey = keyof typeof BASE_TENANTS;
type UserKey = keyof typeof BASE_USERS;

// Test tenant names — accessor-backed so the canary prefix applies at runtime.
// Object.keys / Object.values / iteration ALL hit the getters, so existing
// code patterns like `Object.values(TEST_TENANTS)` Just Work.
export const TEST_TENANTS = Object.freeze(
  Object.defineProperties({} as Record<TenantKey, string>, {
    TENANT_A: { get: () => canaryName(BASE_TENANTS.TENANT_A), enumerable: true },
    TENANT_B: { get: () => canaryName(BASE_TENANTS.TENANT_B), enumerable: true },
    TENANT_C: { get: () => canaryName(BASE_TENANTS.TENANT_C), enumerable: true },
  }),
);

interface TestUser {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantName: string;
  roles: string[];
}

function materialize(key: UserKey): TestUser {
  const u = BASE_USERS[key];
  return {
    username: canaryName(u.username),
    // Email's local-part also receives the prefix so KC's email-unique
    // constraint doesn't trip on canary re-runs. Domain is preserved.
    email: canaryName(u.email),
    password: u.password,
    firstName: u.firstName,
    lastName: u.lastName,
    tenantName: canaryName(BASE_TENANTS[u.tenantBaseKey]),
    roles: [...u.roles],
  };
}

// Test user configuration — accessor-backed, same pattern as TEST_TENANTS.
export const TEST_USERS = Object.freeze(
  Object.defineProperties({} as Record<UserKey, TestUser>, {
    TENANT_A_ADMIN: { get: () => materialize('TENANT_A_ADMIN'), enumerable: true },
    TENANT_A_USER: { get: () => materialize('TENANT_A_USER'), enumerable: true },
    TENANT_B_ADMIN: { get: () => materialize('TENANT_B_ADMIN'), enumerable: true },
    TENANT_B_USER: { get: () => materialize('TENANT_B_USER'), enumerable: true },
    TENANT_C_ADMIN: { get: () => materialize('TENANT_C_ADMIN'), enumerable: true },
    TENANT_C_USER: { get: () => materialize('TENANT_C_USER'), enumerable: true },
  }),
);

export function getProjectUsers(projectName: string) {
  const name = (projectName || '').toLowerCase();
  if (name.includes('mobile')) return { admin: TEST_USERS.TENANT_B_ADMIN, user: TEST_USERS.TENANT_B_USER };
  if (name.includes('firefox')) return { admin: TEST_USERS.TENANT_C_ADMIN, user: TEST_USERS.TENANT_C_USER };
  return { admin: TEST_USERS.TENANT_A_ADMIN, user: TEST_USERS.TENANT_A_USER };
}
