import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

type ProjectConfig = NonNullable<PlaywrightTestConfig['projects']>;
type Project = ProjectConfig[number];

// Chromium-only. The suite is sharded into fine-grained "chunk" projects —
// each a sub-batch sized to run in roughly 2-3 minutes. Splitting the run this
// way (vs coarse per-domain projects) means a broken chunk is isolated from
// the rest and the list reporter shows per-chunk progress — all inside ONE
// `playwright test` invocation, so globalSetup runs only once.
//
// Retargeting (2026-05-22)
// -----------------------
// The UI chunks drive the REAL shipped apps, not the legacy BaseClient SPA.
// Each chunk runs against ONE app, selected via `ChunkOpts.app`:
//   - 'erevna'   → erevna-web   (questioner / surveys-and-forms) — realm questioner
//   - 'katalogos'→ katalogos-web (online menus)                  — realm onlinemenu
// A chunk's `app` sets a per-project `baseURL` override. Chunks without an
// explicit `app` inherit the global `baseURL` (katalogos-web — see
// playwright.config.ts / .env.<target>). Both real apps are the same Expo
// codebase with the same routes + testIDs, so a chunk runs identically on
// either; the questioner suites live on erevna because that is their product
// home, everything else is consolidated on katalogos.
//
// `buildProjects()` is a factory (not a const) because it reads
// `EREVNA_BASE_URL` from the environment — and the env files are only loaded
// by `loadE2EEnv()` in playwright.config.ts AFTER this module is imported.
// Calling it post-load is what makes the env vars visible.

const CHROME = devices['Desktop Chrome'];
const AUTH = 'playwright/.auth/user.json';

type AppName = 'erevna' | 'katalogos';

interface ChunkOpts {
  /** Loads the saved auth storage state — set for any project that drives the UI as a logged-in user. */
  auth?: boolean;
  /** Adds the multi-tenant-setup dependency (per-tenant test users). */
  multiTenant?: boolean;
  /**
   * Which real app this chunk drives. 'erevna' overrides the project baseURL
   * to `EREVNA_BASE_URL`; omitted / 'katalogos' inherits the global baseURL
   * (katalogos-web). API-only chunks (no UI) leave this unset.
   */
  app?: AppName;
}

export function buildProjects(): ProjectConfig {
  const erevnaUrl = process.env.EREVNA_BASE_URL;

  /**
   * Build one chunk project. `dir` is the path under tests/; `files` is the
   * list of spec basenames (without `.spec.ts`) — empty means every spec in
   * `dir`.
   */
  function chunk(name: string, dir: string, files: string[], opts: ChunkOpts = {}): Project {
    const body = files.length ? `(${files.join('|')})` : '.*';
    const use: Project['use'] = { ...CHROME };
    if (opts.auth) use.storageState = AUTH;
    // 'erevna' chunks get an explicit baseURL override; 'katalogos' / unset
    // inherit the global baseURL so no override is needed.
    if (opts.app === 'erevna' && erevnaUrl) use.baseURL = erevnaUrl;
    return {
      name,
      workers: 1,
      testMatch: new RegExp(`${dir}/${body}\\.spec\\.ts`),
      use,
      dependencies: opts.multiTenant ? ['setup', 'multi-tenant-setup'] : ['setup'],
    };
  }

  // UI chunk on katalogos-web (the global-baseURL app).
  const KAT = { auth: true, multiTenant: true, app: 'katalogos' } as const;
  // UI chunk on erevna-web.
  const ERV = { auth: true, multiTenant: true, app: 'erevna' } as const;

  return [
    // ---- Setup projects (run first, results shared by every chunk) ----
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'multi-tenant-setup',
      testMatch: /multi-tenant\.setup\.ts/,
      dependencies: ['setup'],
      timeout: 180000,
    },

    // ---- API / observability chunks (no UI → no app/baseURL) ----
    { name: 'health', workers: 1, testMatch: /health\/.*\.spec\.ts/, dependencies: ['setup'] },
    chunk('diagnostics', 'diagnostics', [], { multiTenant: true, app: 'katalogos' }),
    { name: 'logging', workers: 1, testMatch: /logging\/(?!stress).*\.spec\.ts/, dependencies: ['setup'] },
    { name: 'monitoring', workers: 1, testMatch: /monitoring\/.*\.spec\.ts/, dependencies: ['setup'] },
    { name: 'cross-product-isolation', workers: 1, testMatch: /cross-product-isolation\/.*\.spec\.ts/, dependencies: ['setup'] },

    // ---- Identity chunks (auth state, no multi-tenant users) ----
    // auth-methods-canary is a pure-API spec (no UI); the loaded storageState is
    // inert for it. It lives here so the staging canary's E2E_SUITE path filter
    // (job.yml.tpl) intersects a real project.
    // (Register has NO canary spec: CreateTenantUser's validator rejects the
    // `e2ec-` reserved prefix on user-input name fields, so a register test
    // cannot be made canary-sweepable. See job.yml.tpl E2E_SUITE comment.)
    chunk('identity-auth', 'identity', ['login', 'login-direct', 'logout', 'token-refresh', 'auth-methods-canary'], { auth: true, app: 'katalogos' }),
    chunk('identity-account', 'identity', ['email-otp', 'password-reset', 'host-override-smoke', 'cookie-session'], { auth: true, app: 'katalogos' }),

    // ---- Smoke → erevna-web ----
    // critical-paths.spec.ts is a questioner journey (create template →
    // activate → view answers) and hits questioner-api, so it must run on
    // erevna-web — katalogos-web's BFF mints onlinemenu-realm tokens that
    // questioner-api rejects (ProductRealms=["questioner"]).
    chunk('smoke', 'smoke', [], ERV),

    // ---- Online Menus (5 chunks) → katalogos-web ----
    chunk('online-menus-crud', 'online-menus', ['menu-activation', 'menu-crud-with-activation', 'menu-display-order-sorting', 'bff-no-token-in-browser'], KAT),
    chunk('online-menus-editor-categories', 'online-menus', ['menu-editor-categories-focus', 'menu-editor-categories-crud', 'menu-editor-categories-switching', 'menu-duplicate-names'], KAT),
    chunk('online-menus-editor-uploads', 'online-menus', ['menu-content-upload-basic', 'menu-content-upload-create', 'menu-content-upload-advanced'], KAT),
    chunk('online-menus-public-preview', 'online-menus', ['menu-preview-and-external-link', 'menu-qr-code'], KAT),
    chunk('online-menus-public-viewer', 'online-menus', ['menu-public-page-load-basic', 'menu-public-page-load-viewer', 'public-viewer-active-filtering-basic', 'public-viewer-active-filtering-states'], KAT),

    // ---- Questioner (4 chunks) → erevna-web ----
    chunk('questioner-templates', 'questioner/templates', [], ERV),
    chunk('questioner-active', 'questioner/quiz-active', [], ERV),
    chunk('questioner-answers', 'questioner/quiz-answers', [], ERV),
    chunk('questioner-security', 'questioner/security', [], ERV),

    // ---- Content (2 chunks) → katalogos-web ----
    chunk('content-api', 'content', ['content-api', 'content-api-advanced'], KAT),
    chunk('content-upload', 'content', ['content-upload'], KAT),

    // ---- Notifications (4 chunks; stress specs excluded) → katalogos-web ----
    chunk('notifications-screen', 'notifications', ['notification-screen'], KAT),
    chunk('notifications-nav', 'notifications', ['notification-screen-navigation', 'health'], KAT),
    chunk('notifications-alerts', 'notifications', ['notification-toast', 'notification-badge', 'cross-tab'], KAT),
    chunk('notifications-infra', 'notifications', ['realtime', 'connection'], KAT),

    // ---- Theme (2 chunks) → katalogos-web ----
    chunk('theme-settings', 'theme', ['theme-settings', 'theme-persistence-auth', 'theme-persistence-refresh'], KAT),
    chunk('theme-components', 'theme', ['theme-components'], KAT),

    // ---- Tenant Themes → katalogos-web ----
    chunk('tenant-themes', 'tenant-themes', [], KAT),

    // ---- Menu Styling → katalogos-web ----
    // The elaborate per-menu styling UI (separate Styling/Colors/Typography/
    // Layout tabs) was retired — the real app simplified it to a Theme
    // color-swatch picker under the menu editor's Details tab. The old 9-spec
    // suite was deleted; `menu-theme-swatch.spec.ts` is the thin replacement.
    chunk('menu-styling', 'menu-styling', [], KAT),

    // ---- Billing (2 chunks) → katalogos-web ----
    chunk('billing-subscription', 'billing', ['billing-subscription', 'billing-subscription-flow', 'billing-cancellation'], KAT),
    chunk('billing-pricing', 'billing', ['billing-pricing-page', 'billing-upgrade-downgrade', 'billing-history'], KAT),

    // ---- Showcase (3 chunks) → katalogos-web ----
    chunk('showcase-forms', 'showcase', ['native-forms', 'native-forms-fields', 'native-forms-validation', 'native-forms-animations'], KAT),
    chunk('showcase-visual', 'showcase', ['native-forms-combobox', 'native-forms-dark-theme', 'theme-preset-cards'], KAT),
    chunk('showcase-components', 'showcase', ['layout-full-width', 'native-components', 'products-api'], KAT),

    // ---- Kefi landing parity (standalone vs kefi-managed) ----
    // Standalone project: hits the public prod URLs for KUCY + UBS and the
    // matching kefi-landings renders. No auth, no multi-tenant deps, no
    // baseURL override — the specs use absolute URLs. Safe to run against
    // local OR staging OR prod (always reads the live prod refs).
    {
      name: 'kefi-landing-parity',
      workers: 1,
      testMatch: /kefi-landing-parity\/.*\.spec\.ts/,
      use: CHROME,
    },

    // ---- Kefi tenant-lifecycle E2E (Phases B + C) ----
    // Standalone project — no auth dependency (the spec signs up a fresh
    // canary tenant) and no multi-tenant setup. Hits the Kefi marketing
    // /signup form + the Phase-A admin endpoints + Maddy IMAP, then
    // (Phase C) logs into kefi-web, completes the 7-step wizard, publishes,
    // and asserts KUCY's hand-authored landing still renders.
    //
    // Timeout override: the spec waits on Maddy's SMTP queue + DKIM signing
    // + IMAP delivery (~30s typical, 60s budget), the 7-step wizard's
    // autosave debounce settles (~5s total), the publish K8s Job's kaniko
    // build + kefi-landings rollout (60-240s), and the KUCY landing probe
    // (up to 90s while the rollout settles). 600s ceiling; nightly runs
    // land in ~3-4 min. Pre-Phase-C this was 180s.
    {
      name: 'kefi-lifecycle',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-tenant-lifecycle\.spec\.ts/,
      use: CHROME,
    },

    // ---- Poueni forgot/reset-password E2E ----
    // Standalone — signs up a fresh canary tenant (plus-addressed on the
    // shared bot mailbox), verifies, then drives the full forgot→reset→login
    // round-trip through the marketing reset page + the dashboard login form
    // in a real browser. Timeout override: two IMAP waits (verify + reset
    // emails, ~30s typical / 90s budget each) plus several browser logins.
    {
      name: 'poueni-password-reset',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-password-reset\.spec\.ts/,
      use: CHROME,
    },
  ];
}
