/**
 * Standalone Playwright config for cross-game scenario tests.
 *
 * Why separate from the main `playwright.config.ts`?
 *   - Games are public static web pages. They don't need the auth.setup,
 *     multi-tenant fixtures, or tenant teardown that the SaaS specs do.
 *   - We want fast, parallel game scenarios. Sharing the main config
 *     would drag in dependencies that nearly triple per-test setup time.
 *
 * Each game gets its own folder under `games/<slug>/` and exports specs
 * that import the shared fixtures from `games/shared/gameFixtures.ts`.
 *
 * Run via:
 *   npx playwright test --config games/playwright.games.config.ts
 *
 * Or per-game:
 *   npx playwright test --config games/playwright.games.config.ts --project solid-state
 */
import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

type ProjectConfig = NonNullable<PlaywrightTestConfig['projects']>;

const GAME_PROJECTS: ProjectConfig = [
  {
    name: 'solid-state',
    testMatch: /solid-state\/.*\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  },
  // Add other portfolio games here as they wire up their TestMode hooks:
  // { name: 'keyboardpiano', testMatch: /keyboardpiano\/.*\.spec\.ts/, ... },
  // { name: 'morphe',        testMatch: /morphe\/.*\.spec\.ts/, ... },
  // { name: 'beyondthevoid', testMatch: /beyondthevoid\/.*\.spec\.ts/, ... },
  // { name: 'kucy',          testMatch: /kucy\/.*\.spec\.ts/, ... },
];

export default defineConfig({
  testDir: __dirname,
  // 60s default — game scenarios spin up the WASM engine + sim ticks; not fast.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-games', open: 'never' }],
  ],
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: GAME_PROJECTS,
});
