import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific config
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// Fix Git Bash env var casing on Windows: Git Bash uppercases SYSTEMROOT but
// Node.js child_process.spawn looks for mixed-case SystemRoot to resolve cmd.exe.
// Without this, Playwright workers fail with "spawn cmd.exe ENOENT".
if (process.platform === 'win32') {
  if (!process.env.SystemRoot && process.env.SYSTEMROOT) {
    process.env.SystemRoot = process.env.SYSTEMROOT;
  }
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:8082';

// Script to copy auth state from localStorage to sessionStorage on page load
// This is needed because the app uses sessionStorage but Playwright only persists localStorage
// The script runs before any page scripts, ensuring auth is available when the app initializes
const _authInitScript = `
  (() => {
    try {
      // Copy the persist:auth key (Redux persist format) - this is the primary auth storage
      const persistAuth = localStorage.getItem('persist:auth');
      if (persistAuth && !sessionStorage.getItem('persist:auth')) {
        sessionStorage.setItem('persist:auth', persistAuth);
      }

      // Also copy individual tokens for backwards compatibility
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      if (accessToken && !sessionStorage.getItem('accessToken')) {
        sessionStorage.setItem('accessToken', accessToken);
      }
      if (refreshToken && !sessionStorage.getItem('refreshToken')) {
        sessionStorage.setItem('refreshToken', refreshToken);
      }
    } catch (e) {
      // Silently ignore errors in init script
    }
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

  // Global script to copy auth tokens from localStorage to sessionStorage
  // This is needed because the app uses sessionStorage but Playwright only persists localStorage
  // NOTE: This is applied globally via addInitScript, not here

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
      testMatch: /notifications\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup', 'multi-tenant-setup'],
    },
    {
      name: 'notifications-mobile',
      workers: 1,
      testMatch: /notifications\/.*\.spec\.ts/,
      use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup', 'multi-tenant-setup'],
    },
    {
      name: 'notifications-firefox',
      workers: 1,
      testMatch: /notifications\/.*\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/user.json' },
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
  ],

  // Web server configuration - disabled since frontend runs via Tilt.
  // The old path '../OnlineMenuSaaS/clients/OnlineMenuClientApp' no longer exists;
  // the frontend is now at '../BaseClient'. Spawning npm from Git Bash also fails
  // with cmd.exe ENOENT. Instead, ensure frontend is running before tests.
  webServer: undefined,
});
