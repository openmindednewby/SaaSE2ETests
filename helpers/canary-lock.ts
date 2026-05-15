/**
 * Canary run lock — the leader-election ConfigMap from the parent design's
 * "Concurrent-run handling" section (Phase 4 of the e2e-multi-environment
 * effort, see `BaseClient/docs/Tasks/IN_PROGRESS/phase-4-staging-k8s-job.md`).
 *
 * WHY
 * Two simultaneous canary runs against the same environment use different
 * runIds so their *data* can't collide, but they still both hammer Keycloak's
 * admin API + brute-force counters and saturate notification-api. The lock
 * makes a run against a given target mutually exclusive.
 *
 * MECHANISM
 * A ConfigMap `canary-run-lock-{target}` in the `dloizides` namespace holds
 * `runId`, `startedAt` (ISO-8601 UTC) and `runner` (hostname) as data fields.
 *   - `acquireCanaryLock()` runs in `global-setup.canary.ts`. If a lock exists
 *     and is younger than 30 min it THROWS — the run refuses to start. A lock
 *     older than 30 min is treated as abandoned (the orphan-cleanup CronJob is
 *     the belt-and-braces sweeper) and is deleted + re-taken.
 *   - `releaseCanaryLock()` runs in `global-teardown.canary.ts` and deletes the
 *     ConfigMap. It never throws — a failed release just leaves a lock the
 *     CronJob will expire.
 *
 * RUNNER MODES
 *  - In-cluster Job: `kubectl` talks to the local API server via the
 *    `playwright-e2e` ServiceAccount (RBAC in `k8s/playwright-e2e/rbac.yml`).
 *    `E2E_LOCK_KUBECTL` is left at its default (`kubectl`). The lock is HARD.
 *  - Dev-PC `local→staging` / `local→prod`: the dev PC reaches the clusters
 *    over SSH, not a local kube-context. To get a real lock there, set
 *    `E2E_LOCK_KUBECTL="ssh jim@10.0.0.2 sudo kubectl"` (staging) in
 *    `.env.staging.secrets`. If `kubectl` is simply unavailable the lock
 *    DEGRADES to best-effort: a loud warning, then the run proceeds. Per-runId
 *    prefixes + the orphan-cleanup CronJob keep a collision annoying, not
 *    catastrophic — so a missing kube-context must not hard-block a dev run.
 *
 * Set `E2E_LOCK_DISABLED=true` to skip the lock entirely (escape hatch).
 */
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';

const LOCK_TTL_MS = 30 * 60 * 1000; // 30 min — matches activeDeadlineSeconds on the Job.
const DEFAULT_NAMESPACE = 'dloizides';

interface LockKubectl {
  /** Executable, e.g. `kubectl` or `ssh`. */
  bin: string;
  /** Leading args, e.g. `[]` or `['jim@10.0.0.2', 'sudo', 'kubectl']`. */
  prefixArgs: string[];
}

function resolveKubectl(): LockKubectl {
  const raw = (process.env.E2E_LOCK_KUBECTL ?? 'kubectl').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return { bin: parts[0] ?? 'kubectl', prefixArgs: parts.slice(1) };
}

function lockName(): string {
  const target = process.env.E2E_TARGET ?? 'local';
  return `canary-run-lock-${target}`;
}

function namespace(): string {
  return process.env.E2E_LOCK_NAMESPACE ?? DEFAULT_NAMESPACE;
}

interface KubectlResult {
  ok: boolean;
  /** stdout, trimmed. */
  stdout: string;
  /** stderr, trimmed. */
  stderr: string;
  /** true when the binary couldn't be spawned at all (ENOENT etc.). */
  spawnFailed: boolean;
}

function runKubectl(k: LockKubectl, args: string[], stdin?: string): KubectlResult {
  const result = spawnSync(k.bin, [...k.prefixArgs, ...args], {
    input: stdin,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    return { ok: false, stdout: '', stderr: String(result.error), spawnFailed: true };
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    spawnFailed: false,
  };
}

/**
 * Acquire the canary run lock for the active `E2E_TARGET`.
 *
 * @throws when a fresh (<30 min) lock is already held by another run.
 */
export function acquireCanaryLock(runId: string): void {
  if ((process.env.E2E_LOCK_DISABLED ?? '').toLowerCase() === 'true') {
    process.stdout.write('[canary-lock] disabled via E2E_LOCK_DISABLED — skipping.\n');
    return;
  }

  const k = resolveKubectl();
  const name = lockName();
  const ns = namespace();
  const runner = os.hostname();

  // 1. Read any existing lock.
  const get = runKubectl(k, [
    'get', 'configmap', name, '-n', ns,
    '-o', 'jsonpath={.data.startedAt}{"\\n"}{.data.runId}{"\\n"}{.data.runner}',
  ]);

  if (get.spawnFailed) {
    process.stderr.write(
      `[canary-lock] WARN: cannot run '${k.bin}' (${get.stderr}). ` +
        'Lock check unavailable — proceeding BEST-EFFORT (no lock held).\n' +
        '  To enforce the lock from a dev PC set E2E_LOCK_KUBECTL, e.g.\n' +
        '  E2E_LOCK_KUBECTL="ssh jim@10.0.0.2 sudo kubectl"\n',
    );
    return;
  }

  if (get.ok && get.stdout.length > 0) {
    // Lock exists. stdout = "startedAt\nrunId\nrunner".
    const [startedAt, heldRunId, heldRunner] = get.stdout.split('\n');
    const startedMs = Date.parse(startedAt ?? '');
    const ageMs = Number.isNaN(startedMs) ? Number.POSITIVE_INFINITY : Date.now() - startedMs;

    if (ageMs < LOCK_TTL_MS) {
      const ageMin = Math.round(ageMs / 60_000);
      throw new Error(
        `[canary-lock] REFUSING TO START — a canary run is already in progress against ` +
          `'${process.env.E2E_TARGET}'.\n` +
          `  lock     = ${name} (namespace ${ns})\n` +
          `  held by  = ${heldRunner ?? '(unknown)'} runId=${heldRunId ?? '(unknown)'}\n` +
          `  started  = ${startedAt} (~${ageMin} min ago)\n` +
          `  Wait for it to finish, or if it is genuinely stuck delete the lock:\n` +
          `    kubectl delete configmap ${name} -n ${ns}\n`,
      );
    }

    // Stale lock — abandoned run. Reclaim it.
    process.stdout.write(
      `[canary-lock] found a STALE lock (started ${startedAt}, >30 min old) — reclaiming.\n`,
    );
    const del = runKubectl(k, ['delete', 'configmap', name, '-n', ns, '--ignore-not-found']);
    if (!del.ok) {
      process.stderr.write(`[canary-lock] WARN: failed to delete stale lock: ${del.stderr}\n`);
    }
  } else if (!get.ok && !/not\s*found/i.test(get.stderr)) {
    // get failed for a reason other than "the ConfigMap doesn't exist"
    // (e.g. RBAC denied, API server unreachable). Don't hard-block — warn.
    process.stderr.write(
      `[canary-lock] WARN: lock check failed (${get.stderr}). Proceeding BEST-EFFORT.\n`,
    );
    return;
  }

  // 2. Create the lock.
  const startedAt = new Date().toISOString();
  const create = runKubectl(k, [
    'create', 'configmap', name, '-n', ns,
    `--from-literal=runId=${runId}`,
    `--from-literal=startedAt=${startedAt}`,
    `--from-literal=runner=${runner}`,
  ]);

  if (!create.ok) {
    if (/already\s*exists/i.test(create.stderr)) {
      // Lost a race against another runner between get + create.
      throw new Error(
        `[canary-lock] REFUSING TO START — lost the lock race against a concurrent ` +
          `runner for '${process.env.E2E_TARGET}'. Retry once the other run finishes.\n`,
      );
    }
    process.stderr.write(
      `[canary-lock] WARN: could not create lock ConfigMap (${create.stderr}). ` +
        'Proceeding BEST-EFFORT.\n',
    );
    return;
  }

  process.stdout.write(
    `[canary-lock] acquired ${name} (runner=${runner}, runId=${runId.slice(0, 8)}…)\n`,
  );
}

/**
 * Release the canary run lock. Best-effort — never throws. A failed release
 * just leaves a lock the orphan-cleanup CronJob will expire after 30 min.
 */
export function releaseCanaryLock(): void {
  if ((process.env.E2E_LOCK_DISABLED ?? '').toLowerCase() === 'true') return;

  const k = resolveKubectl();
  const name = lockName();
  const ns = namespace();

  const del = runKubectl(k, ['delete', 'configmap', name, '-n', ns, '--ignore-not-found']);
  if (del.spawnFailed) {
    process.stderr.write(
      `[canary-lock] WARN: cannot run '${k.bin}' to release lock — leaving it for the ` +
        'orphan-cleanup CronJob to expire.\n',
    );
    return;
  }
  if (!del.ok) {
    process.stderr.write(
      `[canary-lock] WARN: failed to release lock ${name} (${del.stderr}) — the ` +
        'orphan-cleanup CronJob will expire it after 30 min.\n',
    );
    return;
  }
  process.stdout.write(`[canary-lock] released ${name}.\n`);
}

export const _internals = { LOCK_TTL_MS, lockName, namespace, resolveKubectl };
