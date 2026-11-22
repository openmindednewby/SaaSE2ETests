import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/selida',
  testMatch: /auth-screens\.ui\.spec\.ts/,
  timeout: 60_000,
  globalTimeout: 180_000,
  workers: 5,
  retries: 0,
  reporter: 'line',
  use: { ...devices['Desktop Chrome'] },
});
