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
/** Kefi event-ops browser budget — see the note above that project block. */
const EVENT_OPS_BROWSER = { ...devices['Desktop Chrome'], navigationTimeout: 45_000, actionTimeout: 15_000 };
/**
 * Kefi event-ops at PHONE width — the viewport most UBB attendees will buy on.
 *
 * `devices['Pixel 5']` is a real device descriptor (393×851, dpr 2.75,
 * `isMobile: true`, `hasTouch: true`, a mobile UA), not merely a narrow window.
 * That distinction matters: `isMobile` makes Chromium honour the page's
 * `<meta name="viewport">` and emulate a mobile visual viewport, so a layout that
 * only breaks under real mobile viewport semantics is reproduced rather than
 * papered over by a desktop engine at 393px. Chromium-only — the suite is
 * Chromium-only, and Firefox/WebKit reject `isMobile`.
 */
const EVENT_OPS_MOBILE = { ...devices['Pixel 5'], navigationTimeout: 45_000, actionTimeout: 15_000 };

/**
 * The three phone/tablet classes the UBB attendee + organizer surfaces are
 * proven against. Device DESCRIPTORS, not bare viewport sizes, so `isMobile`,
 * `hasTouch`, the device-pixel-ratio and the mobile UA are all realistic —
 * a narrow desktop window does not reproduce mobile viewport semantics.
 *
 *  - iPhone 8    375×667  — the "iPhone SE" screen people actually mean. NOTE:
 *                           Playwright's own `devices['iPhone SE']` is the
 *                           2016 FIRST-generation SE at 320×568, not the
 *                           375×667 SE2/SE3 in wide use today. Naming the
 *                           descriptor by feel gives you a screen 55px
 *                           narrower than intended — harsher, but not the one
 *                           being targeted. `iPhone 8` is the 375×667 entry.
 *  - iPhone 13   390×664  — the 390-class modern phone. (Playwright's height
 *                           is the usable viewport, below the 844px physical
 *                           screen, because browser chrome is excluded.)
 *  - iPad Mini   768×1024 — the stack/unstack BOUNDARY. The organizer promoter
 *                           table card-stacks BELOW 768px, so a tablet sitting
 *                           exactly at the breakpoint proves the comparison is
 *                           `<` and not `<=`.
 */
const UBB_PHONE_SE = { ...devices['iPhone 8'], navigationTimeout: 45_000, actionTimeout: 15_000 };
const UBB_PHONE_MODERN = { ...devices['iPhone 13'], navigationTimeout: 45_000, actionTimeout: 15_000 };
const UBB_TABLET = { ...devices['iPad Mini'], navigationTimeout: 45_000, actionTimeout: 15_000 };

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
  const kefiWebUrl = process.env.KEFI_WEB_URL;
  const ichnosWebUrl = process.env.ICHNOS_WEB_URL;
  const agoraWebUrl = process.env.AGORA_WEB_URL;
  // Digital Kin's PUBLIC site. Deliberately left with NO default, unlike zygos:
  // the site is not deployed until Plan 6, and a default would make the suite
  // fail against a host that does not exist instead of skipping with a reason.
  const digitalKinSiteUrl = process.env.DIGITALKIN_SITE_URL;
  // Zygos: the console is the ONLY public entry (BFF + SPA same-origin). Unlike the other
  // *_WEB_URL vars this has a real default rather than being left unset — the deployed host
  // is the only place the suite CAN run (see the zygos-api/zygos-ui projects below), so an
  // unset var would silently skip the whole suite instead of testing the one target it has.
  const zygosWebUrl = process.env.ZYGOS_WEB_URL || 'https://app.zygos.dloizides.com';
  // NB: agora's browser DNS override is NOT read here. Its staging hosts live in
  // SAAS_STAGING_HOSTNAMES, so the GLOBAL E2E_HOST_OVERRIDE_IP mechanism in
  // playwright.config.ts maps them in a single `--host-resolver-rules` flag. A
  // per-project second flag conflicts (Chrome honours only one). See the agora-ui
  // project below.

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
    // Fleet-wide i18n raw-key guard. Portal-agnostic: it drives agora/erevna/katalogos through
    // their own BFF login and scans each screen's text AND a11y attributes for keys that `FM()`
    // rendered as literal dotted names. Generalised from the zygos scanner that found real
    // production defects; `workers: 1` because it performs a login per portal and auth is rate
    // limited (5/60s per IP).
    { name: 'i18n-fleet', workers: 1, testMatch: /i18n\/.*\.spec\.ts/, dependencies: ['setup'] },
    // Fleet-wide security guards. Currently the demo-credential publication check: no credential a
    // portal publishes via `GET /bff/config` may be a seeded privileged-account password, on ANY of
    // the seven portals. Generalised from `zygos/zygos-public-surface.spec.ts`, which proved the
    // pattern on one portal while six others carried the same exposure unguarded.
    //
    // NO `dependencies: ['setup']` on purpose — every assertion here is anonymous (that is the
    // whole point: it asks what a stranger can reach), and depending on auth setup would make a
    // security guard skip whenever the shared login happens to be broken.
    // The `tests[/\\]` anchor is load-bearing: an unanchored /security\/.*\.spec\.ts/ also swept in
    // tests/questioner/security/*.spec.ts, dragging two authenticated questioner specs into an
    // anonymous project with no `setup` dependency — where they failed for lack of a session and
    // looked like security findings. Both separators are matched because Playwright reports
    // Windows paths with backslashes.
    { name: 'security-fleet', workers: 1, testMatch: /tests[/\\]security[/\\].*\.spec\.ts/ },
    // Ichnos (crypto AML) — @api tier: health/smoke (M0-9), screen-address/entity/combined + report (M1-1..3),
    // and the M1-10 sellable flows: onboarding (F1), API keys (F3), batch CSV (F4), billing (F7). No browser
    // needed; the authed assertions opportunistically use an ichnos-realm ROPC token. The negative-lookbehind
    // excludes `*.ui.spec.ts` (the @ui portal tier), which runs in the browser `ichnos-ui` project below.
    { name: 'ichnos-api', workers: 1, testMatch: /ichnos\/ichnos-.*(?<!\.ui)\.spec\.ts/, dependencies: ['setup'] },
    // Agora (eShop) — @api tier. Health probes, the full merchant-admin CRUD surface
    // (products / categories / coupons / stock / shop settings), and the cross-tenant
    // isolation rig. Seed-based, no browser, seconds.
    //
    // The testMatch was WIDENED from the ES-02 scaffold (which pinned the single
    // `agora-api.spec.ts` file and therefore silently ignored every spec added after
    // it). The negative lookbehind excludes `*.ui.spec.ts`, which is the browser tier
    // in the `agora-ui` project below — same split as ichnos.
    //
    // Every spec `test.skip`s gracefully when agora-api is unreachable or the merchant
    // credentials are unset, so this is safe to run in any environment.
    //
    // NO `dependencies: ['setup']` — deliberately. The `setup` project drives the LEGACY
    // BaseClient/katalogos browser login to bake a storageState. Agora needs none of it:
    // the @api tier mints its own agora-realm ROPC token and the @ui tier drives the real
    // BFF login form. Depending on `setup` only coupled this suite to an unrelated app's
    // availability — on staging that login fails, which took the whole Agora suite down
    // with it for a reason that has nothing to do with Agora.
    { name: 'agora-api', workers: 1, testMatch: /agora\/agora-.*(?<!\.ui)\.spec\.ts/ },
    // Agora @ui tier — the merchant admin driven in a real browser against the DEPLOYED
    // app (bff-agora serves the SPA same-origin, so baseURL is the BFF host).
    //
    // host-resolver-rules: on the dev PC, `staging.app.agora.dloizides.com` resolves via
    // the public *.dloizides.com catch-all to the PROD node, which does not serve this
    // app — so the browser would 404. Rather than require an admin-privileged Windows
    // hosts-file edit, map the host to the staging node for the browser process only.
    // AGORA_WEB_HOST_IP is unset in-cluster (where normal DNS already resolves), so this
    // adds no args there. ignoreHTTPSErrors: staging has no LE cert (WireGuard-only), so
    // Traefik serves its default self-signed cert — the deliberate standing posture.
    {
      name: 'agora-ui',
      workers: 1,
      testMatch: /agora\/.*\.ui\.spec\.ts/,
      use: {
        ...CHROME,
        ...(agoraWebUrl ? { baseURL: agoraWebUrl } : {}),
        ignoreHTTPSErrors: true,
        // NB: host-resolver-rules is NOT set here on purpose. The agora staging
        // hosts are in SAAS_STAGING_HOSTNAMES (fixtures/host-override.ts), so the
        // GLOBAL override in playwright.config.ts already MAPs them for the browser —
        // in ONE `--host-resolver-rules` flag with every staging host comma-joined.
        // Emitting a second flag here (as this project used to) does NOT merge: Chrome
        // honours only ONE `--host-resolver-rules` flag, so the later one silently WON
        // and dropped the agora rule, sending the browser to public DNS → prod → 404.
        // That was the whole "agora @ui lands on a 404" bug.
      },
      // No `setup` dependency — see the agora-api project above.
    },
    // --- Digital Kin PUBLIC guide site (Plan 3 Task 15) ----------------------
    // The site is ANONYMOUS end to end: no login, no cookies, no sessions. So no
    // `setup` dependency and no storageState — depending on `setup` would couple
    // this suite to an unrelated app's login, which is the coupling the agora
    // projects above were fixed to remove.
    //
    // ⚠️ NOT DEPLOYED UNTIL PLAN 6 (k8s manifest, ingress, DNS, TLS). Both tiers
    // `test.skip` with a reason while DIGITALKIN_SITE_URL is unset, so this is
    // safe to run in any environment and never fakes a pass.
    //
    // The negative lookbehind excludes `*.ui.spec.ts` — same @api/@ui split as
    // agora and ichnos.
    { name: 'digital-kin-api', workers: 1, testMatch: /digital-kin\/.*(?<!\.ui)\.spec\.ts/ },
    {
      name: 'digital-kin-ui',
      workers: 1,
      testMatch: /digital-kin\/.*\.ui\.spec\.ts/,
      use: {
        ...CHROME,
        ...(digitalKinSiteUrl ? { baseURL: digitalKinSiteUrl } : {}),
        // Staging has no LE cert (WireGuard-only), so Traefik serves its default
        // self-signed cert — the deliberate standing posture for this fleet.
        ignoreHTTPSErrors: true,
      },
    },
    // Ichnos @ui portal tier (F1 onboarding driven in a real browser). baseURL = ICHNOS_WEB_URL; the spec
    // `test.skip`s gracefully when it is unset (the dev PC can't reach WireGuard-only staging — this runs
    // in-cluster on the nightly runner). Matches only `ichnos/*.ui.spec.ts`.
    {
      name: 'ichnos-ui',
      workers: 1,
      testMatch: /ichnos\/.*\.ui\.spec\.ts/,
      use: { ...CHROME, ...(ichnosWebUrl ? { baseURL: ichnosWebUrl } : {}) },
      dependencies: ['setup'],
    },

    // ---- Zygos (payment ops back-office) — ZY-18, two-tier ----
    //
    // 🔴 BOTH tiers target the DEPLOYED console at ZYGOS_WEB_URL (default
    // https://app.zygos.dloizides.com), and there is no local/in-cluster alternative:
    //
    //  - zygos-api.dloizides.com DNS is not live (owner-gated) and zygos-api is a
    //    staging-placed workload, so the API's ONLY public path is through the BFF at
    //    `/bff/api/zygos/api/v1` — the same hop the browser takes.
    //  - the session rides a `__Host-bff-zygos` cookie, and `__Host-` cookies REQUIRE
    //    HTTPS by spec. A plain-HTTP in-cluster run cannot carry the session at all, so
    //    "just point it at the service DNS" is not available even in principle.
    //
    // No `setup` dependency, and no storageState: like agora, this suite mints its own
    // sessions (real /bff/login as the seeded zygos-realm fixture users). The shared
    // `setup` project bakes a KATALOGOS/BaseClient storageState that is inert here — and
    // depending on it once took the whole Agora suite down on staging for a reason that
    // had nothing to do with Agora. Every spec `test.skip`s gracefully when the console is
    // unreachable or the fixture users are unseeded.
    //
    // ignoreHTTPSErrors is deliberately NOT set: app.zygos.dloizides.com is a real Let's
    // Encrypt host, so a bad cert there is a genuine failure worth seeing.
    { name: 'zygos-api', workers: 1, testMatch: /zygos\/zygos-.*(?<!\.ui)\.spec\.ts/ },
    {
      name: 'zygos-ui',
      workers: 1,
      testMatch: /zygos\/.*\.ui\.spec\.ts/,
      use: { ...CHROME, baseURL: zygosWebUrl },
    },

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
    chunk('online-menus-crud', 'online-menus', ['menu-activation', 'menu-crud-with-activation', 'menu-display-order-sorting', 'bff-no-token-in-browser', 'logout-kills-server-session'], KAT),
    chunk('online-menus-editor-categories', 'online-menus', ['menu-editor-categories-focus', 'menu-editor-categories-crud', 'menu-editor-categories-switching', 'menu-duplicate-names'], KAT),
    chunk('online-menus-editor-uploads', 'online-menus', ['menu-content-upload-basic', 'menu-content-upload-create', 'menu-content-upload-advanced'], KAT),
    chunk('online-menus-public-preview', 'online-menus', ['menu-preview-and-external-link', 'menu-qr-code'], KAT),
    chunk('online-menus-public-viewer', 'online-menus', ['menu-public-page-load-basic', 'menu-public-page-load-viewer', 'menu-public-anon-cold-load', 'public-viewer-active-filtering-basic', 'public-viewer-active-filtering-states'], KAT),
    // Anonymous public-surface API test — no browser auth / tenant setup needed.
    { name: 'online-menus-custom-domain', workers: 1, testMatch: /online-menus\/custom-domain\.spec\.ts/ },

    // ---- Questioner (4 chunks) → erevna-web ----
    chunk('questioner-templates', 'questioner/templates', [], ERV),
    chunk('questioner-marketing', 'questioner/marketing', [], ERV),
    chunk('questioner-active', 'questioner/quiz-active', [], ERV),
    chunk('questioner-answers', 'questioner/quiz-answers', [], ERV),
    chunk('questioner-security', 'questioner/security', [], ERV),
    // Public/anonymous respondent flow — API-only (owner ROPC + no-auth context). ERV seeds the realm user; auth state is inert here.
    chunk('questioner-public', 'questioner/public', [], ERV),

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

    // ---- Accessibility (axe) on PUBLIC no-auth surfaces ----
    // Standalone project: scans erevna/katalogos public /login + the kefi
    // marketing landing with axe-core. No auth, no multi-tenant deps, no
    // baseURL override — the spec uses absolute URLs (per-target env, prod
    // fallback). Read-only navigation + an axe scan, so safe against local /
    // staging / prod. See tests/a11y/a11y.spec.ts + helpers/a11y.ts.
    {
      name: 'a11y-public',
      workers: 1,
      testMatch: /a11y\/.*\.spec\.ts/,
      use: CHROME,
    },

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
    {
      // Kefi Phase F (#159) — a FREE tenant signs up, publishes (no Pro gate),
      // and its page renders dynamically from config. Like kefi-lifecycle this
      // drives a real signup → wizard → publish (kaniko build + kefi-landings
      // rollout, 60-240s) then probes the canary's own /t/<slug>/ page.
      name: 'kefi-free-publish',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-free-publish\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi Phase 13 lifecycle emails (#185) — signs up a canary tenant, then
      // exercises registration-confirmation + reminder (+dedup) + unsubscribe +
      // thank-you through the real surfaces (public register, the canary-scoped
      // seeding endpoints, the trigger sweeps, IMAP). Multiple IMAP waits +
      // sweeps → 600s budget like its siblings.
      name: 'kefi-email-lifecycle',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-email-lifecycle\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi crew-lifecycle (#267) — the full "from registration all the way"
      // chain: register → verify → onboard → invite crew → each crew member logs
      // in with the right role + tenantId. Three tests: @api (fast, no browser),
      // @ui (real signup + wizard + a real sign-in), @slow (duplicate landing +
      // publish/kaniko). Signup + IMAP verify + the publish build dominate the
      // wall-clock → 600s budget like its kefi siblings.
      name: 'kefi-crew-lifecycle',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-crew-lifecycle\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi #177 attendee Stripe-Checkout payments — signs up a canary tenant,
      // stores dummy Stripe credentials, then proves the webhook reconciliation
      // path (paid + idempotent replay + bad-signature + refund) with synthetically
      // signed events (no external Stripe account needed). Layer 2 mints a real
      // hosted session only when E2E_KEFI_STRIPE_TEST_SECRET is set. Signup + IMAP
      // verify + multiple webhook round-trips → 600s budget like its siblings.
      name: 'kefi-attendee-payment',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-attendee-payment\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi QR ticket render + door check-in (KEFI-1 gap) — signs up a canary
      // tenant (signup + IMAP verify + wizard), seeds a Published event, then
      // proves the attendee-ticket path through the real surfaces: register
      // mints an HMAC token, the public ticket endpoint renders/verifies it,
      // a tampered/bogus token 404s, the confirmed→checked-in lifecycle is
      // reflected on the ticket, a double check-in is an idempotent no-op, and
      // the door-staff door list is role-gated. Signup + IMAP verify dominate
      // the wall-clock → 600s budget like its kefi siblings.
      name: 'kefi-qr-checkin',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-qr-checkin\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi #4 per-event publish — one tenant signs up (signup + IMAP verify +
      // wizard), creates a SECOND event, publishes both at distinct per-event
      // slugs, edits a slug, and proves a registration books the named event.
      // API-driven beyond the shared signup→wizard rig; the single IMAP verify
      // wait dominates the wall-clock. 600s budget like its kefi siblings.
      name: 'kefi-multi-event-publish',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-multi-event-publish\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi #5 custom domains — one tenant signs up (signup + IMAP verify +
      // wizard), then exercises the custom-domain API contract: set a subdomain
      // (CNAME instructions), reject apex, verify a non-resolving domain (Failed),
      // optionally verify a wildcard-covered host (Active, via KEFI_CD_TEST_DOMAIN),
      // and clear. API-driven beyond the shared signup→wizard rig; the IMAP verify
      // wait dominates. 600s budget like its kefi siblings.
      name: 'kefi-custom-domain',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-custom-domain\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi KEFI-2 freemium gates — one tenant signs up (signup + IMAP verify +
      // wizard) on the DEFAULT Free plan, then asserts a Free tenant is 403 on a
      // 2nd event, a custom domain, and a stripe-credentials store (clear stays
      // allowed), and that a platform-admin Pro grant unblocks the same three
      // calls. API-driven beyond the shared signup→wizard rig; the IMAP verify
      // wait dominates. 600s budget like its kefi siblings.
      name: 'kefi-pro-gates',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-pro-gates\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi KEFI-2 freemium gates — FAST API-contract tier (`@api`). NO browser
      // and NO signup/IMAP/wizard: a platform-admin createTenant mints a Free
      // tenant and KC master-admin provisions a no-wizard ROPC-able owner, then
      // the 403/2xx gate contract is asserted directly against kefi-api. Lands in
      // seconds (vs the wizard-based spec's minutes); master-admin-only (staging).
      // 120s ceiling is generous head-room — the real run is a handful of seconds.
      name: 'kefi-pro-gates-api',
      workers: 1,
      timeout: 120_000,
      testMatch: /kefi\/kefi-pro-gates-api\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi KEFI-2 freemium gates — FULL UI tier (`@ui`). Real browser: one
      // tenant signs up (signup + IMAP verify + FREE wizard), then the spec
      // asserts the ProGateCard locks + upgrade CTAs render, the CTA routes to
      // /organizer/pricing, and a Pro grant + reload reveals the real forms.
      // Signup + IMAP verify dominate the wall-clock → 600s budget like its
      // kefi siblings.
      name: 'kefi-pro-gates-ui',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-pro-gates-ui\.spec\.ts/,
      use: CHROME,
    },
    {
      name: 'kefi-device-pin',
      workers: 1,
      // Generous: the BFF's per-IP rate limiter (5 req/60s) sits in front of the
      // device-PIN endpoints, so the lockout phase deliberately waits between
      // attempts — the wall-clock is dominated by those waits, not by work.
      timeout: 360_000,
      testMatch: /kefi\/kefi-device-pin-unlock\.spec\.ts/,
      use: CHROME,
    },
    {
      name: 'kefi-passkey',
      workers: 1,
      // Signup + IMAP verify (~60s budget) + two full Keycloak redirect dances
      // (registration re-auth + ceremony, then the passkey login ceremony), each
      // with a 90s drive budget. CDP virtual authenticator does the WebAuthn part.
      timeout: 360_000,
      testMatch: /kefi\/kefi-passkey-login\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi interactive email-OTP login (request→verify) — closes the gap the
      // magic-link specs left. Reuses defineOtpLoginTest; baseURL = the kefi web
      // host (KEFI_WEB_URL per E2E_TARGET); seeded kefi-realm otp-bot + bot mailbox.
      name: 'kefi-otp-login',
      workers: 1,
      timeout: 360_000,
      testMatch: /kefi\/kefi-otp-login\.spec\.ts/,
      use: { ...CHROME, ...(kefiWebUrl ? { baseURL: kefiWebUrl } : {}) },
    },
    {
      // Kefi back-office manual subscription override (KEFI-1 punch-list #1) —
      // platform super-admin marks a tenant Pro WITHOUT Stripe via
      // PUT /platform/tenants/{id}/subscription, then the spec asserts persist +
      // the 400 (bad plan) / 403 (non-admin) walls. Pure-API: create tenant +
      // a few admin calls + one non-admin ROPC mint — no signup/wizard/IMAP, so
      // it finishes in seconds. Standard timeout is plenty.
      name: 'kefi-backoffice-approval',
      workers: 1,
      testMatch: /kefi\/kefi-backoffice-approval\.spec\.ts/,
      use: CHROME,
    },
    {
      // Password-reset revokes remembered devices (unified-login #169 Batch 6
      // Seam 1). Signup + IMAP verify + PIN enrol + forgot/reset email round-trip
      // + the stale-device 401 assertion. Timeout is dominated by the per-IP
      // BffAuth rate limiter (5 req/60s) that every auth call polls through.
      name: 'kefi-reset-revokes-devices',
      workers: 1,
      timeout: 360_000,
      testMatch: /kefi\/kefi-reset-revokes-devices\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi registration-request submit → approve/reject (#276 gap #1). @api: the
      // full submit→list→approve/reject state machine (master-admin provisions the
      // Pro tenant + owner + ambassador). @ui: the organizer approvals surface. The
      // signup/@ui leg's IMAP verify + the master-admin provisioning dominate the
      // wall-clock → 600s budget like its kefi siblings.
      name: 'kefi-registration-approval',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-registration-approval\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi critical path (#276 gap #2) — registration → approval → payment
      // (signed Stripe webhook) → door check-in, chained end-to-end. @slow: spans
      // approval + a webhook round-trip + reconciliation (no kaniko). 600s budget.
      name: 'kefi-critical-path',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-critical-path\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi organizer attendee bulk-import (#265 / #276 gap #3) — JSON + multipart
      // CSV import, dedup-by-email, per-row errors. Pure @api (master-admin
      // provisions the tenant); no browser/IMAP → the standard-ish 300s is plenty.
      name: 'kefi-attendee-import',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-attendee-import\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi organizer hard-delete-attendee (#278) — import one attendee then
      // delete it; assert the row is gone; cross-tenant/unknown → 404. Pure @api
      // (master-admin provisions the tenant); no browser/IMAP → 300s is plenty.
      name: 'kefi-attendee-delete',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-attendee-delete\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi organizer dashboard / P&L (#276 gap #4) — seeds genuinely-paid
      // attendees via the import path (RecordPayment moves gross/net) and asserts
      // the P&L numbers + the Draft-event safe-zeros case. Pure @api → 300s budget.
      name: 'kefi-organizer-pnl',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-organizer-pnl\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi role-surface render smoke (#276 gap #5) — dj / media / ambassador /
      // audit dashboards each render for their role without tripping the error
      // boundary. @ui: a fresh browser context per role user (master-admin
      // provisions them). Multiple logins → 600s budget.
      name: 'kefi-role-surfaces',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-role-surfaces\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi published poster + pass RENDER (#266 / #276 gap #7) — publishes a
      // landing carrying price tiers + a real-image poster and asserts they RENDER
      // on the served page (extends publish coverage from "published" to
      // "rendered"). @slow: kaniko publish build → 900s test budget, 600s poll.
      name: 'kefi-poster-passes-render',
      workers: 1,
      timeout: 900_000,
      testMatch: /kefi\/kefi-poster-passes-render\.spec\.ts/,
      use: CHROME,
    },
    {
      // Kefi attendee GDPR export + erasure (#276 gap #6) — anonymous, ticket-token
      // keyed data-subject export + right-to-erasure (idempotent). Pure @api
      // (master-admin seeds the event) → 300s budget.
      name: 'kefi-gdpr',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-gdpr\.spec\.ts/,
      use: CHROME,
    },
    // ---- UBB pre-sale suite (tiered pricing / pass numbers / ticket) ----
    // Grouped as one block rather than four scattered entries to keep this file
    // from growing further. All three drive the PUBLISHED UBB fixture tenant,
    // register their own rows through the real public route, delete them in
    // `finally`, and assert the roster returns to its starting size — UBB holds
    // REAL pre-sale attendees that must never be touched.
    // The register route is rate-limited 5/60s per IP → workers:1 + a generous
    // budget, since `registerWithBackoff` waits out a full 60s window on a 429.
    ...(
      [
        // Tiered pricing — window contiguity (no gap/overlap), the Cyprus-local
        // -midnight boundaries, ascending prices, and the FlatPrice backward-
        // compat control for every non-tiered pass. Pure reads.
        'kefi-ubb-tiered-pricing',
        // Price parity — the money surface. Asserts every surface that QUOTES a
        // price agrees with the one that CHARGES it, ending in the suite's
        // central assertion: what the register FORM shows === what the server
        // RECORDS. Registers one attendee and deletes it.
        'kefi-ubb-price-parity',
        // Pass numbers — uniqueness across the live roster, presence on the
        // ledger/ticket/CSV, and the never-renumbered stability guarantee.
        'kefi-ubb-pass-numbers',
        // Ticket surface — the payload, `payment: null` (not a hollow object),
        // the no-secret-leak scan on a token-only public endpoint, the forged
        // token wall, and the absolute-and-resolving ticketUrl.
        'kefi-ubb-ticket-surface',
        // Back-office → public ticket — the CROSSING. Every sibling verifies one
        // surface against itself; this one writes as the organizer (authed admin
        // route) and reads as the attendee (anonymous HMAC token), which is the
        // only way to prove confirm-payment and mark-attended actually reach the
        // buyer's own ticket. Registers its own rows and deletes them.
        'kefi-ubb-payment-to-ticket',
      ] as const
    ).map((specName) => ({
      name: specName,
      workers: 1,
      timeout: 600_000,
      testMatch: new RegExp(`kefi/${specName}\\.spec\\.ts`),
      use: EVENT_OPS_BROWSER,
    })),
    {
      // UBB at PHONE width — the first phone-viewport coverage in this repo.
      // Separate project rather than a member of the block above because it is
      // the ONLY one that must not run at desktop width: its `use` is the test.
      // Measures geometry without scrolling, since Playwright's actionability
      // auto-scroll is exactly what hides an off-screen pay button.
      name: 'kefi-ubb-mobile',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-ubb-mobile\.spec\.ts/,
      use: EVENT_OPS_MOBILE,
    },
    // ---- UBB mobile: ambassador picker + organizer promoter table ----------
    // One project PER DEVICE CLASS rather than one project running three
    // viewports, because the device is the variable under test: a failure has
    // to name the screen it happened on ("...[ubb-picker-iphone-se]") or the
    // report cannot tell "broken everywhere" from "broken on the small one",
    // which is the entire question being asked here.
    ...(
      [
        { suffix: 'iphone-375', device: UBB_PHONE_SE },
        { suffix: 'iphone-390', device: UBB_PHONE_MODERN },
        { suffix: 'ipad-mini', device: UBB_TABLET },
      ] as const
    ).flatMap(({ suffix, device }) => [
      {
        // The ambassador picker on the public register form. Drives a LOCAL
        // kefi-landings build by default (KEFI_LANDINGS_PREVIEW_URL) because
        // UBB's published site does not carry the picker until it is
        // republished — see the spec header. Never writes to production.
        name: `ubb-picker-${suffix}`,
        workers: 1,
        timeout: 300_000,
        testMatch: /kefi\/kefi-ubb-mobile-picker\.spec\.ts/,
        use: device,
      },
      {
        // The picker's resilience (endpoint down / empty) + its geometry.
        // Split from the behaviour spec purely to keep both files readable.
        name: `ubb-picker-resilience-${suffix}`,
        workers: 1,
        timeout: 300_000,
        testMatch: /kefi\/kefi-ubb-picker-resilience\.spec\.ts/,
        use: device,
      },
      {
        // The attendee ticket at this width. Invalid-token path only — see the
        // spec header on why a valid ticket is not rendered against UBB.
        name: `ubb-ticket-${suffix}`,
        workers: 1,
        timeout: 300_000,
        testMatch: /kefi\/kefi-ubb-ticket-mobile\.spec\.ts/,
        use: device,
      },
      {
        // The organizer promoter table's card-stack below 768px. Read-only
        // against the deployed kefi-web: it never presses Retire, which would
        // write to the live tenant.
        name: `ubb-promoters-${suffix}`,
        workers: 1,
        timeout: 600_000,
        testMatch: /kefi\/kefi-ubb-promoters-mobile\.spec\.ts/,
        use: device,
      },
    ]),
    // ---- Kefi event-ops suite (shipped door/ledger/access-link surfaces) ----
    // `use` for the browser-driving legs. The global navigationTimeout is 15s,
    // which is too tight for a COLD load of the kefi-web Expo bundle or a static
    // tenant landing page — the suite failed intermittently on `page.goto`
    // timeouts that had nothing to do with the product. Raised here only, so the
    // rest of the matrix keeps its tighter budget.

    // These drive a PUBLISHED fixture tenant (KEFI_FIXTURE_*) rather than a
    // canary, because the register/door/ledger pages are STATIC Astro routes
    // baked per slug at publish time — a fresh canary slug has no page until a
    // kaniko rebuild. Each spec creates and then deletes/revokes its own rows.
    // See E2ETests/docs/kefi-event-ops-e2e.md.
    {
      // Public self-registration — the consent-required regression (a real prod
      // incident), the invalid pass code, the unknown tenant, plus the real
      // static register form. The register route is rate-limited 5/60s per IP,
      // and the client waits the window out on a 429 → generous budget.
      name: 'kefi-public-registration',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-public-registration\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Mark-attendee-paid both directions (@api) + the organizer Paid/Unpaid
      // toggle (@ui). The @ui leg logs in to kefi-web → 600s like its siblings.
      name: 'kefi-mark-paid',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-mark-paid\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Attendee CSV export — exact header row, row-count parity with the API,
      // RFC-4180 escaping verified with an independent parser. Pure @api → 300s.
      name: 'kefi-attendee-export',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-attendee-export\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Access links — mint/list/revoke, the revoked-token wall, and the
      // scope-filtering contract (Ledger sees pnl, Door sees people-not-money,
      // Promoter sees only their own slice). Pure @api → 300s.
      name: 'kefi-access-links',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-access-links\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Access-link EXPIRY / one-time — the expiry window + its validation, the
      // Used-on-first-touch stamp (asserted via the organizer status, because the
      // 30-minute grace window makes the hard 404 untestable in a spec), and the
      // 404-for-every-dead-reason vs 403-for-wrong-page distinction the door and
      // crew pages branch on. Pure @api → 300s.
      name: 'kefi-access-link-expiry',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-access-link-expiry\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // The 404-vs-403 wall on its own: a dead link (revoked / unknown / right-
      // shape-wrong-value) is 404 for EVERY reason so a leaked link cannot be
      // fingerprinted, while a LIVE token on an action it lacks rank for is 403.
      // The door/ledger/crew pages render those two codes as two different
      // screens, so collapsing them is a user-visible bug. Pure @api → 300s.
      name: 'kefi-access-link-dead-vs-forbidden',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-access-link-dead-vs-forbidden\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Message templates — the per-event email/WhatsApp copy. Pins the two bugs
      // that shipped here: `channel` is immutable and the server IGNORES it on a
      // PUT (FastEndpoints discards undeclared fields, so the old portal claimed
      // success while nothing changed), and an unknown {{token}} renders as the
      // EMPTY STRING rather than echoing back into a recipient's inbox. Plus
      // create/list/delete, the subject-per-channel rule and the one-default-per-
      // channel invariant. Pure @api → 300s.
      name: 'kefi-message-templates',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-message-templates\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Message-template CRUD — create/list/delete, the validation walls, the
      // authorization walls, and the subject-per-channel rule (an Email template
      // keeps its subject; a WhatsApp one drops a submitted subject rather than
      // storing one the channel cannot use). Pure @api → 300s.
      name: 'kefi-message-templates-crud',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-message-templates-crud\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Message-template DEFAULTS — "at most one default per (event, channel)",
      // enforced twice (use case + filtered unique index) and therefore able to
      // disagree with itself.
      //
      // ⚠️ EXPECTED RED: promoting an OLDER template to default via PUT returns
      // 500 (EF emits the promote UPDATE before the demote UPDATE, tripping
      // IX_EventMessageTemplates_EventId_Channel_Default). Left failing on
      // purpose — it is a real server bug, not a flaky test. Pure @api → 300s.
      name: 'kefi-message-template-defaults',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-message-template-defaults\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Crew payout page — the promoter's own view. @api pins the payout against
      // the organizer's P&L line (they read the same number by construction); @ui
      // pins the three outcome panels apart, because "your link is dead" and
      // "your link is for a different page" used to be the same screen. Browser
      // leg + a crew-terms write/restore → 600s.
      name: 'kefi-crew-payout',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-crew-payout\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Crew LINK STATES — which of the three outcome panels the crew page shows
      // for a Promoter link, a live-but-wrong Door link, a revoked link and no
      // link at all. Pins "wrong page" apart from "dead link", which the page
      // used to conflate. @ui, three page loads → 600s.
      name: 'kefi-crew-link-states',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-crew-link-states\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Print / Save-as-PDF affordance across door + ledger + crew. Deliberately
      // shallow (stylesheet + control presence, no real PDF): what regresses is
      // one of three near-identical pages losing the affordance while the others
      // keep it. Token-free @ui, creates nothing → 300s.
      name: 'kefi-print-affordance',
      workers: 1,
      timeout: 300_000,
      testMatch: /kefi\/kefi-print-affordance\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Door check-in — persistence-verified toggle + the Promoter-cannot-check-in
      // scope wall (@api), and the real door page (@ui). 600s for the browser leg.
      name: 'kefi-door-checkin',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-door-checkin\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Ledger / P&L — internal consistency of the computed numbers (@api) and
      // the rendered ledger page (@ui). 600s for the browser leg.
      name: 'kefi-ledger-pnl',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-ledger-pnl\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // ⚠️ REGRESSION GUARD: once ANY access link existed, the organizer surface
      // crashed on load (`null.toLowerCase` on a list row). Mint a Door link,
      // then load the dashboard and assert it renders. Must never regress.
      name: 'kefi-organizer-access-link-regression',
      workers: 1,
      timeout: 600_000,
      testMatch: /kefi\/kefi-organizer-access-link-regression\.spec\.ts/,
      use: EVENT_OPS_BROWSER,
    },
    {
      // Katalogos device-PIN + passkey via the SHARED auth-web 1.4.0 components
      // (unified-login Increment 3). Uses the seeded realm test user + the global
      // baseURL (katalogos-web per E2E_TARGET) — no canary signup/IMAP needed.
      // Timeout: the lockout phase deliberately waits out the per-IP rate limiter.
      name: 'katalogos-login-methods',
      workers: 1,
      timeout: 360_000,
      testMatch: /identity\/katalogos-device-pin-passkey\.spec\.ts/,
      // multi-tenant-setup seeds the tenant-scoped users the preferred-method
      // (D5) test logs in as — the write needs a tenantId the superUser lacks.
      dependencies: ['multi-tenant-setup'],
      use: CHROME,
    },
    {
      // Erevna device-PIN + passkey — same shared suite, erevna-web baseURL
      // (questioner realm). See helpers/login-methods-suite.ts.
      name: 'erevna-login-methods',
      workers: 1,
      timeout: 360_000,
      testMatch: /identity\/erevna-device-pin-passkey\.spec\.ts/,
      dependencies: ['multi-tenant-setup'],
      use: { ...CHROME, ...(erevnaUrl ? { baseURL: erevnaUrl } : {}) },
    },
    {
      // SEC-2 — sign-out must END the IdP session, across kefi / katalogos / erevna / poueni.
      // Asserts the contract that BITES (after sign-out a fresh authorize must PROMPT for
      // credentials), NOT the hollow "/bff/me returns 401" — which passes even while the bug
      // is live. Carries its own controls (a live session must still silently re-auth; a
      // password/ROPC sign-out must NOT navigate to the IdP), so the suite cannot go green
      // vacuously. Absolute per-app URLs from env; serial, since each app signs in for real.
      name: 'sec2-logout',
      workers: 1,
      timeout: 300_000,
      testMatch: /identity\/sec2-front-channel-logout\.spec\.ts/,
      use: CHROME,
    },
    {
      // Poueni passkey — the Vite dashboard's passkey-only rollout (no PIN leg;
      // see the Poueni decision in the Increment-3 task doc). Absolute URLs via
      // getPoueniUrls(); seeded poueni-realm test user.
      name: 'poueni-passkey',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-passkey\.spec\.ts/,
      use: CHROME,
    },
    {
      // Poueni device-PIN — the Vite dashboard's PIN-unlock rollout (#173).
      // Absolute URLs via getPoueniUrls(); seeded poueni-realm test user.
      name: 'poueni-device-pin',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-device-pin\.spec\.ts/,
      use: CHROME,
    },

    // ---- Poueni forgot/reset-password E2E ----
    // Standalone — signs up a canary tenant, verifies, then drives the full
    // forgot→reset→login round-trip in a real browser. Timeout: two IMAP waits.
    {
      name: 'poueni-password-reset',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-password-reset\.spec\.ts/,
      use: CHROME,
    },

    // ---- Poueni dual-marker live-map E2E (#184) ----
    // Standalone — signs up a fresh canary tenant, verifies, logs into the
    // dashboard, mints an API key, posts dual GPS+ML presence beacons, then
    // asserts the /live map renders both markers + the GPS↔ML error. Timeout
    // override: one IMAP wait (verify, ~30s typical / 90s budget) plus a login.
    {
      name: 'poueni-live-map',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-live-map\.spec\.ts/,
      use: CHROME,
    },

    // ---- Poueni GDPR data-subject E2E (#180-completeness, Art. 15 + 17) ----
    // Signs up a canary tenant, mints an API key, posts a contribution, then
    // exercises export → erase → export to prove erasure works + the audit row
    // survives. API-driven; needs real Maddy + KC for the signup/login.
    {
      name: 'poueni-gdpr',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-gdpr\.spec\.ts/,
      use: CHROME,
    },

    // ---- Poueni canary-cleanup E2E (#188/#184) ----
    // Verifies the purge endpoint and doubles as the recurring teardown that
    // drains accumulated poueni canary tenants on the nightly suite.
    {
      name: 'poueni-canary-cleanup',
      workers: 1,
      timeout: 300_000,
      testMatch: /poueni\/poueni-canary-cleanup\.spec\.ts/,
      use: CHROME,
    },

    // ---- Gate B — post-deploy real-UI login probe (P0-02) + golden paths ----
    // Drives each product's ACTUAL rendered login UI (real pointer/keyboard) on
    // the live public URL and asserts it lands on an authed route that renders
    // (not the P0-01 error boundary). The permanent net for dead Sign-in
    // buttons / post-login dead-ends that the API-level login path can't catch.
    // Every `prod-gate/*.spec.ts` is auto-collected by the testMatch glob — incl.
    // the Move-7 golden-path specs ({erevna-survey,kefi-event,katalogos-menu}-
    // golden-path) that fail the gate on UX breakage, not just crashes.
    // Run against prod/staging: `E2E_TARGET=prod npx playwright test --project=prod-gate`.
    // Reads per-product baseURL + creds from .env.<target>(.secrets); each spec
    // self-skips if its creds/env are absent. Longer timeout: RN-web hydrate + a
    // real Keycloak/BFF round-trip (golden-path specs raise it per-test as needed).
    {
      name: 'prod-gate',
      workers: 1,
      timeout: 90_000,
      testMatch: /prod-gate\/.*\.spec\.ts/,
      use: CHROME,
    },
  ];
}
