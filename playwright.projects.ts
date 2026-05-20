import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

type ProjectConfig = NonNullable<PlaywrightTestConfig['projects']>;
type Project = ProjectConfig[number];

// Chromium-only. The suite is sharded into fine-grained "chunk" projects —
// each a sub-batch sized to run in roughly 2-3 minutes. Splitting the run this
// way (vs coarse per-domain projects) means a broken chunk is isolated from
// the rest and the list reporter shows per-chunk progress — all inside ONE
// `playwright test` invocation, so globalSetup runs only once.

const CHROME = devices['Desktop Chrome'];
const AUTH = 'playwright/.auth/user.json';

interface ChunkOpts {
  /** Loads the saved auth storage state — set for any project that drives the UI as a logged-in user. */
  auth?: boolean;
  /** Adds the multi-tenant-setup dependency (per-tenant test users). */
  multiTenant?: boolean;
}

/**
 * Build one chunk project. `dir` is the path under tests/; `files` is the list
 * of spec basenames (without `.spec.ts`) — empty means every spec in `dir`.
 */
function chunk(name: string, dir: string, files: string[], opts: ChunkOpts = {}): Project {
  const body = files.length ? `(${files.join('|')})` : '.*';
  return {
    name,
    workers: 1,
    testMatch: new RegExp(`${dir}/${body}\\.spec\\.ts`),
    use: opts.auth ? { ...CHROME, storageState: AUTH } : { ...CHROME },
    dependencies: opts.multiTenant ? ['setup', 'multi-tenant-setup'] : ['setup'],
  };
}

const UI = { auth: true, multiTenant: true } as const;

export const projects: ProjectConfig = [
  // ---- Setup projects (run first, results shared by every chunk) ----
  { name: 'setup', testMatch: /auth\.setup\.ts/ },
  {
    name: 'multi-tenant-setup',
    testMatch: /multi-tenant\.setup\.ts/,
    dependencies: ['setup'],
    timeout: 180000,
  },

  // ---- API / observability chunks (no multi-tenant users needed) ----
  { name: 'health', workers: 1, testMatch: /health\/.*\.spec\.ts/, dependencies: ['setup'] },
  chunk('diagnostics', 'diagnostics', [], { multiTenant: true }),
  { name: 'logging', workers: 1, testMatch: /logging\/(?!stress).*\.spec\.ts/, dependencies: ['setup'] },
  { name: 'monitoring', workers: 1, testMatch: /monitoring\/.*\.spec\.ts/, dependencies: ['setup'] },
  { name: 'cross-product-isolation', workers: 1, testMatch: /cross-product-isolation\/.*\.spec\.ts/, dependencies: ['setup'] },

  // ---- Identity chunks (auth state, no multi-tenant users) ----
  chunk('identity-auth', 'identity', ['login', 'login-direct', 'logout', 'token-refresh'], { auth: true }),
  chunk('identity-account', 'identity', ['email-otp', 'password-reset', 'host-override-smoke', 'cookie-session'], { auth: true }),

  // ---- Smoke ----
  chunk('smoke', 'smoke', [], UI),

  // ---- Online Menus (5 chunks) ----
  chunk('online-menus-crud', 'online-menus', ['menu-activation', 'menu-crud-with-activation', 'menu-display-order-sorting'], UI),
  chunk('online-menus-editor-categories', 'online-menus', ['menu-editor-categories-focus', 'menu-editor-categories-crud', 'menu-editor-categories-switching', 'menu-duplicate-names'], UI),
  chunk('online-menus-editor-uploads', 'online-menus', ['menu-content-upload-basic', 'menu-content-upload-create', 'menu-content-upload-advanced'], UI),
  chunk('online-menus-public-preview', 'online-menus', ['menu-preview-and-external-link', 'menu-qr-code'], UI),
  chunk('online-menus-public-viewer', 'online-menus', ['menu-public-page-load-basic', 'menu-public-page-load-viewer', 'public-viewer-active-filtering-basic', 'public-viewer-active-filtering-states'], UI),

  // ---- Questioner (3 chunks) ----
  chunk('questioner-templates', 'questioner/templates', [], UI),
  chunk('questioner-active', 'questioner/quiz-active', [], UI),
  chunk('questioner-answers', 'questioner/quiz-answers', [], UI),

  // ---- Content (2 chunks) ----
  chunk('content-api', 'content', ['content-api', 'content-api-advanced'], UI),
  chunk('content-upload', 'content', ['content-upload'], UI),

  // ---- Notifications (4 chunks; stress specs excluded) ----
  chunk('notifications-screen', 'notifications', ['notification-screen'], UI),
  chunk('notifications-nav', 'notifications', ['notification-screen-navigation', 'health'], UI),
  chunk('notifications-alerts', 'notifications', ['notification-toast', 'notification-badge', 'cross-tab'], UI),
  chunk('notifications-infra', 'notifications', ['realtime', 'connection'], UI),

  // ---- Theme (2 chunks) ----
  chunk('theme-settings', 'theme', ['theme-settings', 'theme-persistence-auth', 'theme-persistence-refresh'], UI),
  chunk('theme-components', 'theme', ['theme-components'], UI),

  // ---- Tenant Themes ----
  chunk('tenant-themes', 'tenant-themes', [], UI),

  // ---- Menu Styling (3 chunks) ----
  chunk('menu-styling-categories', 'menu-styling', ['category-styling', 'category-styling-advanced'], UI),
  chunk('menu-styling-colors', 'menu-styling', ['color-scheme', 'color-scheme-save', 'layout-templates'], UI),
  chunk('menu-styling-text', 'menu-styling', ['typography', 'typography-advanced', 'persistence', 'persistence-reload'], UI),

  // ---- Billing (2 chunks) ----
  chunk('billing-subscription', 'billing', ['billing-subscription', 'billing-subscription-flow', 'billing-cancellation'], UI),
  chunk('billing-pricing', 'billing', ['billing-pricing-page', 'billing-upgrade-downgrade', 'billing-history'], UI),

  // ---- Showcase (3 chunks) ----
  chunk('showcase-forms', 'showcase', ['native-forms', 'native-forms-fields', 'native-forms-validation', 'native-forms-animations'], UI),
  chunk('showcase-visual', 'showcase', ['native-forms-combobox', 'native-forms-dark-theme', 'theme-preset-cards'], UI),
  chunk('showcase-components', 'showcase', ['layout-full-width', 'native-components', 'products-api'], UI),
];
