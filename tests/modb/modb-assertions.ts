// MODB-2 Q5 — contract assertions shared by the MODB API suite: integration trace, source labels, the screened
// AML result (score, adverse media, case detail) and the cancelled AML row. API contract only, never a page.
//
// D-MODB-AM-15 "Adverse media fully OFF by default, with a per-tenant MASTER switch for development"
// (owner, 2026-09-21): the gateway tenant 706772f5 has the adverse-media master OFF, so every screened row reports
// `adverse_media_status=NotReported` and the case lists only the `local` source (measured on staging 2026-09-21).
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ADVERSE_MEDIA_STATUSES,
  AML_CHECK,
  AML_DECISIONS,
  MODB_AML_MODE,
  SOURCE_BY_CHECK,
  type CheckRow,
} from './modb-helpers.js';
import { amlCase as readAmlCase } from './modb-session-helpers.js';
import { newScreenLedger, recordScreen } from './modb-guards.js';

/** Gateway aml-retry.policy.ts:11 — every non-screen ends review under this code. */
const AML_UNAVAILABLE_CODE = 'AML_UNAVAILABLE';

const OUTCOME_BY_DECISION: Record<string, string> = { Pass: 'passed', Review: 'review', Fail: 'failed' };
/** Ordered steps of `result.integration_trace`. aml_received_at and reply_received_at exist only on the queue path. */
const QUEUE_TRACE_STEPS = ['queued_at', 'dispatched_at', 'aml_received_at', 'reply_received_at', 'completed_at'];
const HTTP_TRACE_STEPS = ['queued_at', 'dispatched_at', 'completed_at'];

/** This worker's screened results; the spec's afterAll fails the run when none observed a positive screen. */
export const screenLedger = newScreenLedger();

/** Records a screened result. One that did not observe AM Ok with score > 0 is also listed by the afterAll verdict. */
export function recordAdverseMedia(note: string, amStatus: unknown, score: unknown): void {
  test.info().annotations.push({ type: 'aml', description: note });
  if (!recordScreen(screenLedger, note, amStatus, score)) test.info().annotations.push({ type: 'aml-not-observed', description: note });
}

interface IntegrationTrace {
  mode: string;
  attempts: { n: number }[];
  [step: string]: unknown;
}

/** Every row carries `source`, and it is the label CHECK_PROVIDER_SOURCES gives that check type. */
export function expectSources(rows: CheckRow[]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(SOURCE_BY_CHECK, `${row.check_type} has no expected source label`).toHaveProperty(row.check_type);
    expect(row.source, `${row.check_type} source`).toBe(SOURCE_BY_CHECK[row.check_type]);
  }
}

/**
 * `integration_trace` as the FIRST terminal response carries it (gateway 7d0e0af writes the terminal status and
 * completed_at atomically, and stamps dispatched_at before publish): the run's mode, every step non-null and
 * non-decreasing with no tolerance (one k3s node, one clock), first attempt n=1.
 */
export function expectIntegrationTrace(aml: CheckRow): void {
  const trace = (aml.result ?? {}).integration_trace as IntegrationTrace | undefined;
  expect(trace, 'result.integration_trace').toBeDefined();
  const { mode, attempts } = trace as IntegrationTrace;
  expect(mode).toBe(MODB_AML_MODE);
  const steps = MODB_AML_MODE === 'queue' ? QUEUE_TRACE_STEPS : HTTP_TRACE_STEPS;
  let previous = Number.NEGATIVE_INFINITY;
  for (const step of steps) {
    const at = Date.parse(String((trace as IntegrationTrace)[step]));
    expect(Number.isNaN(at), `integration_trace.${step} = ${(trace as IntegrationTrace)[step]}`).toBe(false);
    expect(at, `integration_trace.${step} must not precede the step before it: ${JSON.stringify(trace)}`).toBeGreaterThanOrEqual(previous);
    previous = at;
  }
  expect(attempts.length).toBeGreaterThanOrEqual(1);
  expect(attempts[0].n).toBe(1);
}

/**
 * A screened AML row and its case detail. Adverse media is OFF for the gateway tenant (D-MODB-AM-15), so the status
 * is `NotReported` and only the local source ran. A positive score must still come with matches (watchlist).
 */
export async function expectScreenedAml(request: APIRequestContext, requestId: string, aml: CheckRow): Promise<void> {
  expect(aml.status, JSON.stringify(aml.error)).toBe('completed');
  expect(aml.error).toBeNull();
  expectIntegrationTrace(aml);
  const result = aml.result ?? {};
  expect(result.screening_id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
  expect(AML_DECISIONS).toContain(result.decision);
  // outcome is derived from the AML decision alone (gateway decisionToOutcome), never from AM status.
  expect(aml.outcome).toBe(OUTCOME_BY_DECISION[result.decision as string]);
  expect(typeof result.score, `score = ${JSON.stringify(result.score)}`).toBe('number');
  expect(result).toHaveProperty('adverse_media_status');
  const amStatus = result.adverse_media_status as string;
  expect(ADVERSE_MEDIA_STATUSES).toContain(amStatus);
  // D-MODB-AM-15: the gateway tenant has the adverse-media master OFF, so the stage is not reported in any mode.
  expect(amStatus, 'the gateway tenant has adverse media OFF (D-MODB-AM-15)').toBe('NotReported');

  const caseRead = await readAmlCase(request, requestId);
  expect(caseRead.status(), await caseRead.text()).toBe(200);
  const caseData = (await caseRead.json()).data;
  expect(caseData.screening_id).toBe(result.screening_id);
  expect(caseData.adverse_media_status).toBe(amStatus);
  const sources = (caseData.sources as { source: string }[]).map((entry) => entry.source);
  // D-MODB-AM-15: the adverse-media source must not appear while the tenant's master is OFF.
  expect(sources, 'only the local watchlist runs for the gateway tenant (D-MODB-AM-15)').toEqual(['local']);
  expect(Array.isArray(caseData.matches)).toBe(true);

  const note = `${requestId} decision=${result.decision} score=${result.score} am=${amStatus} matches=${caseData.matches.length}`;
  recordAdverseMedia(note, amStatus, result.score);
  if ((result.score as number) > 0) expect(caseData.matches.length, `score > 0 but ${note}`).toBeGreaterThan(0);
}

/**
 * The AML row for a scenario that never reaches a screening. Owner decision 2026-09-22 20:20
 * (MODB-E2E-REVIEWMODEL-1): the AML check ALWAYS ends `completed`; a technical or precondition
 * failure (unavailable / expiry / identity missing / MRZ not passed) ends `review` with
 * AML_UNAVAILABLE and states its cause first in the message. Measured on gateway 8574303:
 * aml-screening.service.ts:186-192 -> prisma-aml-screening-row.store.ts:50-68 (insertUnavailable
 * writes status=completed, outcome=review, errorCode=AML_UNAVAILABLE, message=`<cause>: <text>`).
 * No screening exists behind it, so the aml-case read is still a 404.
 */
export async function expectUnavailableAml(
  request: APIRequestContext,
  requestId: string,
  aml: CheckRow,
): Promise<void> {
  expect(aml.check_type).toBe(AML_CHECK);
  expect(aml.status, JSON.stringify(aml.error ?? aml.error_code)).toBe('completed');
  expect(aml.outcome).toBe('review');
  expect(aml.result).toBeNull();
  // check-response.dto.ts:162-176: a COMPLETED row exposes a FLAT `error_code`; the nested `error`
  // object (code + message) is emitted only while status !== 'completed'. So the stated cause
  // (`AML_MRZ_NOT_PASSED: ...`, stored in error_message) is not readable through this API today.
  expect(aml.error_code).toBe(AML_UNAVAILABLE_CODE);
  expect(aml.error ?? null).toBeNull();
  const missing = await readAmlCase(request, requestId);
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error?.code).toBe('AML_SCREENING_NOT_FOUND');
}
