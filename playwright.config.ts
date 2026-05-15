import { defineConfig } from '@playwright/test';
import { loadE2EEnv } from './fixtures/env-loader.js';
import { chromiumHostResolverRules, installHostOverride } from './fixtures/host-override.js';
import { projects } from './playwright.projects.js';

// Load environment-specific config based on E2E_TARGET (default: 'local')
loadE2EEnv();

// Install Node-side DNS override if E2E_HOST_OVERRIDE_IP is set. This config
// module is re-evaluated in each worker process, so the patch applies to all
// `APIRequestContext` + axios + fetch traffic inside specs, not just to
// globalSetup. Idempotent — calling twice in the same process is a no-op.
installHostOverride();

// Build Chromium `--host-resolver-rules` arg from the same env vars. Empty
// string when no override is configured — caller should skip the arg.
const hostResolverRules = chromiumHostResolverRules();
const browserLaunchArgs = hostResolverRules
  ? [`--host-resolver-rules=${hostResolverRules}`]
  : [];

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

  // Hard per-test timeout cap. Tests budgeted at 30s for normal flows; 60s
  // is the absolute ceiling — anything that needs longer is either testing
  // wrong (waiting on a polled retry instead of asserting once) or belongs
  // in a separate stress suite invoked with --timeout. Stress projects were
  // removed from the default matrix for this reason.
  timeout: 60000,

  expect: {
    timeout: 5000,
  },

  // Canary lifecycle wiring (Phase 2 — see
  // BaseClient/docs/Tasks/IN_PROGRESS/phase-2-e2e-lifecycle-wiring.md).
  // For staging/prod targets we mint a per-invocation run UUID, prefix every
  // created entity name with `e2ec-{runId8}-`, and sweep all 6 services'
  // /api/v1/internal/canary-cleanup endpoints in teardown. For local target
  // the existing setup/teardown stays — tests run against fresh ephemeral DBs
  // anyway.
  globalSetup: ((): string => {
    const target = process.env.E2E_TARGET ?? 'local';
    return target === 'staging' || target === 'prod'
      ? require.resolve('./fixtures/global-setup.canary.ts')
      : require.resolve('./fixtures/global-setup.ts');
  })(),
  globalTeardown: ((): string => {
    const target = process.env.E2E_TARGET ?? 'local';
    return target === 'staging' || target === 'prod'
      ? require.resolve('./fixtures/global-teardown.canary.ts')
      : require.resolve('./tests/multi-tenant.teardown.ts');
  })(),

  // Inject Chromium `--host-resolver-rules` into every Chromium-based project
  // (Desktop Chrome, Pixel 5). Firefox + WebKit can't consume this flag — they
  // rely on the Node-side `dns.lookup` patch installed above for the API
  // request stack, and their UI traffic falls back to the OS resolver. When
  // E2E_HOST_OVERRIDE_IP isn't set, browserLaunchArgs is empty and this is a
  // no-op spread.
  projects: browserLaunchArgs.length
    ? projects.map(p => {
        const browser = (p.use as { defaultBrowserType?: string } | undefined)?.defaultBrowserType;
        const isChromium = browser === 'chromium' || browser === undefined;
        if (!isChromium) return p;
        const existingLaunchOptions = (p.use as { launchOptions?: { args?: string[] } } | undefined)
          ?.launchOptions;
        return {
          ...p,
          use: {
            ...p.use,
            launchOptions: {
              ...existingLaunchOptions,
              args: [...(existingLaunchOptions?.args ?? []), ...browserLaunchArgs],
            },
          },
        };
      })
    : projects,

  // Web server configuration - disabled since frontend runs via Tilt.
  webServer: undefined,
});
