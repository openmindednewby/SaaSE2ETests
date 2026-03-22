import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { projects } from './playwright.projects.js';

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

// Script to copy auth state from localStorage to sessionStorage on page load.
// The app uses sessionStorage but Playwright only persists localStorage.
// Runs before any page scripts, ensuring auth is available when the app initializes.
const _authInitScript = `
  (() => {
    try {
      const persistAuth = localStorage.getItem('persist:auth');
      if (persistAuth && !sessionStorage.getItem('persist:auth')) {
        sessionStorage.setItem('persist:auth', persistAuth);
      }

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
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },

  timeout: 30000,

  expect: {
    timeout: 5000,
  },

  globalSetup: require.resolve('./fixtures/global-setup.ts'),
  globalTeardown: require.resolve('./tests/multi-tenant.teardown.ts'),

  projects,

  // Web server configuration - disabled since frontend runs via Tilt.
  webServer: undefined,
});
