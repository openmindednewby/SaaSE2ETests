import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific config
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:8082';

// Script to copy auth tokens from localStorage to sessionStorage
// This is needed because the app uses sessionStorage but Playwright only persists localStorage
const authInitScript = `
  (() => {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    if (accessToken) sessionStorage.setItem('accessToken', accessToken);
    if (refreshToken) sessionStorage.setItem('refreshToken', refreshToken);
  })();
`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'reports/html' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['list']
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    // Performance: Reduce default timeouts (Playwright defaults are 30s)
    actionTimeout: 10000,      // 10s for actions like click, fill
    navigationTimeout: 15000,  // 15s for navigation
  },

  // Default test timeout (can be overridden per-test)
  timeout: 30000,

  // Assertion timeout - how long web-first assertions retry
  expect: {
    timeout: 5000,
  },

  // Global setup for authentication
  globalSetup: require.resolve('./fixtures/global-setup.ts'),
  
  // Global teardown for cleanup (deletes test tenants and users)
  globalTeardown: require.resolve('./tests/multi-tenant.teardown.ts'),

  projects: [
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
      timeout: 180000, // 3 minutes for full setup
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
  ],

  // Web server configuration - starts the client app if not running
  webServer: process.env.CI ? undefined : {
    command: 'npm run start:test',
    cwd: '../OnlineMenuSaaS/clients/OnlineMenuClientApp',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
