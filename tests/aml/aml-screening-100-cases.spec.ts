// AM-READY-10 D-10.6 — >=100 screening cases against LIVE AML staging, with and without adverse
// media, plus a concurrent adverse-media stress. Round 0 is the BASELINE: reds on today's staging
// (Unavailable, latency, a 5xx) are the finding, not something to relax until it goes green.
//
// Transport and why it is the BFF, not the API key: screening-100-harness.ts header.
// Subjects and why single-token names carry a nationality: screening-100-corpus.ts header.
//
// HARD per case: no transport error / timeout, HTTP 200/201, the response shape, and the SERVED
// adverseMediaStatus — OFF must be "Skipped"; ON must be a checked status and must NEVER be
// "Unavailable" (the "Adverse media was NOT checked" banner the owner ruled unacceptable, D-10.4).
// SOFT per case: invented names come back clean, heavyweight exact names come back matched.
//
// NOT serial on purpose: under `serial` the first red skips the rest and grades nothing. Rows are
// appended to a runner-keyed JSONL before any assertion, so the aggregate grades every case even
// across worker restarts.
//
// Run: npm run test:aml:screening-100   (Tilt: playwright-e2e-aml-screening-100)
import { join } from 'node:path';
import { test, expect, type BrowserContext } from '@playwright/test';
import { quantile } from './fuzzy-measure.js';
import { Expectation, STRESS_SUBJECTS, SUBJECTS, type ScreeningSubject } from './screening-100-corpus.js';
import {
  AML_WEB_ORIGIN,
  HAS_TESTER,
  RowKind,
  SUCCESS,
  appendRow,
  openSession,
  readRows,
  screenCase,
  seconds,
  writeRound,
  type CaseRow,
} from './screening-100-harness.js';

// The LAT ceilings stated in AM-READY-5 A5-15 before any run, never fitted to an observation.
const P50_CEILING_MS = 1_500;
const P95_CEILING_MS = 4_000;
const P50 = 0.5;
const P95 = 0.95;
/** The brief's denominator. Below it the round is not the proof D-10.6 asks for. */
const MIN_CASES = 100;
const STRESS_WAVES = 5;
const STRESS_CONCURRENCY = 10;
const CASE_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 120_000;
const STRESS_TIMEOUT_MS = 360_000;
const HTTP_5XX_FLOOR = 500;

const SKIPPED = 'Skipped';
const UNAVAILABLE = 'Unavailable';
/** The statuses that mean the adverse-media stage ran against the index (types.ts:401). */
const CHECKED = new Set(['Ok', 'Stale']);
/** What the round was taken against — override per round; the default is Round 0's deploy. */
const UNDER_TEST = process.env.AML_UNDER_TEST ?? 'staging main@77575ee1';

let context: BrowserContext | null = null;

/** Per-case evidence goes to the report as an annotation; the round JSON file is the full record. */
function note(message: string): void {
  test.info().annotations.push({ type: 's100', description: message });
}

function runnerFile(name: string): string {
  return join(test.info().project.outputDir, `aml-screening-100.runner-${process.ppid}.${name}`);
}

const succeeded = (row: CaseRow): boolean => row.error === null && SUCCESS.has(row.status ?? 0);
const is5xx = (row: CaseRow): boolean => (row.status ?? 0) >= HTTP_5XX_FLOOR;

function latencyStats(rows: CaseRow[]): { n: number; p50Ms: number; p95Ms: number } {
  const sorted = rows.filter(succeeded).map(row => row.latencyMs).sort((a, b) => a - b);
  return { n: sorted.length, p50Ms: quantile(sorted, P50), p95Ms: quantile(sorted, P95) };
}

function countBy(rows: CaseRow[], key: (row: CaseRow) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}

function describeFailure(row: CaseRow): string {
  return `${row.id} "${row.subject}" -> ${row.error ?? `HTTP ${row.status}`} (corr ${row.correlationId ?? '-'})`;
}

function stressSubject(wave: number, slot: number): ScreeningSubject {
  const fullName = STRESS_SUBJECTS[(wave * STRESS_CONCURRENCY + slot) % STRESS_SUBJECTS.length];
  return { id: `stress-w${wave + 1}-${slot + 1}`, fullName, category: 'stress', expect: Expectation.Any };
}

test.describe.configure({ retries: 0, timeout: CASE_TIMEOUT_MS });

test.describe('AM-READY-10 D-10.6 — 100-case screening baseline through the BFF @aml-api', () => {
  test.skip(
    !HAS_TESTER,
    'AML_TESTER_EMAIL / AML_TESTER_PASSWORD unset (PROOViD/AMLService/.env, loaded by scripts/run-aml-e2e.mjs)',
  );

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    context = await openSession(browser, runnerFile('session.json'));
  });

  test.afterAll(async () => {
    await context?.close();
    context = null;
  });

  for (const subject of SUBJECTS) {
    for (const adverseMedia of [true, false]) {
      const label = `S100 ${subject.id} AM ${adverseMedia ? 'ON' : 'OFF'} [${subject.category}] ${subject.fullName}`;
      test(label, async () => {
        expect(context, 'no signed-in session').not.toBeNull();
        const row = await screenCase(context!.request, subject, adverseMedia, RowKind.Case);
        appendRow(runnerFile('rows.jsonl'), row);
        note(
          `[s100] ${row.id} AM ${adverseMedia ? 'ON ' : 'OFF'} ${row.status ?? 'ERR'} ${seconds(row.latencyMs)} ` +
            `am=${row.amStatus ?? '-'} hits=${row.hitCount ?? '-'} diag=${JSON.stringify(row.diagnostics)}`,
        );

        expect(row.error, `transport failure / timeout for "${subject.fullName}": ${row.error}`).toBeNull();
        expect(
          SUCCESS.has(row.status ?? 0),
          `HTTP ${row.status} for "${subject.fullName}" (correlation ${row.correlationId ?? 'none'})`,
        ).toBe(true);
        expect(row.shapeOk, 'response lacks id / isMatch / decision / matchedEntities / adverseMediaStatus').toBe(
          true,
        );
        if (adverseMedia) {
          expect(
            row.amStatus,
            `AM ON served "Unavailable" for "${subject.fullName}" — the "Adverse media was NOT checked" banner`,
          ).not.toBe(UNAVAILABLE);
          expect(CHECKED.has(row.amStatus ?? ''), `AM ON served "${row.amStatus}", not a checked status`).toBe(
            true,
          );
        } else {
          expect(row.amStatus, 'AM OFF must be reported as Skipped').toBe(SKIPPED);
        }
        if (subject.expect === Expectation.Clean)
          expect.soft(row.hitCount, `invented name "${subject.fullName}" matched`).toBe(0);
        if (subject.expect === Expectation.Hit)
          expect.soft(row.hitCount ?? 0, `heavyweight "${subject.fullName}" came back unmatched`).toBeGreaterThan(0);
      });
    }
  }

  test(`S100-STRESS ${STRESS_CONCURRENCY} concurrent AM-ON screenings x ${STRESS_WAVES} waves — zero errors`, async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);
    expect(context, 'no signed-in session').not.toBeNull();
    const rows: CaseRow[] = [];
    for (let wave = 0; wave < STRESS_WAVES; wave += 1) {
      const slots = Array.from({ length: STRESS_CONCURRENCY }, (_, slot) => stressSubject(wave, slot));
      const results = await Promise.all(
        slots.map(subject => screenCase(context!.request, subject, true, RowKind.Stress)),
      );
      rows.push(...results);
    }
    for (const row of rows) appendRow(runnerFile('rows.jsonl'), row);

    const stats = latencyStats(rows);
    const errors = rows.filter(row => !succeeded(row));
    const unavailable = rows.filter(row => row.amStatus === UNAVAILABLE).length;
    note(
      `[s100] STRESS n=${rows.length} ok=${stats.n} p50 ${seconds(stats.p50Ms)} p95 ${seconds(stats.p95Ms)} ` +
        `errors=${errors.length} unavailable=${unavailable} statuses=${JSON.stringify(countBy(rows, r => String(r.status)))}`,
    );
    expect(errors.map(describeFailure), 'stress produced errors (5xx / 429 / timeout)').toEqual([]);
  });

  // Runs last in file order. Grades EVERY case row of this run (worker restarts included) and
  // writes the round file whether or not the ceilings hold — the numbers are the deliverable.
  test('S100-AGG suite-level latency inside the LAT ceilings + round results file', () => {
    const all = readRows(runnerFile('rows.jsonl'));
    const cases = all.filter(row => row.kind === RowKind.Case);
    const stress = all.filter(row => row.kind === RowKind.Stress);
    const overall = latencyStats(cases);
    const unavailable = cases.filter(row => row.adverseMedia && row.amStatus === UNAVAILABLE);
    const failures = cases.filter(row => !succeeded(row));
    const summary = {
      target: AML_WEB_ORIGIN,
      underTest: UNDER_TEST,
      measuredAt: new Date().toISOString(),
      ceilings: { p50Ms: P50_CEILING_MS, p95Ms: P95_CEILING_MS },
      tally: {
        cases: cases.length,
        succeeded: cases.length - failures.length,
        http5xx: cases.filter(is5xx).map(describeFailure),
        otherFailures: failures.filter(row => !is5xx(row)).map(describeFailure),
        amOnUnavailable: unavailable.length,
        amOnUnavailableSubjects: unavailable.map(row => row.subject),
        amStatusOn: countBy(cases.filter(row => row.adverseMedia), row => row.amStatus ?? '(none)'),
        amStatusOff: countBy(cases.filter(row => !row.adverseMedia), row => row.amStatus ?? '(none)'),
      },
      latency: {
        all: overall,
        adverseMediaOn: latencyStats(cases.filter(row => row.adverseMedia)),
        adverseMediaOff: latencyStats(cases.filter(row => !row.adverseMedia)),
      },
      stress: {
        ...latencyStats(stress),
        rows: stress.length,
        errors: stress.filter(row => !succeeded(row)).map(describeFailure),
        unavailable: stress.filter(row => row.amStatus === UNAVAILABLE).length,
      },
      rows: all,
    };
    const files = writeRound(summary);
    note(`[s100] ROUND ${JSON.stringify({ tally: summary.tally, latency: summary.latency, stress: { ...summary.stress } })}`);
    note(`[s100] results written: ${files.join(' | ')}`);

    expect(cases.length, `only ${cases.length} case rows were recorded — D-10.6 needs ${MIN_CASES}+`).toBeGreaterThanOrEqual(
      MIN_CASES,
    );
    expect
      .soft(overall.p50Ms, `p50 ${seconds(overall.p50Ms)} exceeds the ${seconds(P50_CEILING_MS)} ceiling`)
      .toBeLessThanOrEqual(P50_CEILING_MS);
    expect(overall.p95Ms, `p95 ${seconds(overall.p95Ms)} exceeds the ${seconds(P95_CEILING_MS)} ceiling`).toBeLessThanOrEqual(
      P95_CEILING_MS,
    );
  });
});
