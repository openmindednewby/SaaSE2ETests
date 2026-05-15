/**
 * Canary global-setup — runs when `E2E_TARGET in {staging, prod}` (wired up
 * by `playwright.config.ts`).
 *
 * Responsibilities (see `BaseClient/docs/Tasks/IN_PROGRESS/phase-2-canary-infrastructure.md`
 * "E2E side" section + `phase-2-e2e-lifecycle-wiring.md`):
 *
 *   1. Generate a per-invocation run UUID and expose it via process.env so
 *      every worker, every helper, every test sees the same value:
 *        - E2E_CANARY_RUN_ID         (full UUID — used by cleanup endpoints)
 *        - E2E_CANARY_PREFIX         (`e2ec-{runId8}-` — used by canaryName())
 *
 *   2. Mint a superUser JWT + refresh token from the target Keycloak and
 *      stash them in:
 *        - E2E_CANARY_ACCESS_TOKEN
 *        - E2E_CANARY_REFRESH_TOKEN
 *      (Consumed by `helpers/canary-prefix.ts → canaryHeaders()` and by the
 *      auth fixture for injection.)
 *
 *   3. Defer to the legacy `global-setup.ts` for everything else (browser
 *      storage state, auth file write, frontend probe). Re-using the legacy
 *      function keeps the suite-wide auth flow stable while the canary layer
 *      adds the run-ID metadata on top.
 *
 *   4. Log the runId LOUDLY so a failed run is traceable to the exact
 *      `e2ec-{runId8}-*` records left in the DB / SeaweedFS / Keycloak.
 *
 * Failure-handling: minting the superUser JWT failing is a fatal setup error
 * for staging/prod (no JWT → cleanup endpoint calls in teardown will be 401 →
 * orphan accumulation). We log loudly but still defer to the legacy setup so
 * read-only suites can complete; data-creating suites WILL fail at test time
 * with a meaningful error instead of silently leaking.
 */
import * as crypto from 'node:crypto';
import type { FullConfig } from '@playwright/test';

import { AuthHelper } from '../helpers/auth-helper.js';
import { acquireCanaryLock } from '../helpers/canary-lock.js';
import { loadE2EEnv } from './env-loader.js';
import { installHostOverride } from './host-override.js';
import legacyGlobalSetup from './global-setup.js';

// Load env files for the chosen target, install host-override (no-op for prod).
loadE2EEnv();
installHostOverride();

function genRunId(): string {
  // Node 19+ has crypto.randomUUID; the E2ETests project targets ES2022 +
  // node:crypto so this is safe. Fallback to the manual hex form if for any
  // reason it isn't available (defensive — should never fire).
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  // Set version (4) + variant (10xx) bits per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function canaryGlobalSetup(config: FullConfig): Promise<void> {
  // ---------- 1. Generate run ID + publish to env ----------
  // Honor a pre-set E2E_CANARY_RUN_ID: the in-cluster wrapper
  // (scripts/run-canary-incluster.mjs) generates the runId BEFORE spawning
  // `playwright test` so it can address the SeaweedFS report path + the lock
  // ConfigMap by the same id. Dev-PC runs leave it unset → genRunId() here.
  const runId = process.env.E2E_CANARY_RUN_ID && process.env.E2E_CANARY_RUN_ID.length > 0
    ? process.env.E2E_CANARY_RUN_ID
    : genRunId();
  const runIdShort = runId.slice(0, 8);
  const prefix = `e2ec-${runIdShort}-`;

  process.env.E2E_CANARY_RUN_ID = runId;
  process.env.E2E_CANARY_PREFIX = prefix;

  const target = process.env.E2E_TARGET ?? 'local';

  // Loud, easily-greppable banner — appears once per `npx playwright test` invocation.
  process.stdout.write(
    [
      '',
      '═══════════════════════════════════════════════════════════',
      `  E2E CANARY RUN — target=${target}`,
      `  runId          = ${runId}`,
      `  prefix         = ${prefix}`,
      '═══════════════════════════════════════════════════════════',
      '',
    ].join('\n'),
  );

  // ---------- 1b. Acquire the concurrent-run lock ----------
  // Hard lock per the parent design's "Concurrent-run handling" section.
  // Throws (aborting the whole run) when another canary run is already in
  // progress against this target. Best-effort when kubectl is unavailable
  // (dev PC with no kube-context) — see helpers/canary-lock.ts.
  acquireCanaryLock(runId);

  // ---------- 2. Mint superUser JWT + refresh token ----------
  const identityApiUrl = process.env.IDENTITY_API_URL;
  // The canary cleanup endpoints require a superUser JWT. The dedicated
  // SUPERUSER_* vars are the design-preferred names (see parent design), but
  // we fall back to TEST_USER_* for backward-compat with the existing
  // .env.staging.secrets which seeds superUser into TEST_USER_USERNAME.
  const superUsername = process.env.SUPERUSER_USERNAME ?? process.env.TEST_USER_USERNAME;
  const superPassword = process.env.SUPERUSER_PASSWORD ?? process.env.TEST_USER_PASSWORD;

  if (!identityApiUrl) {
    process.stderr.write(
      '[canary-setup] WARN: IDENTITY_API_URL unset. Cannot mint superUser JWT.\n' +
        '  Cleanup endpoints in global-teardown will be unable to authenticate.\n',
    );
  } else if (!superUsername || !superPassword) {
    process.stderr.write(
      '[canary-setup] WARN: SUPERUSER_USERNAME/PASSWORD (or TEST_USER_*) unset.\n' +
        '  Cleanup endpoints in global-teardown will be unable to authenticate.\n',
    );
  } else {
    try {
      const auth = new AuthHelper(identityApiUrl);
      const tokens = await auth.loginViaAPI(superUsername, superPassword);
      if (tokens.accessToken) {
        process.env.E2E_CANARY_ACCESS_TOKEN = tokens.accessToken;
      }
      if (tokens.refreshToken) {
        process.env.E2E_CANARY_REFRESH_TOKEN = tokens.refreshToken;
      }
      process.stdout.write(
        `[canary-setup] minted superUser JWT (user=${superUsername}, target=${target})\n`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `[canary-setup] ERROR minting superUser JWT (user=${superUsername}): ${msg}\n` +
          '  Read-only suites will still run; data-creating suites will fail at test time.\n' +
          '  Cleanup endpoints in global-teardown will be skipped.\n',
      );
    }
  }

  // ---------- 3. Defer to the legacy setup for everything else ----------
  // The legacy setup handles: browser storage state for auth.fixture.ts,
  // playwright/.auth/user.json file, frontend probe, friendly error messages.
  // The canary layer above is additive — legacy callers see the same shape.
  await legacyGlobalSetup(config);
}

export default canaryGlobalSetup;
