/**
 * Canary lock POLICY - pure staleness / takeover rules, split out of canary-lock.ts (which does the
 * kubectl I/O) so they are unit-tested in canary-lock.test.mjs. TEST-5MIN-1b "Indexed Jobs per target".
 */
export const LOCK_TTL_MS = 30 * 60 * 1000; // 30 min — long runs (Tilt, chunked nightly) and locks without ttlMs.
/**
 * Indexed runs (TEST-5MIN-1b "Indexed Jobs per target", one group per pod): the pod's
 * activeDeadlineSeconds is 330 s and `startedAt` is written after the pod started, so a holder
 * older than 330 s is dead. Without this a pod killed before its teardown blocked the next ~6
 * groups of the Job for 30 min.
 */
export const INDEXED_LOCK_TTL_MS = 330_000;
/** An indexed acquirer waits (instead of failing its group) when the held lock expires this soon. */
export const INDEXED_MAX_WAIT_MS = 60_000;

/** TTL this run writes into its lock: short for an Indexed-Job pod, 30 min otherwise. */
export function lockTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return env.E2E_GROUP_INDEX ? INDEXED_LOCK_TTL_MS : LOCK_TTL_MS;
}

export type LockDecision = { action: 'reclaim' } | { action: 'wait'; ms: number } | { action: 'refuse'; ageMs: number };

/**
 * What to do about an existing lock. The HOLDER's own ttlMs decides staleness (a short indexed
 * acquirer must never reclaim a long chunked run's lock); locks written before ttlMs existed get
 * the 30 min default.
 */
export function decideOnHeldLock(
  startedAt: string | undefined,
  heldTtlMs: string | undefined,
  nowMs: number,
  acquirerIndexed: boolean,
): LockDecision {
  const startedMs = Date.parse(startedAt ?? '');
  if (Number.isNaN(startedMs)) return { action: 'reclaim' };
  const parsedTtl = Number(heldTtlMs);
  const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : LOCK_TTL_MS;
  const ageMs = nowMs - startedMs;
  const remaining = ttl - ageMs;
  if (remaining <= 0) return { action: 'reclaim' };
  if (acquirerIndexed && remaining <= INDEXED_MAX_WAIT_MS) return { action: 'wait', ms: remaining };
  return { action: 'refuse', ageMs };
}

/** An existing lock ConfigMap, as read (`kubectl get -o json`). */
export interface HeldLock {
  startedAt?: string;
  runId?: string;
  runner?: string;
  ttlMs?: string;
  uid?: string;
  resourceVersion?: string;
}

export function parseLockJson(stdout: string): HeldLock | null {
  if (!stdout.trim()) return null;
  const cm = JSON.parse(stdout) as {
    metadata?: { uid?: string; resourceVersion?: string };
    data?: Record<string, string>;
  };
  const d = cm.data ?? {};
  return {
    startedAt: d.startedAt,
    runId: d.runId,
    runner: d.runner,
    ttlMs: d.ttlMs,
    uid: cm.metadata?.uid,
    resourceVersion: cm.metadata?.resourceVersion,
  };
}

export type Takeover =
  | { action: 'create' }
  | { action: 'reclaim'; held: HeldLock }
  | { action: 'refuse'; held: HeldLock; ageMs: number };

/**
 * Decide how to take the lock. After a wait the lock is RE-READ and judged again — the holder may
 * have released it and another run taken a fresh one meanwhile. At most one wait. `reclaim`
 * carries the exact lock that was judged stale so the delete can be conditional on it.
 */
export function resolveTakeover(
  read: () => HeldLock | null,
  now: () => number,
  sleep: (ms: number) => void,
  indexed: boolean,
): Takeover {
  let held = read();
  let mayWait = indexed;
  for (;;) {
    if (!held) return { action: 'create' };
    const d = decideOnHeldLock(held.startedAt, held.ttlMs, now(), mayWait);
    if (d.action === 'reclaim') return { action: 'reclaim', held };
    if (d.action === 'refuse') return { action: 'refuse', held, ageMs: d.ageMs };
    sleep(d.ms);
    mayWait = false;
    held = read();
  }
}

/** DeleteOptions whose preconditions make the delete fail unless the lock is still `held`. */
export function deletePreconditionBody(held: HeldLock): string {
  return JSON.stringify({
    kind: 'DeleteOptions',
    apiVersion: 'v1',
    preconditions: { uid: held.uid, resourceVersion: held.resourceVersion },
  });
}

