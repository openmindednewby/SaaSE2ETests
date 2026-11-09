import { defineConfig } from '@playwright/test';

import { installRealTenantWriteGuard } from '../../fixtures/real-tenant-guard';

installRealTenantWriteGuard();

process.env.JINX_APP_URL ??= 'https://jinxbeadpatterns.dloizides.com';

export default defineConfig({
  testDir: __dirname,
  testMatch: 'register-journey.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 480_000,
  reporter: 'line',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
