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
  fullyParallel: true,
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

    // Desktop Chrome
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
        // Run init script on every page to restore auth from localStorage to sessionStorage
        contextOptions: {
          serviceWorkers: 'allow',
        },
      },
      dependencies: ['setup', 'multi-tenant-setup'],
    },

    // Mobile viewport (React Native Web)
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup', 'multi-tenant-setup'],
    },

    // Firefox for cross-browser testing
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'playwright/.auth/user.json',
      },
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
