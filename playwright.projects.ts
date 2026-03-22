/* eslint-disable max-file-lines/max-file-lines -- Project definitions are a single declarative array; splitting further would reduce readability */
import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

type ProjectConfig = NonNullable<PlaywrightTestConfig['projects']>;

/**
 * Playwright project definitions extracted from playwright.config.ts.
 * Each project configures a test batch with browser, dependencies, and test match patterns.
 */
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
  {
    name: 'diagnostics-mobile',
    testMatch: /diagnostics\/.*\.spec\.ts/,
    dependencies: ['setup', 'multi-tenant-setup'],
    use: { ...devices['Pixel 5'] },
  },
  {
    name: 'diagnostics-firefox',
    testMatch: /diagnostics\/.*\.spec\.ts/,
    dependencies: ['setup', 'multi-tenant-setup'],
    use: { ...devices['Desktop Firefox'] },
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
  {
    name: 'identity-mobile',
    workers: 1,
    testMatch: /identity\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup'],
  },
  {
    name: 'identity-firefox',
    workers: 1,
    testMatch: /identity\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'questioner-mobile',
    workers: 1,
    testMatch: /questioner\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'questioner-firefox',
    workers: 1,
    testMatch: /questioner\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'smoke-mobile',
    workers: 1,
    testMatch: /smoke\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'smoke-firefox',
    workers: 1,
    testMatch: /smoke\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'online-menus-mobile',
    workers: 1,
    testMatch: /online-menus\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'online-menus-firefox',
    workers: 1,
    testMatch: /online-menus\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'content-mobile',
    workers: 1,
    testMatch: /content\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'content-firefox',
    workers: 1,
    testMatch: /content\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'notifications-mobile',
    workers: 1,
    testMatch: /notifications\/(?!stress).*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'notifications-firefox',
    workers: 1,
    testMatch: /notifications\/(?!stress).*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Notification Stress Tests (Chromium only, generous timeouts)
  {
    name: 'notification-stress',
    workers: 1,
    testMatch: /notifications\/stress-.*\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'playwright/.auth/user.json',
      actionTimeout: 30000,
      navigationTimeout: 30000,
    },
    timeout: 120000,
    dependencies: ['setup', 'multi-tenant-setup'],
  },

  // Showcase batch (requires multi-tenant setup for authenticated access)
  {
    name: 'showcase-chromium',
    workers: 1,
    testMatch: /showcase\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'showcase-mobile',
    workers: 1,
    testMatch: /showcase\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'showcase-firefox',
    workers: 1,
    testMatch: /showcase\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'tenant-themes-mobile',
    workers: 1,
    testMatch: /tenant-themes\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'tenant-themes-firefox',
    workers: 1,
    testMatch: /tenant-themes\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'theme-mobile',
    workers: 1,
    testMatch: /theme\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'theme-firefox',
    workers: 1,
    testMatch: /theme\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'navigation-mobile',
    workers: 1,
    testMatch: /navigation\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup'],
  },
  {
    name: 'navigation-firefox',
    workers: 1,
    testMatch: /navigation\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'menu-styling-mobile',
    workers: 1,
    testMatch: /menu-styling\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'menu-styling-firefox',
    workers: 1,
    testMatch: /menu-styling\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  {
    name: 'billing-mobile',
    workers: 1,
    testMatch: /billing\/.*\.spec\.ts/,
    use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
    dependencies: ['setup', 'multi-tenant-setup'],
  },
  {
    name: 'billing-firefox',
    workers: 1,
    testMatch: /billing\/.*\.spec\.ts/,
    use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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

  // Logging Stress Tests (generous timeouts, single worker)
  {
    name: 'logging-stress',
    workers: 1,
    testMatch: /logging\/stress-.*\.spec\.ts/,
    timeout: 120000,
    dependencies: ['setup'],
  },

  // Monitoring tests (API-only, no browser UI needed)
  {
    name: 'monitoring',
    workers: 1,
    testMatch: /monitoring\/.*\.spec\.ts/,
    dependencies: ['setup'],
  },
];
