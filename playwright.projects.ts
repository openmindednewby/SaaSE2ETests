import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

type ProjectConfig = NonNullable<PlaywrightTestConfig['projects']>;

// Chromium-only matrix (2026-05-20). Mobile (Pixel 5) and Firefox project
// triples were dropped permanently — they roughly tripled wall-clock time,
// and against staging the Firefox project couldn't even resolve hostnames
// (`--host-resolver-rules` is Chromium-only). Every UI domain now ships a
// single `<domain>-chromium` project. If cross-browser regression coverage
// is ever needed again, add a one-off project inline rather than reviving
// the full matrix.
export const projects: ProjectConfig = [
  // Auth setup project - runs before all tests
  {
    name: 'setup',
    testMatch: /auth\.setup\.ts/,
  },

  // Multi-tenant setup - creates test tenants and users
  {
    name: 'multi-tenant-setup',
    testMatch: /multi-tenant\.setup\.ts/,
    dependencies: ['setup'],
    timeout: 180000,
  },

  // Health probe checks (no tenant/user setup required)
  {
    name: 'health',
    testMatch: /health\/.*\.spec\.ts/,
    dependencies: ['setup'],
  },

  // Diagnostics (API-only) - validates tenantId claims per project user
  {
    name: 'diagnostics-chromium',
    testMatch: /diagnostics\/.*\.spec\.ts/,
    dependencies: ['setup', 'multi-tenant-setup'],
    use: { ...devices['Desktop Chrome'] },
  },

  // ==================== BATCHED UI PROJECTS ====================
  // Identity batch (no multi-tenant setup required)
  {
    name: 'identity-chromium',
    workers: 1,
    testMatch: /identity\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup'],
  },

  // Questioner batch (requires multi-tenant setup)
  {
    name: 'questioner-chromium',
    workers: 1,
    testMatch: /questioner\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Smoke batch (requires multi-tenant setup)
  {
    name: 'smoke-chromium',
    workers: 1,
    testMatch: /smoke\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Online Menus batch (requires multi-tenant setup)
  {
    name: 'online-menus-chromium',
    workers: 1,
    testMatch: /online-menus\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Content upload batch (requires multi-tenant setup)
  {
    name: 'content-chromium',
    workers: 1,
    testMatch: /content\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Notifications batch (requires multi-tenant setup)
  {
    name: 'notifications-chromium',
    workers: 1,
    testMatch: /notifications\/(?!stress).*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Notification stress tests dropped from default matrix — they need 120s+
  // per test which violates the 30s/test cap. Re-enable manually via a
  // direct `npx playwright test --timeout=120000 tests/notifications/stress-*`
  // invocation when stress regression coverage is needed.

  // Showcase batch (requires multi-tenant setup for authenticated access)
  {
    name: 'showcase-chromium',
    workers: 1,
    testMatch: /showcase\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Tenant Themes batch (requires multi-tenant setup for authenticated access)
  {
    name: 'tenant-themes-chromium',
    workers: 1,
    testMatch: /tenant-themes\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Theme settings batch (requires multi-tenant setup for tenant isolation tests)
  {
    name: 'theme-chromium',
    workers: 1,
    testMatch: /theme\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Navigation batch (sidebar expandable sections, no multi-tenant setup required)
  {
    name: 'navigation-chromium',
    workers: 1,
    testMatch: /navigation\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup'],
  },

  // Menu Styling batch (requires multi-tenant setup for menu styling tests)
  {
    name: 'menu-styling-chromium',
    workers: 1,
    testMatch: /menu-styling\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Billing batch (requires multi-tenant setup for subscription state)
  {
    name: 'billing-chromium',
    workers: 1,
    testMatch: /billing\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // ==================== OBSERVABILITY PROJECTS ====================
  // Logging tests (API-only, no browser UI needed, no multi-tenant setup)
  {
    name: 'logging',
    workers: 1,
    testMatch: /logging\/(?!stress).*\.spec\.ts/,
    dependencies: ['setup'],
  },

  // Logging stress tests dropped from default matrix — need 120s+ per test
  // which violates the 30s/test cap. Re-enable manually with a direct
  // `npx playwright test --timeout=120000 tests/logging/stress-*` invocation.

  // Monitoring tests (API-only, no browser UI needed)
  {
    name: 'monitoring',
    workers: 1,
    testMatch: /monitoring\/.*\.spec\.ts/,
    dependencies: ['setup'],
  },

  // Cross-product isolation (Phase 2 / Step 5).
  // The regression-guard suite for the Questioner / OnlineMenu product split.
  // API-only (no browser UI needed). Depends on `setup` only — does NOT require
  // the multi-tenant test users since it operates on realm-scoped tokens, not
  // tenant-scoped users.
  {
    name: 'cross-product-isolation',
    workers: 1,
    testMatch: /cross-product-isolation\/.*\.spec\.ts/,
    dependencies: ['setup'],
  },
];
