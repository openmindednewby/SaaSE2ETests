// AM-READY-5 §3.2 — measure ONCE per Playwright run, however many workers the run spawns.
//
// 🔴 WHY THIS EXISTS. Playwright tears a worker down after ANY failed test and starts a fresh one for
// the tests that remain, and a fresh worker re-runs `beforeAll`. The fuzzy measurement is ~80
// sequential screens (~6 minutes on shared staging), so a suite with k red tests paid for k+1
// measurements, blew through its wait and never printed a tally (MODB-BOARD-1 §23 item 4). An
// unrunnable suite is not a gate.
//
// The fix keeps every test independent and every assertion untouched: the FIRST worker of a run
// measures and writes the result here; every replacement worker in the SAME run reads it back.
// "Same run" = same runner process: workers are forked by the runner, so `process.ppid` is shared by
// all workers of one run and differs between runs. A max age bounds the (rare) PID-reuse case.
//
// A fatal/skip outcome is cached too: a measurement that could not complete must fail every test
// ONCE, not be retried by each replacement worker.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Measured } from './fuzzy-assertions.js';
import { ledger, type Screened } from './fuzzy-measure.js';

// `import.meta.url` is NOT usable here (the repo compiles specs as CommonJS), so __dirname.
// reports/ is gitignored; test-results/ is NOT used because other runs empty it.
const CACHE_DIR = resolve(__dirname, '..', '..', 'reports', 'aml-fuzzy');
const MAX_AGE_MS = 60 * 60 * 1000;

export interface FuzzyRunState {
  readonly measured: Measured | null;
  readonly skipReason: string | null;
  readonly fatal: string | null;
}

interface CacheFile {
  readonly writtenAt: number;
  readonly skipReason: string | null;
  readonly fatal: string | null;
  readonly measured: {
    readonly exact: [string, Screened][];
    readonly variants: (Screened | null)[];
    readonly negatives: (Screened | null)[];
    readonly common: (Screened | null)[];
  } | null;
  readonly ledger: {
    readonly statuses: [number, number][];
    readonly transportErrors: string[];
    readonly retryAfter: string[];
    readonly unobserved: string[];
  };
}

const cachePath = (): string => resolve(CACHE_DIR, `run-${process.ppid}.json`);

/** Restore this run's measurement (and the transport ledger F0 reads), or null if none exists yet. */
export function loadRunState(): FuzzyRunState | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  const file = JSON.parse(readFileSync(path, 'utf8')) as CacheFile;
  if (Date.now() - file.writtenAt > MAX_AGE_MS) return null;
  for (const [code, count] of file.ledger.statuses) ledger.statuses.set(code, count);
  ledger.transportErrors.push(...file.ledger.transportErrors);
  ledger.retryAfter.push(...file.ledger.retryAfter);
  ledger.unobserved.push(...file.ledger.unobserved);
  const saved = file.measured;
  console.log(`[fuzzy] reusing this run's measurement from ${path} — beforeAll did NOT re-screen.`);
  return {
    skipReason: file.skipReason,
    fatal: file.fatal,
    measured: saved
      ? { exact: new Map(saved.exact), variants: saved.variants, negatives: saved.negatives, common: saved.common }
      : null,
  };
}

/** Persist the first worker's outcome, including the ledger, for any replacement worker. */
export function saveRunState(state: FuzzyRunState): void {
  const { measured } = state;
  const file: CacheFile = {
    writtenAt: Date.now(),
    skipReason: state.skipReason,
    fatal: state.fatal,
    measured: measured
      ? {
          exact: [...measured.exact.entries()],
          variants: measured.variants,
          negatives: measured.negatives,
          common: measured.common,
        }
      : null,
    ledger: {
      statuses: [...ledger.statuses.entries()],
      transportErrors: ledger.transportErrors,
      retryAfter: ledger.retryAfter,
      unobserved: ledger.unobserved,
    },
  };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(file));
}
