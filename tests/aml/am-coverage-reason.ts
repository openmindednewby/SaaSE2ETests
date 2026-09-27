// STG-RECOVER-1 "Staging root cause and pending" D1/D2, SCREEN-PERF-1 Q20: why an adverse-media screen is
// 'Unavailable'. A name with zero indexed articles is Unavailable, not Ok, while the index does not reach the
// retention start (AdverseMediaCoverageRule.cs:59-66; index starts 2026-05-28). The screening response carries
// no reason string, so the reason is read from its fingerprint: a coverage window IS reported
// (adverseMediaCoverageFrom/To; the "no coverage window" path, GdeltAdverseMediaProvider.cs:216-221, leaves
// them null) and zero adverse-media matches.
import { expect } from '@playwright/test';
import { amOf, type AmScreen } from './am-hit-helpers.js';

export const AM_UNAVAILABLE = 'Unavailable';
/** The wording of AdverseMediaCoverageRule.cs:66 and the log line at GdeltAdverseMediaProvider.cs:235. */
export const COVERAGE_INCOMPLETE = 'index coverage incomplete';
/** Names with zero indexed adverse-media articles (the first confirmed zero in pod logs 2026-09-27). */
export const ZERO_HIT_SUBJECTS: readonly string[] = ['Warm Up Subject', 'Zyqorth Vandelmaar'];

export interface ScreenBody extends Partial<AmScreen> {
  diagnostics?: { totalMs?: number } | null;
  adverseMediaCoverageFrom?: string | null;
  adverseMediaCoverageTo?: string | null;
}

/** GdeltAdverseMediaProvider.cs:235 is the only Unavailable path that reports a window AND finds no article. */
export function unavailableReason(body: ScreenBody): string {
  const window = Boolean(body.adverseMediaCoverageFrom) && Boolean(body.adverseMediaCoverageTo);
  const articles = amOf({ ...body, matchedEntities: body.matchedEntities ?? [] } as AmScreen).length;
  if (window && articles === 0) return COVERAGE_INCOMPLETE;
  return window ? `window reported but ${articles} AM matches` : 'no coverage window (index not consulted)';
}

/** For the served status: the Unavailable reason, or null when the status is anything else. */
export function reasonFor(body: ScreenBody | null, amStatus: string): string | null {
  return body && amStatus === AM_UNAVAILABLE ? unavailableReason(body) : null;
}

/** A warm-up may be Unavailable only because the index window is short; any other reason fails by name. */
export function expectWarmUpReason(amStatus: string, reason: string | null, who: string): void {
  if (amStatus !== AM_UNAVAILABLE) return;
  expect(reason, `${who} is Unavailable for a reason other than "${COVERAGE_INCOMPLETE}"`).toBe(COVERAGE_INCOMPLETE);
}

/** One line per zero-hit sample, compared against the only acceptable answer. */
export const zeroHitLine = (subject: string, status: number, amStatus: string, reason: string | null): string =>
  `${subject}: HTTP ${status} ${amStatus} / ${reason ?? '-'}`;
