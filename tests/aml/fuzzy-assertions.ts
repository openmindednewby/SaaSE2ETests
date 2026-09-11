// AM-READY-5 §3.2 / §7 — the reporting/denominator helpers, split out of the spec so neither file
// runs past the 300-line limit.
//
// 🔴 THE DENOMINATOR RULE, stated once. A query that produced no screening at all (a persistent 409
// INSUFFICIENT_DATA, a 5xx) is UNOBSERVED: not a hit and not a miss. Dropping it silently would make
// every recall floor easier to clear the more the service failed, which is the vacuity trap §3.5
// names. So unobserved rows are excluded from the ratio AND asserted to be rare AND printed by name.
//
// 🔴 THE SECOND DENOMINATOR RULE (§7). REACHED and VISIBLE are different questions and this file
// answers both. A deceased-suppressed row was REACHED by the scorer at score 1 and then withheld by
// policy; it is not a matching failure, and scoring it as one is what produced the 60% exact-recall
// figure. It is equally not a plain hit — so Outcome.Suppressed is its own bucket, printed on every
// line, and never summed into `matched`.
import { CORPUS_NAMES, CORPUS_REVISION, VARIANT_CASES, VariantClass, normaliseName } from './fuzzy-corpus.js';
import { Outcome } from './fuzzy-outcome.js';
import { AML_API_URL } from './aml-helpers.js';
import type { Screened } from './fuzzy-measure.js';

const PERCENT = 100;
/** A suppression the service actually declares carries at least one reason count. */
const MIN_SUPPRESSION_REASON = 1;

export const ALL_CLASSES: VariantClass[] = [
  VariantClass.Transliteration,
  VariantClass.OrderInversion,
  VariantClass.Initials,
  VariantClass.Diacritics,
  VariantClass.Hyphenation,
  VariantClass.CaseAndSpacing,
];

export interface Measured {
  /** Exact-name screens, keyed by corpus name. A key is absent when that screen was unobserved. */
  readonly exact: Map<string, Screened>;
  /** Index-aligned with VARIANT_CASES; null where the screening never happened. */
  readonly variants: (Screened | null)[];
  readonly negatives: (Screened | null)[];
  readonly common: (Screened | null)[];
}

export interface VariantOutcome {
  readonly item: (typeof VARIANT_CASES)[number];
  readonly row: Screened;
}

/** The four-way split of the exact-name screens. `absent` is INFERRED — see fuzzy-outcome.ts. */
export interface ExactSplit {
  readonly matched: string[];
  readonly suppressed: string[];
  readonly absent: string[];
  readonly unobserved: string[];
}

const hasName = (names: string[], expected: string): boolean =>
  names.some(name => normaliseName(name) === normaliseName(expected));

/** The three OBSERVED outcomes. Nothing here infers absence — only `exactSplit` may do that. */
export const outcomeFor = (row: Screened, expected: string): Outcome => {
  if (hasName(row.matchedNames, expected)) return Outcome.Matched;
  if (hasName(row.suppressedNames, expected)) return Outcome.Suppressed;
  return Outcome.Missed;
};

/** REACHED: the scorer found it, whether or not policy then hid it. The matching-quality question. */
export const reached = (row: Screened, expected: string): boolean =>
  outcomeFor(row, expected) !== Outcome.Missed;

/** VISIBLE: it came back in `matchedEntities`. Deliberately NOT the same predicate as `reached`. */
export const visible = (row: Screened, expected: string): boolean =>
  outcomeFor(row, expected) === Outcome.Matched;

export const pct = (hits: number, total: number): string =>
  total === 0 ? 'n/a' : `${((hits / total) * PERCENT).toFixed(1)}% (${hits}/${total})`;

/** A5-14: every failure message carries the corpus revision, so list drift stays separable. */
export const context = (): string => `corpus ${CORPUS_REVISION} · target ${AML_API_URL}`;

export function exactSplit(measured: Measured): ExactSplit {
  const matched: string[] = [];
  const suppressed: string[] = [];
  const absent: string[] = [];
  const unobserved: string[] = [];
  for (const name of CORPUS_NAMES) {
    const row = measured.exact.get(name);
    const outcome = row === undefined ? null : outcomeFor(row, name);
    if (outcome === null) unobserved.push(name);
    else if (outcome === Outcome.Matched) matched.push(name);
    else if (outcome === Outcome.Suppressed) suppressed.push(name);
    // The query IS the indexed string, so a row in neither list is a seed gap, not a scorer result.
    else absent.push(name);
  }
  return { matched, suppressed, absent, unobserved };
}

/** Corpus names the index demonstrably holds — matched OR deliberately withheld. */
export const resolvedExact = (measured: Measured): string[] => {
  const split = exactSplit(measured);
  return [...split.matched, ...split.suppressed];
};

/**
 * Variant cases attributable to MATCHING QUALITY: the variant was screened, and its target is in the
 * index under its exact name (visible or suppressed — presence is the question, not visibility). A
 * target the index does not hold is UNOBSERVABLE from this tier; counting it as a fuzzy miss would
 * blame the scorer for the seed.
 */
export function attributable(measured: Measured, klass?: VariantClass): VariantOutcome[] {
  const out: VariantOutcome[] = [];
  VARIANT_CASES.forEach((item, index) => {
    const row = measured.variants[index];
    const target = measured.exact.get(item.expects);
    const inClass = klass === undefined || item.klass === klass;
    if (row && target && inClass && reached(target, item.expects)) out.push({ item, row });
  });
  return out;
}

/** Variant cases this tier CANNOT observe: their target is not in the index. Named, never dropped. */
export function unobservable(measured: Measured, klass?: VariantClass): string[] {
  const gap = new Set(exactSplit(measured).absent);
  return VARIANT_CASES.filter(
    item => gap.has(item.expects) && (klass === undefined || item.klass === klass),
  ).map(item => `'${item.query}' -> '${item.expects}'`);
}

export const reachedIn = (rows: VariantOutcome[]): number =>
  rows.filter(pair => reached(pair.row, pair.item.expects)).length;

export const visibleIn = (rows: VariantOutcome[]): number =>
  rows.filter(pair => visible(pair.row, pair.item.expects)).length;

export const suppressedIn = (rows: VariantOutcome[]): VariantOutcome[] =>
  rows.filter(pair => outcomeFor(pair.row, pair.item.expects) === Outcome.Suppressed);

export const missesIn = (rows: VariantOutcome[]): VariantOutcome[] =>
  rows.filter(pair => !reached(pair.row, pair.item.expects));

/** §7 control: a row scored SUPPRESSED whose body does not actually declare that suppression. */
export const launderedSuppressions = (measured: Measured): string[] =>
  exactSplit(measured).suppressed.filter(name => {
    const row = measured.exact.get(name);
    const undeclared = row === undefined || !hasName(row.suppressedNames, name);
    return undeclared || row.suppressedDeceasedCount < MIN_SUPPRESSION_REASON;
  });

/**
 * §7 control: a row the service withheld and did NOT also return visibly, yet scored as a plain hit.
 * 🔴 The `!hasName(matchedNames)` clause is load-bearing and was added after a red. A screen can
 * legitimately carry the same name in BOTH lists — two distinct entities, one of them deceased
 * (e.g. 'Emperor Yang of Sui' returns 3 suppressed alongside a visible hit). That row IS visible, so
 * flagging it would make this control red on real data instead of on a collapse.
 */
export const collapsedSuppressions = (measured: Measured): string[] =>
  CORPUS_NAMES.filter(name => {
    const row = measured.exact.get(name);
    if (row === undefined) return false;
    const withheldOnly = hasName(row.suppressedNames, name) && !hasName(row.matchedNames, name);
    return withheldOnly && visible(row, name);
  });

function reportClasses(measured: Measured): void {
  for (const klass of ALL_CLASSES) {
    const rows = attributable(measured, klass);
    const blind = unobservable(measured, klass);
    console.log(
      `[fuzzy] recall ${klass}: reached ${pct(reachedIn(rows), rows.length)} · ` +
        `visible ${pct(visibleIn(rows), rows.length)} · suppressed ${suppressedIn(rows).length} · ` +
        `UNOBSERVABLE ${blind.length}${blind.length ? ' -> ' + blind.join(' | ') : ''}`,
    );
  }
}

/** Print every number to the run log — a figure inside a passing assertion is invisible. */
export function reportRecall(measured: Measured): void {
  console.log(`[fuzzy] ${context()}`);
  reportClasses(measured);
  const all = attributable(measured);
  console.log(
    `[fuzzy] recall AGGREGATE: reached ${pct(reachedIn(all), all.length)} · ` +
      `visible ${pct(visibleIn(all), all.length)} · suppressed ${suppressedIn(all).length}`,
  );
  const split = exactSplit(measured);
  const screened = split.matched.length + split.suppressed.length + split.absent.length;
  console.log(
    '[fuzzy] recall EXACT (resolved = matched + suppressed): ' +
      `${pct(split.matched.length + split.suppressed.length, screened)} · ` +
      `matched ${split.matched.length} · suppressed ${split.suppressed.length} · ` +
      `absent-from-index ${split.absent.length} · unobserved ${split.unobserved.length}`,
  );
  console.log(`[fuzzy] EXACT suppressed (found, withheld): ${split.suppressed.join(' | ') || '(none)'}`);
  console.log(`[fuzzy] EXACT absent-from-index (SEEDING GAP): ${split.absent.join(' | ') || '(none)'}`);
  const describe = (rows: (Screened | null)[]): string =>
    rows
      .map(row => (row ? `'${row.query}'=${row.matchCount}vis+${row.suppressedNames.length}sup` : '(unobserved)'))
      .join(' ');
  console.log(`[fuzzy] negative controls: ${describe(measured.negatives)}`);
  console.log(`[fuzzy] common-name controls: ${describe(measured.common)}`);
}
