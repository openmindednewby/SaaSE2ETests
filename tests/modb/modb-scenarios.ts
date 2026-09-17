// MODB-2 Q5 — the D-INT-12 demo scenarios, mirrored as DATA from wl-mvp-frontend `lib/demo-scenarios.ts`
// (feature/modb-staging-wave2, 988c72e: 9 scenarios, the no_callback ones dropped). Deliberately NOT imported across repos: when the two drift, this suite
// and that file disagree in review instead of silently agreeing. Each `expected` line is copied verbatim; the
// structured fields below it are what the suite asserts, derived from that line and nothing else.
import type { MockOutcome } from './modb-helpers.js';

export const MOCK_CHECK_TYPES = [
  'liveness',
  'face_match',
  'mrz_match',
  'utility_extraction',
  'utility_authenticity',
] as const;
export type MockCheckType = (typeof MOCK_CHECK_TYPES)[number];
export type ScenarioOutcomes = Record<MockCheckType, MockOutcome>;

/** screened | cancelled at once | cancelled only after the required check's ~3 h callback timeout. */
export type AmlExpectation = 'screened' | 'cancelled' | 'cancelled_after_timeout';

export interface AmlCancel {
  code: string;
  /** A substring of the AML row's `error.message`. */
  message: string;
}

export interface ModbScenario {
  id: string;
  outcomes: ScenarioOutcomes;
  aml: AmlExpectation;
  /** Set only where the scenario text states the AML decision. */
  amlDecision?: 'Pass';
  /** Set for `cancelled`: the reason the gateway gives (aml-screening.service.ts `evaluate`). */
  cancel?: AmlCancel;
  /** Checks the scenario text says fail after 3 attempts on a failed dependency, whatever their mock outcome. */
  dependencyFailed?: MockCheckType[];
  expected: string;
}

const ALL_PASSED: ScenarioOutcomes = {
  liveness: 'passed',
  face_match: 'passed',
  mrz_match: 'passed',
  utility_extraction: 'passed',
  utility_authenticity: 'passed',
};

const NOT_PASSED = 'AML_REQUIRED_CHECK_NOT_PASSED';
const NOT_COMPLETED = 'AML_REQUIRED_CHECK_NOT_COMPLETED';

export const MODB_SCENARIOS: readonly ModbScenario[] = [
  {
    id: 'happy-path',
    outcomes: { ...ALL_PASSED },
    aml: 'screened',
    amlDecision: 'Pass',
    expected: 'All 5 checks Passed · AML Pass on the ERIKSSON specimen (potential watchlist match reviewed under tenant policy)',
  },
  {
    id: 'mrz-failed',
    outcomes: { ...ALL_PASSED, mrz_match: 'failed' },
    aml: 'cancelled',
    cancel: { code: NOT_PASSED, message: 'Required check mrz_match completed with outcome failed; AML screening was not requested.' },
    expected: 'MRZ match Failed · AML Cancelled: required check mrz_match completed with outcome failed',
  },
  {
    id: 'mrz-review',
    outcomes: { ...ALL_PASSED, mrz_match: 'review' },
    aml: 'cancelled',
    cancel: { code: NOT_PASSED, message: 'Required check mrz_match completed with outcome review; AML screening was not requested.' },
    expected: 'MRZ match Needs review · AML Cancelled: mrz_match completed with outcome review (AML screens only on pass)',
  },
  {
    id: 'mrz-service-error',
    outcomes: { ...ALL_PASSED, mrz_match: 'check_failed' },
    aml: 'cancelled',
    cancel: { code: NOT_COMPLETED, message: 'Required check mrz_match ended failed; AML screening was not requested.' },
    dependencyFailed: ['utility_authenticity'],
    expected:
      'MRZ match Failed (service error) · AML Cancelled: mrz_match ended failed · Utility authenticity Failed after 3 attempts (~15 s)',
  },
  {
    id: 'face-match-failed',
    outcomes: { ...ALL_PASSED, face_match: 'failed' },
    aml: 'screened',
    amlDecision: 'Pass',
    expected: 'Face match Failed · AML still screens (Pass on the ERIKSSON specimen)',
  },
  {
    id: 'selfie-review',
    outcomes: { ...ALL_PASSED, liveness: 'review', face_match: 'review' },
    aml: 'screened',
    expected: 'Liveness and Face match Needs review · AML still screens',
  },
  {
    id: 'utility-extraction-error',
    outcomes: { ...ALL_PASSED, utility_extraction: 'check_failed' },
    aml: 'screened',
    dependencyFailed: ['utility_authenticity'],
    expected:
      'Utility extraction Failed (service error) · Utility authenticity Failed after 3 attempts (~15 s, dependency failed) · AML still screens',
  },
  {
    id: 'utility-authenticity-failed',
    outcomes: { ...ALL_PASSED, utility_authenticity: 'failed' },
    aml: 'screened',
    expected: 'Utility authenticity Failed · AML still screens',
  },
  {
    id: 'mixed',
    outcomes: {
      liveness: 'passed',
      face_match: 'review',
      mrz_match: 'passed',
      utility_extraction: 'review',
      utility_authenticity: 'failed',
    },
    aml: 'screened',
    expected: 'Face match and Utility extraction Needs review, Utility authenticity Failed · AML still screens',
  },
];

/**
 * Suite-only, OPT-IN (MODB_E2E_NO_CALLBACK=1). Dropped from the frontend in 988c72e because each one holds its
 * check's single worker slot for ~3 h on staging. Kept here so the non-terminal-after-dispatch contract stays written.
 */
export const MODB_NO_CALLBACK_SCENARIOS: readonly ModbScenario[] = [
  {
    id: 'mrz-no-callback',
    outcomes: { ...ALL_PASSED, mrz_match: 'no_callback' },
    aml: 'cancelled_after_timeout',
    expected:
      'Slow: MRZ match stays Running for up to ~3 h (3 attempts x 60 min callback wait), then Failed · AML waits, then Cancelled',
  },
  {
    id: 'liveness-no-callback',
    outcomes: { ...ALL_PASSED, liveness: 'no_callback' },
    aml: 'screened',
    expected:
      'AML screens without waiting · Liveness stays Running for up to ~3 h (3 attempts x 60 min callback wait), then Failed',
  },
];

/** Checks a scenario leaves non-terminal for ~3 h: every `no_callback` check, plus AML when it waits on one. */
export function pendingChecks(scenario: ModbScenario): string[] {
  const silent = MOCK_CHECK_TYPES.filter((checkType) => scenario.outcomes[checkType] === 'no_callback');
  return scenario.aml === 'cancelled_after_timeout' ? [...silent, 'aml_screening'] : silent;
}

export interface ExpectedCheck {
  status: string;
  outcome: string | null;
}

/** The terminal row a mock outcome produces (probe 2026-09-17: check_failed -> status failed, outcome null). */
export function expectedCheck(scenario: ModbScenario, checkType: MockCheckType): ExpectedCheck {
  if (scenario.dependencyFailed?.includes(checkType)) return { status: 'failed', outcome: null };
  const outcome = scenario.outcomes[checkType];
  if (outcome === 'check_failed') return { status: 'failed', outcome: null };
  return { status: 'completed', outcome };
}
