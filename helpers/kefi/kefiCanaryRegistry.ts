/**
 * Run-scoped registry of every Kefi resource a run creates and owes a cleanup.
 *
 * WHY THIS EXISTS (the false-green it closes):
 * The shared config-level teardown (`fixtures/global-teardown.canary.ts`) swept
 * a HARDCODED list of six backend slices that does not include Kefi, so its
 * `summary: 6 ok, 0 failed` line was emitted identically whether or not a Kefi
 * canary tenant had been created and whether or not it was ever swept. The
 * per-spec Kefi sweep was opt-in, and the event-ops fixture returned its
 * cleanup failures in an array a caller could simply discard. Every one of
 * those tallies was structurally incapable of observing what was leaking.
 *
 * The registry makes the leak OBSERVABLE:
 *   - `recordCreated` is called at the moment a resource exists (the canary
 *     mint point, and every create helper in `kefiEventOpsFixture`), so no spec
 *     can forget to declare one.
 *   - `recordCleaned` is called only on a VERIFIED removal. A swallowed
 *     cleanup error therefore leaves the id PENDING rather than disappearing.
 *   - `readPendingResources` is read by the global teardown, which sweeps the
 *     leftovers and FAILS THE RUN if any resource could not be removed.
 *
 * A FILE, not process.env: Playwright workers are separate processes, and the
 * chunked in-cluster runner spawns a fresh `playwright test` process per chunk.
 * An id created in one of those can never reach the process where
 * globalTeardown runs through `process.env`. Appends are single short lines
 * opened O_APPEND, which is atomic enough for the volume here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REGISTRY_DIR = 'test-results';
const RUN_ID_SHORT_LENGTH = 8;

/**
 * What kind of resource is owed a cleanup. `canary` is a whole disposable Kefi
 * tenant (swept by canaryId); `attendee`/`link`/`template` are rows on the REAL
 * fixture tenant `e2e` - an abandoned attendee shifts a live tenant's P&L and
 * an abandoned access link is a real credential left lying around. `unknown` is
 * reserved for the registry's own integrity failures.
 */
export type LeakKind = 'canary' | 'attendee' | 'link' | 'template' | 'unknown';

export interface PendingResource {
  kind: LeakKind;
  id: string;
}

interface RegistryEntry {
  kind: LeakKind;
  /** Resource id: a canary id, or an attendee/link/template externalId. */
  id: string;
  /** `run-start` is the sentinel described under `openCanaryRegistry`. */
  event: 'minted' | 'swept' | 'run-start';
  at: string;
}

/**
 * The key that scopes this run's registry file. `E2E_CANARY_REGISTRY_KEY` is
 * exported by `scripts/run-canary-incluster.mjs` so the setup process, every
 * chunk process and the final-cleanup process share ONE registry even though
 * they are separate `playwright test` invocations.
 */
function runScopeKey(): string | null {
  const explicit = process.env.E2E_CANARY_REGISTRY_KEY;
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const runId = process.env.E2E_CANARY_RUN_ID;
  if (runId && runId.trim().length > 0) return runId.trim().slice(0, RUN_ID_SHORT_LENGTH);
  return null;
}

/**
 * `null` when there is no run scope at all - a LOCAL target. Local runs use
 * ephemeral DBs and are deliberately NOT gated (playwright.config.ts wires the
 * canary teardown only for staging/prod), so recording there would grow a file
 * nothing ever reads or clears. Writes become no-ops and say so once.
 */
export function canaryRegistryPath(): string | null {
  const override = process.env.E2E_KEFI_CANARY_REGISTRY;
  if (override) return override;
  const key = runScopeKey();
  if (key === null) return null;
  return path.join(REGISTRY_DIR, `.kefi-canary-registry-${key}.jsonl`);
}

let warnedUnscoped = false;

function append(entry: RegistryEntry): void {
  const file = canaryRegistryPath();
  if (file === null) {
    if (!warnedUnscoped) {
      warnedUnscoped = true;
      process.stderr.write(
        '[kefi-canary-registry] NOTE: no canary run scope (local target) - leak tracking is ' +
          'OFF. Rows created against a REMOTE Kefi API from a local run are NOT gated.\n',
      );
    }
    return;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (e) {
    // Loud, but the real protection is the run-start sentinel: if writes are
    // failing, the file is absent or sentinel-less and the READER fails the run.
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[kefi-canary-registry] WARN: could not record ${entry.event} ${entry.id} - ${msg}\n`);
  }
}

/**
 * Write the run-start SENTINEL. Called from global-setup.canary.ts.
 *
 * Without it, "the registry file does not exist" is indistinguishable from
 * "nothing was ever created" - so a read-only or full `test-results` would lose
 * every declaration and the sweep would print a confident `0 pending`. That is
 * the same false-green shape this gate exists to remove, one level down. With
 * the sentinel, a missing or sentinel-less file is a DETECTED failure.
 */
export function openCanaryRegistry(): void {
  append({ kind: 'unknown', id: 'run-start', event: 'run-start', at: new Date().toISOString() });
}

/** Record that a resource was created and now owes a cleanup. */
export function recordCreated(kind: LeakKind, id: string): void {
  append({ kind, id, event: 'minted', at: new Date().toISOString() });
}

/**
 * Record a VERIFIED cleanup. A failed, skipped, or merely-2xx-but-unverified
 * cleanup must NOT call this - leaving the id pending IS the mechanism.
 */
export function recordCleaned(kind: LeakKind, id: string): void {
  append({ kind, id, event: 'swept', at: new Date().toISOString() });
}

/** Record that a canary id was minted. Called from `newCanaryContext()`. */
export function recordCanaryMinted(canaryId: string): void {
  recordCreated('canary', canaryId);
}

/** Record a SUCCESSFUL sweep. A failed/skipped sweep must NOT call this. */
export function recordCanarySwept(canaryId: string): void {
  recordCleaned('canary', canaryId);
}

/** Every resource created this run that was never verifiably cleaned. */
export function readPendingResources(): PendingResource[] {
  const file = canaryRegistryPath();
  if (file === null) return [];
  if (!fs.existsSync(file)) {
    // The sentinel could not be written, or the file was removed mid-run.
    // Unknowable is NOT clean.
    return [{ kind: 'unknown', id: 'registry-missing (run-start sentinel was never written)' }];
  }

  const created = new Map<string, PendingResource>();
  const cleaned = new Set<string>();
  let sawSentinel = false;
  let corruptLines = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry: RegistryEntry;
    try {
      entry = JSON.parse(line) as RegistryEntry;
    } catch {
      // A partial final line (SIGKILL / OOM mid-append) DROPS a declaration.
      // Silently skipping it makes that leak invisible, so count it and report
      // it as pending: corruption fails the gate instead of under-reporting.
      corruptLines += 1;
      continue;
    }
    if (entry.event === 'run-start') {
      sawSentinel = true;
      continue;
    }
    const key = `${entry.kind}:${entry.id}`;
    if (entry.event === 'minted') created.set(key, { kind: entry.kind, id: entry.id });
    if (entry.event === 'swept') cleaned.add(key);
  }

  const pending = [...created.entries()].filter(([key]) => !cleaned.has(key)).map(([, r]) => r);
  if (corruptLines > 0) {
    pending.push({
      kind: 'unknown',
      id: `${corruptLines} unparsable registry line(s) - a declaration may have been lost`,
    });
  }
  if (!sawSentinel) {
    pending.push({ kind: 'unknown', id: 'registry has no run-start sentinel - writes may have been lost' });
  }
  return pending;
}

/** Canary ids minted this run that were never successfully swept. */
export function readPendingCanaryIds(): string[] {
  return readPendingResources().filter((r) => r.kind === 'canary').map((r) => r.id);
}

/** Fixture-tenant rows + integrity failures never verifiably cleaned. */
export function readPendingEventOpsResources(): PendingResource[] {
  return readPendingResources().filter((r) => r.kind !== 'canary');
}

/** Delete this run's registry file. Called only after a clean teardown. */
export function clearCanaryRegistry(): void {
  const file = canaryRegistryPath();
  if (file === null) return;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // Best effort - a stale file is scoped to a run key that will never recur.
  }
}
