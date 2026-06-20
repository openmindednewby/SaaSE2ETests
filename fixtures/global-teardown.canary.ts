/**
 * Canary global-teardown — calls the per-service `canary-cleanup` endpoints
 * shipped by Phase 2 slices 1-6 (Identity, Payment, Notification, OnlineMenu,
 * Questioner, Content). Wired up by `playwright.config.ts` when
 * `E2E_TARGET in {staging, prod}`.
 *
 * Contract per slice (verbatim from the slice docs):
 *
 *   DELETE {SERVICE_API_URL}/api/v1/internal/canary-cleanup?runId={uuid}
 *   Authorization: Bearer <superUser JWT>
 *
 * Idempotent. Returns `{ runId, <entity-counts...> }`. Logs counts. ANY error
 * (network, 4xx, 5xx) is swallowed with a loud `[canary-teardown]` WARN; the
 * test suite's pass/fail status is whatever Playwright reports — teardown
 * must never mask test failures. Per parent design's failure-mode matrix,
 * the orphan-cleanup CronJob is the safety net for missed cleanup.
 *
 * Service URL env var contract — already used elsewhere in the suite (see
 * `helpers/auth-helper.ts`, `tests/multi-tenant.teardown.ts`,
 * `helpers/subscription-admin.ts`):
 *
 *   IDENTITY_API_URL            — IdentityService
 *   PAYMENT_API_URL             — PaymentService
 *   NOTIFICATION_SERVICE_URL    — NotificationService
 *   ONLINEMENU_API_URL          — OnlineMenuService
 *   QUESTIONER_API_URL          — QuestionerService
 *   CONTENT_API_URL             — ContentService
 *
 * Note the legacy `multi-tenant.teardown.ts` does a non-canary delete of
 * `e2e-Tenant{A,B,C}` users + tenants. The canary teardown does NOT replicate
 * that — the canary cleanup endpoints sweep by `e2ec-{runId8}-` prefix only,
 * which is exactly the design intent (zero-pollution per run). If the suite
 * is running in canary mode, multi-tenant.setup.ts must use canary-prefixed
 * names so those records ARE swept by the IdentityService cleanup endpoint.
 */
import type { FullConfig } from '@playwright/test';
import axios, { type AxiosInstance } from 'axios';

import { releaseCanaryLock } from '../helpers/canary-lock.js';
import { sharedHttpsAgent } from '../helpers/http-agent.js';

interface CleanupServiceConfig {
  /** Human-readable label used in log lines. */
  name: string;
  /** Env var holding the service's base URL. */
  envVar: string;
  /** Realm header to attach (only IdentityService needs this — keep optional for others). */
  realm?: string;
}

const SERVICES: ReadonlyArray<CleanupServiceConfig> = [
  // IdentityService is FIRST. Identity owns tenants + Keycloak users — if
  // it fails, the rest still attempt their sweeps. Per the parent design's
  // failure-mode matrix, partial cleanup is acceptable.
  { name: 'IdentityService', envVar: 'IDENTITY_API_URL', realm: process.env.IDENTITY_REALM ?? 'OnlineMenu' },
  { name: 'PaymentService', envVar: 'PAYMENT_API_URL' },
  { name: 'NotificationService', envVar: 'NOTIFICATION_SERVICE_URL' },
  { name: 'OnlineMenuService', envVar: 'ONLINEMENU_API_URL' },
  { name: 'QuestionerService', envVar: 'QUESTIONER_API_URL' },
  { name: 'ContentService', envVar: 'CONTENT_API_URL' },
];

function normalizeBaseUrl(rawUrl: string): string {
  if (rawUrl.endsWith('/api/v1/')) return rawUrl;
  if (rawUrl.endsWith('/api/v1')) return `${rawUrl}/`;
  if (rawUrl.endsWith('/')) return `${rawUrl}api/v1/`;
  return `${rawUrl}/api/v1/`;
}

function createCleanupClient(baseUrl: string, accessToken: string, realm: string | undefined, runId: string): AxiosInstance {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    // Tag the cleanup call as canary traffic too — the cleanup is itself part
    // of the canary lifecycle, so it should show up in the
    // `canary_http_requests_total` Prometheus counter
    // (Metrics.Client.HttpMetricsMiddleware). The endpoint is role-gated, not
    // header-gated, so the header is purely additive for tagging.
    'X-Canary-Run-Id': runId,
  };
  // X-Realm only matters for IdentityService (multi-realm gating). Other
  // services accept the header harmlessly when present — it's safer to set
  // it everywhere than to special-case Identity.
  if (realm) headers['X-Realm'] = realm;

  return axios.create({
    baseURL: normalizeBaseUrl(baseUrl),
    timeout: 30000,
    headers,
    httpsAgent: sharedHttpsAgent,
    // Don't throw on non-2xx — we handle status inline so partial failures
    // can be logged without masking the test result.
    validateStatus: () => true,
  });
}

async function cleanupOneService(
  service: CleanupServiceConfig,
  runId: string,
  accessToken: string,
): Promise<{ ok: boolean; detail: string }> {
  const baseUrl = process.env[service.envVar];
  if (!baseUrl) {
    return { ok: false, detail: `env ${service.envVar} unset — skipping` };
  }

  const client = createCleanupClient(baseUrl, accessToken, service.realm, runId);
  try {
    const resp = await client.delete('internal/canary-cleanup', {
      params: { runId },
    });
    if (resp.status >= 200 && resp.status < 300) {
      const counts = JSON.stringify(resp.data ?? {});
      return { ok: true, detail: `200 OK ${counts}` };
    }
    const body =
      typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data ?? '');
    return {
      ok: false,
      detail: `HTTP ${resp.status}${body ? ` body=${body.slice(0, 200)}` : ''}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `network error: ${msg}` };
  }
}

/**
 * Run the canary data-cleanup sweep across all 6 services for the given run.
 * Pure data teardown — does NOT touch the run lock. Exported so the in-cluster
 * chunked runner (`scripts/run-canary-incluster.mjs`) can invoke it EXACTLY
 * ONCE at the very end of a multi-process run, instead of once per chunk.
 *
 * Why this matters: the per-service cleanup endpoints delete every
 * `e2ec-{runId8}-*` record — INCLUDING the shared tenant-admin Keycloak users
 * that `multi-tenant.setup.ts` creates. The chunked runner runs setup, then
 * each chunk, as its OWN `playwright test` process; Playwright's config-level
 * `globalTeardown` fires at the end of EVERY such process. If the sweep ran
 * per-process, the setup process's own teardown would delete the just-created
 * tenant users before any chunk could log in as them → 401 Invalid user
 * credentials. So the runner sets `E2E_CANARY_SKIP_TEARDOWN=1` for the
 * intermediate processes (skipping the sweep but still releasing the lock) and
 * calls this once at the end.
 */
export async function runCanaryCleanup(runId: string, accessToken: string, target: string): Promise<void> {
  process.stdout.write(
    [
      '',
      '─── canary teardown ───────────────────────────────────────',
      `  target = ${target}`,
      `  runId  = ${runId}`,
      '',
    ].join('\n'),
  );

  // Sequential, not parallel — cleanup endpoints touch shared DBs and we want
  // ordered log output. The volume is 6 calls; latency is not a concern here.
  let successCount = 0;
  let failCount = 0;
  for (const service of SERVICES) {
    const result = await cleanupOneService(service, runId, accessToken);
    if (result.ok) {
      successCount += 1;
      process.stdout.write(`  [ok]   ${service.name.padEnd(20)} ${result.detail}\n`);
    } else {
      failCount += 1;
      process.stdout.write(`  [warn] ${service.name.padEnd(20)} ${result.detail}\n`);
    }
  }

  process.stdout.write(
    [
      '',
      `  summary: ${successCount} ok, ${failCount} failed`,
      failCount > 0
        ? '  orphan-cleanup CronJob will sweep any leaked e2ec-* records on the next weekly run.'
        : '  all services cleaned successfully.',
      '───────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

async function canaryGlobalTeardown(_config: FullConfig): Promise<void> {
  const runId = process.env.E2E_CANARY_RUN_ID;
  const accessToken = process.env.E2E_CANARY_ACCESS_TOKEN;
  const target = process.env.E2E_TARGET ?? 'local';

  if (!runId) {
    process.stdout.write('[canary-teardown] skipped — E2E_CANARY_RUN_ID unset (no canary setup ran)\n');
    return;
  }

  // When the chunked in-cluster runner drives the suite it spawns setup + each
  // chunk as separate `playwright test` processes, each of which fires this
  // config-level globalTeardown. Running the data sweep here would delete the
  // shared canary tenant users between processes (→ later chunks 401 on
  // login). The runner sets E2E_CANARY_SKIP_TEARDOWN=1 so the sweep runs ONCE
  // at the end (via runCanaryCleanup) instead. We STILL release the lock,
  // because each process acquires its own in global-setup.canary.ts.
  const skipSweep = (process.env.E2E_CANARY_SKIP_TEARDOWN ?? '').toLowerCase();
  if (skipSweep === '1' || skipSweep === 'true') {
    process.stdout.write(
      `[canary-teardown] sweep skipped (E2E_CANARY_SKIP_TEARDOWN set) for runId=${runId} — ` +
        'runner performs the final sweep. Releasing lock only.\n',
    );
    releaseCanaryLock();
    return;
  }

  // The lock was acquired in global-setup.canary.ts. It MUST be released no
  // matter how the cleanup below fares — a leaked lock would block every
  // future run for 30 min (until the orphan-cleanup CronJob expires it). The
  // `finally` guarantees release even on the `!accessToken` early-return path.
  try {
    if (!accessToken) {
      process.stderr.write(
        `[canary-teardown] WARN: E2E_CANARY_ACCESS_TOKEN unset for runId=${runId}.\n` +
          '  Cleanup endpoints will not be called.\n' +
          `  Orphan-cleanup CronJob will sweep e2ec-${runId.slice(0, 8)}-* on next run.\n`,
      );
      return;
    }

    await runCanaryCleanup(runId, accessToken, target);
  } finally {
    releaseCanaryLock();
  }
}

export default canaryGlobalTeardown;
