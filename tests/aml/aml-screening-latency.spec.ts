// AM-READY-5 3.3 / A5-15 - screening latency with adverse media ON, measured against LIVE staging.
//
// WHY THIS IS A SEPARATE SPEC FROM aml-fuzzy-matching. That suite screens with adverse media OFF.
// Its p50/p95 print is a BYPRODUCT and is NOT the A5-15 number: per A5-17 a latency figure without
// its window conditions (frontier before/after, pod CPU limit, whether the ingest backfill held the
// runner slot) is unattributable, and a number taken across a config or workload boundary is VOID,
// not approximate.
//
// ADVERSE MEDIA IS OBSERVED, NOT ASSUMED. Sending `adverseMedia: true` proves only what was ASKED.
// Every sampled row records the SERVED `adverseMediaStatus`; AM-E2E-LAT-0 fails if the stage did not
// actually run, because a latency number for a stage that silently no-opped measures the wrong path.
//
// RETRIED ROWS ARE EXCLUDED FROM THE DISTRIBUTION, BY NAME. screenOne() times the whole call
// including backoff, so a 409 INSUFFICIENT_DATA retry (FR-3 #381 -- ScreeningController.cs:182-183,
// NOT a duplicate subject) adds seconds of SLEEP to a row the server
// answered quickly. Those rows are counted and named, never silently folded into a p95.
import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { AML_API_KEY, AML_API_URL, amlReachable } from './aml-helpers.js';
import { CORPUS_NAMES, VARIANT_CASES, NEGATIVE_CONTROLS, COMMON_NAME_CONTROLS } from './fuzzy-corpus.js';
import { ledger, quantile, reportTransport, screenOne, type Screened } from './fuzzy-measure.js';

const RUN_TIMEOUT_MS = 1_500_000;
const ASSERT_TIMEOUT_MS = 30_000;
const MS_PER_S = 1000;
const P50 = 0.5;
const P95 = 0.95;
const SINGLE_ATTEMPT = 1;
/** A5-15 requires at least 50 sequential requests. Below this the quantiles are not evidence. */
const MIN_CLEAN_SAMPLES = 50;
/** Reviewer-workload bound from 3.2. Reported here, NOT asserted - it is an already-recorded floor. */
const REVIEWER_MATCH_BOUND = 25;

// -- The ceiling. STATED IN THE TASK DOC BEFORE THIS RUN (A5-15), never fitted to the observation. --
// p50 <= 1.5s protects the synchronous onboarding screen: a reviewer waits at the keyboard for it.
// p95 <= 4s is the point past which the console owes the user a progress affordance instead of a
// spinner. Both are held with headroom over the adverse-media-OFF byproduct (p50 0.78s / p95 1.67s),
// so the ceiling does not pin today's behaviour - it fails when the AM stage makes the wait a
// different kind of wait.
const P50_CEILING_S = 1.5;
const P95_CEILING_S = 4;

const QUERIES: readonly string[] = [
  ...CORPUS_NAMES,
  ...VARIANT_CASES.map(item => item.query),
  ...NEGATIVE_CONTROLS,
  ...COMMON_NAME_CONTROLS,
];

/** The served status that means the adverse-media stage ACTUALLY RAN for that screen. */
const AM_RAN = 'Ok';

interface LatencyWindow {
  /** Single-attempt rows whose AM stage reported Ok. These, and only these, are the A5-15 sample. */
  readonly clean: Screened[];
  readonly retried: string[];
  /** Single-attempt rows whose AM stage did NOT run. Counted by name, never folded into the p95 —
   *  a row that skipped the stage measures the adverse-media-OFF path under an ON label. */
  readonly amSkipped: Screened[];
  readonly amStatuses: Map<string, number>;
}

const state: LatencyWindow = {
  clean: [],
  retried: [],
  amSkipped: [],
  amStatuses: new Map<string, number>(),
};

function statusTotal(): number {
  let total = 0;
  for (const count of ledger.statuses.values()) total += count;
  return total;
}

async function runWindow(ctx: APIRequestContext): Promise<void> {
  for (const query of QUERIES) {
    const before = statusTotal();
    const row = await screenOne(ctx, query, { adverseMedia: true });
    if (!row) continue;
    const amStatus = row.adverseMediaStatus?.trim() || '(none)';
    state.amStatuses.set(amStatus, (state.amStatuses.get(amStatus) ?? 0) + 1);
    const attempts = statusTotal() - before;
    if (attempts !== SINGLE_ATTEMPT) state.retried.push(query + ' (' + attempts + ' attempts)');
    else if (amStatus === AM_RAN) state.clean.push(row);
    else state.amSkipped.push(row);
  }
}

function latencies(): number[] {
  return state.clean.map(row => row.latencyMs).sort((a, b) => a - b);
}

function amSummary(): string {
  return [...state.amStatuses].map(([status, count]) => `${status}x${count}`).join(' ') || '(none)';
}

function printWindow(sorted: number[]): void {
  const sizes = state.clean.map(row => row.matchCount).sort((a, b) => a - b);
  console.log(
    `[latency] A5-15 adverse media ON, SEQUENTIAL (concurrency 1), n=${sorted.length} clean ` +
      `single-attempt of ${QUERIES.length} queries: p50 ${(quantile(sorted, P50) / MS_PER_S).toFixed(2)}s ` +
      `p95 ${(quantile(sorted, P95) / MS_PER_S).toFixed(2)}s`,
  );
  console.log(`[latency] served adverseMediaStatus counts: ${amSummary()}`);
  console.log(
    `[latency] EXCLUDED (AM stage did not run, status !== ${AM_RAN}): ${state.amSkipped.length} row(s)`,
  );
  console.log(`[latency] EXCLUDED (needed a retry): ${state.retried.join(' | ') || '(none)'}`);
  console.log(
    `[latency] match-set size p95 ${quantile(sizes, P95)} vs reviewer bound ${REVIEWER_MATCH_BOUND} ` +
      `- reported, not asserted (3.2 floor)`,
  );
  console.log(`[latency] target host ${AML_API_URL}, measured ${new Date().toISOString()}`);
}

test.describe.configure({ timeout: ASSERT_TIMEOUT_MS, retries: 0 });

test.describe('AML screening latency, adverse media ON @aml-api', () => {
  test.beforeAll(async () => {
    test.setTimeout(RUN_TIMEOUT_MS);
    const ctx = await playwrightRequest.newContext();
    const reachable = await amlReachable(ctx);
    if (!AML_API_KEY || !reachable) {
      await ctx.dispose();
      return;
    }
    await runWindow(ctx);
    reportTransport(state.clean, 'adverse media ON');
    printWindow(latencies());
    await ctx.dispose();
  });

  test.beforeEach(() => {
    test.skip(!AML_API_KEY, 'AML_API_KEY not set for this environment');
    test.skip(state.clean.length + state.retried.length + state.amSkipped.length === 0, 'AML API unreachable');
  });

  // The denominator gate. A quantile over six rows is not a p95, and a latency number for an
  // adverse-media stage that never ran measures the wrong code path.
  test('AM-E2E-LAT-0 the window actually screened with adverse media ON', () => {
    expect(
      state.clean.length,
      `only ${state.clean.length} clean single-attempt rows (retried: ${state.retried.length}) - ` +
        `A5-15 needs ${MIN_CLEAN_SAMPLES}+ sequential requests before a p95 means anything`,
    ).toBeGreaterThanOrEqual(MIN_CLEAN_SAMPLES);
    const onlySilence = state.amStatuses.has('(none)') && state.amStatuses.size === SINGLE_ATTEMPT;
    expect(
      onlySilence,
      `every sampled screen came back with NO adverseMediaStatus - the AM stage did not run, so this ` +
        `is not an adverse-media-ON measurement (statuses seen: ${[...state.amStatuses].join(', ')})`,
    ).toBeFalsy();
  });

  test('AM-E2E-LAT-1 p50 screening latency stays inside the stated ceiling', () => {
    const p50 = quantile(latencies(), P50) / MS_PER_S;
    expect(p50, `p50 ${p50.toFixed(2)}s exceeds the ${P50_CEILING_S}s ceiling`).toBeLessThanOrEqual(
      P50_CEILING_S,
    );
  });

  test('AM-E2E-LAT-2 p95 screening latency stays inside the stated ceiling', () => {
    const p95 = quantile(latencies(), P95) / MS_PER_S;
    expect(p95, `p95 ${p95.toFixed(2)}s exceeds the ${P95_CEILING_S}s ceiling`).toBeLessThanOrEqual(
      P95_CEILING_S,
    );
  });
});
