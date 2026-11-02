import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  testMatch: /(photo|photo-privacy|advice)\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.JINX_PHOTO_REPORT ?? 'test-results/jinx-photo.json' }]],
  timeout: 90_000,
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'only-on-failure' },
});
