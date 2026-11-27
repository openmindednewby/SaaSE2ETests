import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /(sight|foot|fsh)\.ui\.spec\.ts/, timeout: 120_000, globalTimeout: 280_000, workers: 2, retries: 0, reporter: 'line' });
