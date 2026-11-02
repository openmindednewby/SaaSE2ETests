import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const SITE_PORT = 4399;
const STUB_PORT = 4398;
const siteDir = resolve(process.env.JINX_SITE_DIR ?? resolve(__dirname, '../../../jinx-site'));

process.env.JINX_SITE_STUB = '1';
process.env.JINX_STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export default defineConfig({
  testDir: __dirname,
  testMatch: 'browse.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  use: { baseURL: `http://127.0.0.1:${SITE_PORT}` },
  webServer: {
    command: `node "${resolve(siteDir, 'test/run-built-server.mjs')}"`,
    url: `http://127.0.0.1:${SITE_PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
