// MODB-2 Q5 — contract assertions shared by the MODB API suite: integration trace, source labels, the screened
// AML result (score, adverse media, case detail) and the cancelled AML row. API contract only, never a page.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ADVERSE_MEDIA_STATUSES,
  AML_CHECK,
  AML_DECISIONS,
  MODB_AML_MODE,
  SOURCE_BY_CHECK,
  getAmlCase,
  type CheckRow,
} from './modb-helpers.js';

const OUTCOME_BY_DECISION: Record<string, string> = { Pass: 'passed', Review: 'review', Fail: 'failed' };
/** Ordered steps of `result.integration_trace`. aml_received_at and reply_received_at exist only on the queue path. */
const QUEUE_TRACE_STEPS = ['queued_at', 'dispatched_at', 'aml_received_at', 'reply_received_at', 'completed_at'];
const HTTP_TRACE_STEPS = ['queued_at', 'dispatched_at', 'completed_at'];

interface IntegrationTrace {
  mode: string;
  attempts: { n: number }[];
  [step: string]: unknown;
}

/** Every row carries `source`, and it is the label CHECK_PROVIDER_SOURCES gives that check type. */
export function expectSources(rows: CheckRow[]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.source, `${row.check_type} source`).toBe(SOURCE_BY_CHECK[row.check_type]);
  }
}

/** `integration_trace`: the run's mode, every step timestamp non-null and non-decreasing, first attempt n=1. */
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
 * A screened AML row and its case detail. The mock identity is always the ERIKSSON specimen
 * (ModuleBMock IdentityResultFactory.cs:79), whose matches all come from adverse media, so AM `Ok` must yield a
 * positive score and matches; AM not `Ok` is recorded as an annotation, never passed off as clean.
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
  // Every transport now carries the AM status (Q1/Q2), so NotReported is a defect in all three modes.
  expect(amStatus).not.toBe('NotReported');

  const amlCase = await getAmlCase(request, requestId);
  expect(amlCase.status()).toBe(200);
  const caseData = (await amlCase.json()).data;
  expect(caseData.screening_id).toBe(result.screening_id);
  expect(caseData.adverse_media_status).toBe(amStatus);
  const sources = (caseData.sources as { source: string }[]).map((entry) => entry.source);
  expect(sources).toEqual(expect.arrayContaining(['local', 'adverse-media']));
  expect(Array.isArray(caseData.matches)).toBe(true);

  const note = `${requestId} decision=${result.decision} score=${result.score} am=${amStatus} matches=${caseData.matches.length}`;
  test.info().annotations.push({ type: 'aml', description: note });
  if (amStatus !== 'Ok') return;
  expect(result.score as number, `AM Ok but ${note}`).toBeGreaterThan(0);
  expect(caseData.matches.length, `AM Ok but ${note}`).toBeGreaterThan(0);
}

/** A cancelled AML row: no result, the stated reason, and no screening behind it. */
export async function expectCancelledAml(
  request: APIRequestContext,
  requestId: string,
  aml: CheckRow,
  reason: { code: string; message: string },
): Promise<void> {
  expect(aml.check_type).toBe(AML_CHECK);
  expect(aml.status).toBe('cancelled');
  expect(aml.outcome).toBeNull();
  expect(aml.result).toBeNull();
  expect(aml.error?.code).toBe(reason.code);
  expect(aml.error?.message).toContain(reason.message);
  const missing = await getAmlCase(request, requestId);
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error?.code).toBe('AML_SCREENING_NOT_FOUND');
}
