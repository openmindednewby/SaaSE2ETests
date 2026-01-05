import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific config
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:8082';

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

  projects: [
    // Auth setup project - runs before all tests
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Desktop Chrome
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Mobile viewport (React Native Web)
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Firefox for cross-browser testing
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
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
