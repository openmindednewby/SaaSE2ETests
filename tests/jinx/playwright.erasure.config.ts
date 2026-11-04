import { defineConfig } from '@playwright/test';

import { installRealTenantWriteGuard } from '../../fixtures/real-tenant-guard';

installRealTenantWriteGuard();

process.env.JINX_APP_URL ??= 'https://jinx-app.dloizides.com';

const NINETY_MINUTES_MS = 5_400_000;

export default defineConfig({
  testDir: __dirname,
  testMatch: 'erasure-ledger.spec.ts',
  workers: 1,
  retries: 0,
  timeout: NINETY_MINUTES_MS,
  reporter: 'line',
  use: { trace: 'retain-on-failure' },
});
