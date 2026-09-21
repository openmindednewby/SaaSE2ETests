// MODB-2 D-INT-16e: the AMLService processing-trace contract, shared by the gateway (queue, snake_case
// `integration_trace.aml_processing`) and AMLService itself (sync + async, camelCase `processingTrace`).
//
// The gateway stands in queue mode, so the sync and async channels are driven against AMLService DIRECTLY with
// the gateway's own AML key (staging secret modb-secrets/AML_API_KEY):
//   MODB_AML_URL      AMLService base URL. .env.local / .env.staging carry the staging NodePort (WireGuard).
//   MODB_AML_API_KEY  the gateway's AML tenant key, in .env.<target>.secrets (gitignored). Never logged.
// Unset FAILS the run with the variable's name; it never skips.
//
// 🔴 LIMIT: these calls HAND-ASSEMBLE the verification payload. They test AMLService's server contract, not the
// gateway client's request shape (the queue test covers the gateway path end to end).
import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

export const AML_URL_ENV = 'MODB_AML_URL';
export const AML_KEY_ENV = 'MODB_AML_API_KEY';
/** AMLService `ScreeningStageOutcomes` (ScreeningStageTimings.cs:7-19). */
export const TRACE_OUTCOMES = ['ok', 'timedOut', 'failed', 'skipped'];
/** The synthetic ICAO specimen the MRZ mock returns (ModuleBMock IdentityResultFactory.cs:79). Not a real person. */
export const SPECIMEN_IDENTITY = { surname: 'ERIKSSON', given_names: ['ANNA', 'MARIA'] };
export const WEBHOOK_COMPLETED_EVENT = 'verification_screening.completed';
const REQUEST_TIMEOUT_MS = 30_000;

export interface StageTiming {
  started_at: string;
  elapsed_ms: number;
  outcome: string;
}

export interface AmAttempt {
  n: number;
  step_reached: string;
  elapsed_ms: number;
  outcome: string;
}

/** The pinned 16c/16d shape. `am_attempt_count` and `partial` are gateway-only additive keys. */
export interface AmlProcessing {
  channel: string;
  received_at: string;
  processing_ms: number;
  stages: { local_watchlist?: StageTiming | null; adverse_media?: StageTiming | null };
  am_attempts: AmAttempt[] | null;
  reply_published_at: string | null;
  am_attempt_count?: number;
  partial?: boolean;
}

function required(name: string): string {
  const raw = process.env[name]?.trim();
  if (raw) return raw;
  const where = name === AML_KEY_ENV ? 'the gateway AML key belongs in .env.<target>.secrets' : 'set it to the AMLService base URL';
  throw new Error(`${name} is unset (E2E_TARGET=${process.env.E2E_TARGET ?? 'local'}): ${where}.`);
}

function amlUrl(path: string): string {
  return `${required(AML_URL_ENV).replace(/\/+$/, '')}${path}`;
}

function amlHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', 'x-api-key': required(AML_KEY_ENV), ...extra };
}

/** camelCase keys to snake_case, recursively, so AMLService's trace is checked against the gateway's pinned shape. */
export function toSnake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnake);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), toSnake(inner)]),
  );
}

/** POST a contract verification-screening.v1 request (MRZ passed, the specimen identity) to the sync or async route. */
export async function postVerification(request: APIRequestContext, asyncChannel: boolean): Promise<{ requestId: string; response: APIResponse }> {
  const requestId = randomUUID();
  const path = asyncChannel ? '/v1/screenings/verification/async' : '/v1/screenings/verification';
  const response = await request.post(amlUrl(path), {
    headers: amlHeaders({ 'idempotency-key': requestId }),
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
    data: {
      contract_version: '1.0',
      request_id: requestId,
      tenant_id: null,
      verification_outcome: 'passed',
      checks: [{ check_type: 'mrz_match', status: 'completed', outcome: 'passed', completed_at: new Date().toISOString() }],
      identity: SPECIMEN_IDENTITY,
    },
  });
  return { requestId, response };
}

export function amlGet(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.get(amlUrl(path), { headers: amlHeaders(), timeout: REQUEST_TIMEOUT_MS, failOnStatusCode: false });
}

/** True when the key's tenant has an ACTIVE webhook endpoint subscribed to the completed event (read live). */
export async function hasSubscribedWebhook(request: APIRequestContext): Promise<boolean> {
  const response = await amlGet(request, '/v1/webhooks');
  expect(response.status(), 'GET /v1/webhooks').toBe(200);
  const endpoints = (await response.json()) as { active?: boolean; events?: string[] }[];
  return endpoints.some((endpoint) => endpoint.active === true && (endpoint.events ?? []).includes(WEBHOOK_COMPLETED_EVENT));
}

function expectTimestamp(value: unknown, label: string): number {
  const at = Date.parse(String(value));
  expect(Number.isNaN(at), `${label} = ${JSON.stringify(value)}`).toBe(false);
  return at;
}

function expectStage(stage: StageTiming | null | undefined, label: string, receivedAt: number): void {
  expect(stage, label).toBeTruthy();
  const { started_at: startedAt, elapsed_ms: elapsedMs, outcome } = stage as StageTiming;
  expect(expectTimestamp(startedAt, `${label}.started_at`), `${label} starts after receipt`).toBeGreaterThanOrEqual(receivedAt);
  expect(elapsedMs, `${label}.elapsed_ms`).toBeGreaterThanOrEqual(0);
  expect(TRACE_OUTCOMES, `${label}.outcome`).toContain(outcome);
}

/** The trace carries timings and step names only: no part of the subject's name, in any case. */
export function expectNoSubjectName(trace: unknown): void {
  const json = JSON.stringify(trace).toUpperCase();
  for (const part of [SPECIMEN_IDENTITY.surname, ...SPECIMEN_IDENTITY.given_names]) expect(json, `trace leaks "${part}"`).not.toContain(part);
}

/** A complete (non-partial) processing trace of `channel`, in the pinned snake_case shape. Returns it typed. */
export function expectAmlProcessing(raw: unknown, channel: string): AmlProcessing {
  expect(raw, 'processing trace').toBeTruthy();
  const trace = raw as AmlProcessing;
  const dump = JSON.stringify(trace);
  expect(trace.channel, dump).toBe(channel);
  const receivedAt = expectTimestamp(trace.received_at, 'received_at');
  expect(trace.processing_ms, `processing_ms ${dump}`).toBeGreaterThan(0);
  expectStage(trace.stages?.local_watchlist, 'stages.local_watchlist', receivedAt);
  // D-MODB-AM-15: the MODB tenant has the adverse-media master OFF, so the stage never runs. Measured 2026-09-21 on
  // queue, sync and the GET read-back: `stages.adverse_media` is null and `am_attempts` is [].
  expect(trace.stages?.adverse_media ?? null, `stages.adverse_media must be absent while adverse media is OFF ${dump}`).toBeNull();
  expect(trace.am_attempts ?? [], `am_attempts must be empty while adverse media is OFF ${dump}`).toEqual([]);
  (trace.am_attempts ?? []).forEach((attempt, index) => {
    expect(attempt.n, `am_attempts[${index}].n`).toBe(index + 1);
    expect(attempt.step_reached, `am_attempts[${index}].step_reached`).toEqual(expect.stringMatching(/\S/));
    expect(attempt.elapsed_ms, `am_attempts[${index}].elapsed_ms`).toBeGreaterThanOrEqual(0);
    expect(TRACE_OUTCOMES, `am_attempts[${index}].outcome`).toContain(attempt.outcome);
  });
  if (trace.reply_published_at !== null) {
    const repliedAt = expectTimestamp(trace.reply_published_at, 'reply_published_at');
    expect(receivedAt, `received_at <= reply_published_at ${dump}`).toBeLessThanOrEqual(repliedAt);
  }
  expectNoSubjectName(trace);
  return trace;
}
