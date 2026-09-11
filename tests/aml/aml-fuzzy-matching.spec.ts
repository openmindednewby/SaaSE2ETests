// AM-READY-5 §3.2 — fuzzy matching recall + precision floors over a frozen corpus. @aml-api tier.
//
// 🔴 EVERY FLOOR BELOW IS DERIVED FROM A WRITTEN RATIONALE, NEVER FROM WHAT THE SYSTEM RETURNS.
// Pinning a threshold to today's output freezes today's behaviour as the specification, which is how
// a matching suite becomes decorative. If a floor goes red, that is a FINDING for §6 of the task doc
// — the floor does not move.
//
// 🔴 A MEASUREMENT THAT CANNOT COMPLETE IS RED, NOT SKIPPED. The first version of this file turned a
// thrown screening into `test.skip`, and the run reported 11 SKIPPED / exit 0: a green that observed
// nothing. `fatal` below is that repair, and AM-E2E-F0 is the second half of it — a run that screened
// almost nothing must not look like a run whose floors all held.
//
// 🔴 WHAT THIS TIER CANNOT SEE (A5-12, partial). The doc's 596-vs-244 figure is the INTERNAL
// candidate block. No endpoint exposes it, so the block assertions below are over the RETURNED
// match set, which is post-scorer. A candidate-block expansion the scorer then filters away is
// invisible from here and must be covered in the service's own tier.
import { expect, request as apiRequest, test } from '@playwright/test';
import { AML_API_KEY, AML_API_URL, amlReachable } from './aml-helpers.js';
import { CORPUS_NAMES, NEGATIVE_CONTROLS, COMMON_NAME_CONTROLS, VARIANT_CASES } from './fuzzy-corpus.js';
import { ledger, quantile, reportTransport, screenAll, type Screened } from './fuzzy-measure.js';
import {
  ALL_CLASSES,
  attributable,
  context,
  collapsedSuppressions,
  exactSplit,
  launderedSuppressions,
  missesIn,
  pct,
  reachedIn,
  reportRecall,
  suppressedIn,
  unobservable,
  visibleIn,
  type Measured,
} from './fuzzy-assertions.js';

// ---------------------------------------------------------------------------------------------
// FLOORS — stated BEFORE the first run, each with the reason it is that number.
// ---------------------------------------------------------------------------------------------

/**
 * Exact, unmodified list rows must all come back. RATIONALE: this is not a fuzziness question at
 * all — the query IS the indexed string. A miss is a list/ingest gap, and treating it as tolerable
 * would let the fuzzy denominator below quietly shrink until the recall floor is trivially met.
 *
 * 🔴 §7: RESOLVED means matched OR deceased-SUPPRESSED. A row returned in `suppressedMatches` at
 * score 1 was found by the index and the scorer and then withheld by policy — reading its absence
 * from `matchedEntities` as a recall miss is what produced the 60% figure. The floor did NOT move
 * for this; what moved is what it is computed over. The two buckets are printed separately and
 * AM-E2E-F1b keeps them from collapsing into each other in either direction.
 */
const EXACT_RECALL_FLOOR = 1.0;

/**
 * Aggregate recall over the variant book, counted only over rows whose exact name resolved.
 * RATIONALE: the book spans SIX classes in roughly equal share, so losing one class outright lands
 * near 0.83. A floor of 0.85 therefore fails on any wholly-collapsed class while leaving room for
 * scattered hard cases. It is deliberately BELOW the 99.6% the doc records for the shipped
 * any-token blocking key: candidate recall is an upper bound on end-to-end recall, not a target.
 */
const FUZZY_RECALL_FLOOR = 0.85;

/**
 * RATIONALE: a class where most variants miss is a broken normaliser, not a hard corner. Half is
 * the point past which the class is no longer working at all.
 */
const PER_CLASS_RECALL_FLOOR = 0.5;

/**
 * RATIONALE: an invented name sharing no surname token with any list entity has no legitimate
 * match. One hit is a false positive, and a recall suite with no precision case passes an engine
 * that matches everything.
 */
const MAX_NEGATIVE_CONTROL_MATCHES = 0;

/**
 * RATIONALE (A5-12): the returned set is what a human adjudicates in the review queue. Past ~25
 * entities on a single-subject screen the queue stops being reviewable, and a mean above 10 means
 * the console's match list no longer fits one screen. Reviewer workload, not a measured value.
 */
const MAX_MATCHES_P95 = 25;
const MAX_MATCHES_MEAN = 10;

/**
 * RATIONALE: unobserved rows leave the denominator, so the more the service refuses, the easier
 * every floor above becomes. 5% of ~77 queries is ~4 — enough to absorb a transient conflict, far
 * too few to hide a service that has stopped screening.
 */
const MAX_UNOBSERVED_FRACTION = 0.05;

const RUN_TIMEOUT_MS = 900_000;
const ASSERT_TIMEOUT_MS = 60_000;
const P95 = 0.95;

let measured: Measured | null = null;
let skipReason: string | null = null;
let fatal: string | null = null;

test.describe.configure({ timeout: ASSERT_TIMEOUT_MS, retries: 0 });

test.describe('AML fuzzy matching floors @aml-api', () => {
  test.beforeAll(async () => {
    test.setTimeout(RUN_TIMEOUT_MS);
    if (!AML_API_KEY) {
      skipReason = 'AML_API_KEY is not set — cannot authenticate screenings.';
      return;
    }
    const ctx = await apiRequest.newContext();
    try {
      if (!(await amlReachable(ctx))) {
        skipReason = `AML API not reachable at ${AML_API_URL} (/version).`;
        return;
      }
      const exactRows = await screenAll(ctx, [...CORPUS_NAMES]);
      measured = {
        exact: new Map(
          exactRows.filter((row): row is Screened => row !== null).map(row => [row.query, row]),
        ),
        variants: await screenAll(ctx, VARIANT_CASES.map(item => item.query)),
        negatives: await screenAll(ctx, [...NEGATIVE_CONTROLS]),
        common: await screenAll(ctx, [...COMMON_NAME_CONTROLS]),
      };
      reportRecall(measured);
    } catch (error) {
      // 🔴 NOT a skip. A measurement that could not complete fails every assertion below and names
      // the query plus the LAST HTTP STATUS that stopped it, so throttling never reads as a fault.
      fatal = (error as Error).message;
    } finally {
      const rows = measured
        ? [...measured.exact.values(), ...measured.variants, ...measured.negatives, ...measured.common]
        : [];
      reportTransport(rows.filter((row): row is Screened => row !== null));
      await ctx.dispose();
    }
  });

  test.beforeEach(() => {
    if (skipReason) test.skip(true, skipReason);
    expect(fatal, `the §3.2 measurement did not complete, so no floor was observed: ${fatal}`).toBeNull();
  });

  test('AM-E2E-F0 the run actually screened the corpus — unobserved rows stay rare', () => {
    const total = CORPUS_NAMES.length + VARIANT_CASES.length + NEGATIVE_CONTROLS.length + COMMON_NAME_CONTROLS.length;
    expect(
      ledger.unobserved.length / total,
      `${ledger.unobserved.length}/${total} queries produced NO screening at all, so they left every ` +
        `denominator below. ${context()}. UNOBSERVED: ${ledger.unobserved.join(' | ')}. ` +
        'A floor cleared by a shrinking denominator is not a floor.',
    ).toBeLessThanOrEqual(MAX_UNOBSERVED_FRACTION);
  });

  test('AM-E2E-F1 exact corpus rows all resolve — the denominator every other floor stands on', () => {
    const split = exactSplit(measured!);
    const resolved = split.matched.length + split.suppressed.length;
    const screened = resolved + split.absent.length;
    expect(
      resolved / screened,
      `exact-name recall ${pct(resolved, screened)} is below the ${EXACT_RECALL_FLOOR} floor. ` +
        `${context()}. RESOLVED = matched ${split.matched.length} + deceased-SUPPRESSED ` +
        `${split.suppressed.length} [${split.suppressed.join(' | ') || 'none'}] (found at score 1, ` +
        'withheld by COV-12 policy — NOT a matching miss). ABSENT FROM INDEX, a SEEDING GAP tracked ' +
        `in AM-READY-5 §7: ${split.absent.join(' | ') || 'none'}. An exact list row that does not ` +
        'resolve is an index/ingest gap, not a scorer regression — the floor stays at 1.0.',
    ).toBeGreaterThanOrEqual(EXACT_RECALL_FLOOR);
  });

  test('AM-E2E-F1b the three outcomes stay distinct — suppressed is neither a hit nor a miss', () => {
    expect(
      launderedSuppressions(measured!),
      'a row was scored SUPPRESSED that the service never declared suppressed: its own name is ' +
        `absent from suppressedMatches, or suppressedDeceasedCount is 0. ${context()}. That is a ` +
        'genuine index gap being laundered into "found but withheld".',
    ).toEqual([]);
    expect(
      collapsedSuppressions(measured!),
      'a row the service WITHHELD was scored as a plain visible hit. ' +
        `${context()}. Collapsing suppressed into matched hides the day deceased-suppression ` +
        'stops firing, which is a policy regression with no other observer in this tier.',
    ).toEqual([]);
  });

  test('AM-E2E-F2 aggregate variant recall holds the stated floor', () => {
    const rows = attributable(measured!);
    const misses = missesIn(rows);
    expect(rows.length, `no variant case had a resolvable target — ${context()}`).toBeGreaterThan(0);
    expect(
      reachedIn(rows) / rows.length,
      `variant recall (REACHED) ${pct(reachedIn(rows), rows.length)} is below the ` +
        `${FUZZY_RECALL_FLOOR} floor. visible-only ${pct(visibleIn(rows), rows.length)}, ` +
        `${suppressedIn(rows).length} reached-then-suppressed. UNOBSERVABLE (target absent from the ` +
        `index, excluded from the denominator): ${unobservable(measured!).length}. ` +
        `${context()}. MISSED: ` +
        misses.map(pair => `[${pair.item.klass}] '${pair.item.query}' -> '${pair.item.expects}'`).join(' | '),
    ).toBeGreaterThanOrEqual(FUZZY_RECALL_FLOOR);
  });

  for (const klass of ALL_CLASSES) {
    test(`AM-E2E-F3 per-class recall holds — ${klass}`, () => {
      const rows = attributable(measured!, klass);
      test.skip(rows.length === 0, `no attributable case in class ${klass} — every target missed exactly.`);
      const misses = missesIn(rows);
      const blind = unobservable(measured!, klass);
      expect(
        reachedIn(rows) / rows.length,
        `class '${klass}' recall (REACHED) ${pct(reachedIn(rows), rows.length)} is below the ` +
          `${PER_CLASS_RECALL_FLOOR} floor. visible-only ${pct(visibleIn(rows), rows.length)}. ` +
          `UNOBSERVABLE in this class (target absent from the index, so the denominator is ` +
          `${rows.length}, not ${rows.length + blind.length}): ${blind.join(' | ') || 'none'}. ` +
          `${context()}. MISSED: ` +
          misses.map(pair => `'${pair.item.query}' -> '${pair.item.expects}'`).join(' | '),
      ).toBeGreaterThanOrEqual(PER_CLASS_RECALL_FLOOR);
    });
  }

  test('AM-E2E-F4 NEGATIVE CONTROL — an invented name matches nothing', () => {
    const rows = measured!.negatives.filter((row): row is Screened => row !== null);
    expect(rows.length, `every negative control was unobserved — ${context()}`).toBeGreaterThan(0);
    // §7: a false positive hidden in `suppressedMatches` is still a false positive, so both lists count.
    const offenders = rows.filter(
      row => row.matchCount + row.suppressedNames.length > MAX_NEGATIVE_CONTROL_MATCHES,
    );
    expect(
      offenders.map(
        row =>
          `'${row.query}' -> visible[${row.matchedNames.join(', ')}] ` +
          `suppressed[${row.suppressedNames.join(', ')}]`,
      ),
      `invented names returned matches. ${context()}. Recall floors are satisfiable by an engine ` +
        'that matches everything; this is the case that stops that.',
    ).toEqual([]);
  });

  test('AM-E2E-F5 a common name stays a REVIEWABLE match set', () => {
    for (const row of measured!.common.filter((item): item is Screened => item !== null)) {
      expect(
        row.matchCount,
        `'${row.query}' returned ${row.matchCount} entities. ${context()}. Past ${MAX_MATCHES_P95} ` +
          'a single-subject screen is not adjudicable by a reviewer.',
      ).toBeLessThanOrEqual(MAX_MATCHES_P95);
    }
  });

  test('AM-E2E-F6 returned match-set size stays bounded (mean and p95)', () => {
    const sizes = [...measured!.exact.values()].map(row => row.matchCount).sort((a, b) => a - b);
    const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
    expect(mean, `mean returned match-set ${mean.toFixed(1)} over ${context()}`).toBeLessThanOrEqual(
      MAX_MATCHES_MEAN,
    );
    expect(
      quantile(sizes, P95),
      `p95 returned match-set ${quantile(sizes, P95)} over ${context()}`,
    ).toBeLessThanOrEqual(MAX_MATCHES_P95);
  });
});
