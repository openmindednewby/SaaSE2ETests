// @modb-api tier — MODB-2 D-INT-16e: AMLService processing trace (channel, receipt, stage timings, adverse-media
// attempts, reply time) across all three channels, driven over HTTP only. Env + limits: modb-processing-trace.ts.
//
// queue  through the gateway (its standing mode): `integration_trace.aml_processing` on /checks and aml-case.
// sync   AMLService directly: the 201 `processingTrace`, repeated on GET /v1/screenings/{id} and /v1/cases/{id}.
// async  AMLService directly: receipt = acceptance; `replyPublishedAt` only when a webhook endpoint is subscribed.
//
// D-MODB-AM-15 "Adverse media fully OFF by default, with a per-tenant MASTER switch for development"
// (owner, 2026-09-21): the MODB tenant has adverse media OFF, so every channel asserts the adverse-media stage is
// ABSENT (null) with no AM attempts (expectAmlProcessing).
//
// MODB-E2E-MIGRATE-1 (2026-09-23): the QUEUE case now drives the session API (`POST /api/v1/verifications` is
// unregistered on the deployed gateway, MODB-ENDPOINT-1) and reads the case through the operator API. The sync and
// async cases already call AMLService directly and are unchanged.
import { expect, test } from '@playwright/test';
import { MODB_AML_MODE } from './modb-helpers.js';
import {
  AML_CHECK,
  amlCase as readAmlCase,
  assertGatewayReachable,
  requestChecks,
  rowOf,
  waitForAmlTerminal,
} from './modb-session-helpers.js';
import { screenViaSession } from './modb-session-mock.js';
import {
  amlGet,
  expectAmlProcessing,
  hasSubscribedWebhook,
  postVerification,
  toSnake,
  type AmlProcessing,
} from './modb-processing-trace.js';

/** The gateway re-reads the trace once, 2 s after the terminal write (AML_TRACE_REREAD_DELAY_MS, 2f91ecf). */
const REPLY_STAMP_TIMEOUT_MS = 10_000;
/** Async: processing plus the post-enqueue reply stamp, measured ~6 s on staging. */
const ASYNC_TRACE_TIMEOUT_MS = 60_000;
const POLL_INTERVALS_MS = [1_000, 2_000];
/**
 * The HTTP Date header has second precision and Kestrel caches it, refreshed by a ~1 s heartbeat, so the acceptance
 * time can sit up to ~2 s after it (measured +1.69 s on staging). The bound places receipt at the 202, not minutes later.
 */
const ACCEPTED_BEFORE_DATE_MS = 2_000;
const ACCEPTED_AFTER_DATE_MS = 3_000;
/** Screened before AMLService bda9e189 / gateway 2f91ecf existed (MODB-2-INT-checklist). */
const PRE_CHANGE_REQUEST_ID = '7e0c91c6-c019-477e-8c02-92221c075949';

interface GatewayTrace {
  attempts: { n: number }[];
  aml_processing: AmlProcessing | null;
}

test.describe('MODB D-INT-16e processing trace @modb-api', () => {
  test('queue: gateway aml_processing is complete, separate from dispatch attempts, and equal on aml-case', async ({ request }) => {
    await assertGatewayReachable(request);
    expect(MODB_AML_MODE, 'this test gates the standing queue mode').toBe('queue');
    const { session, requestId } = await screenViaSession(request);
    test.info().annotations.push({ type: 'request_id', description: `queue=${requestId} session=${session.sessionId}` });

    let trace: GatewayTrace | undefined;
    await expect
      .poll(
        async () => {
          const aml = rowOf(await waitForAmlTerminal(request, session.sessionId), AML_CHECK);
          expect(aml.status, JSON.stringify(aml.error)).toBe('completed');
          trace = aml.result?.integration_trace as GatewayTrace | undefined;
          return trace?.aml_processing?.reply_published_at ?? null;
        },
        { timeout: REPLY_STAMP_TIMEOUT_MS, intervals: POLL_INTERVALS_MS, message: `aml_processing.reply_published_at of ${requestId}` },
      )
      .not.toBeNull();

    const { attempts, aml_processing: rawProcessing } = trace as GatewayTrace;
    const processing = expectAmlProcessing(rawProcessing, 'queue');
    expect(processing.partial, JSON.stringify(processing)).toBe(false);
    expect(processing.am_attempt_count).toBe(processing.am_attempts?.length);
    // The gateway's own dispatch attempts stay a separate list, without AM step detail.
    expect(Array.isArray(attempts), 'integration_trace.attempts').toBe(true);
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    for (const attempt of attempts) expect(attempt).not.toHaveProperty('step_reached');

    const caseRead = await readAmlCase(request, requestId);
    expect(caseRead.status(), await caseRead.text()).toBe(200);
    const caseData = (await caseRead.json()).data;
    expect(caseData.aml_processing).toEqual(processing);

    // The gateway carries what AMLService recorded for the same screening.
    const own = await amlGet(request, `/v1/screenings/${caseData.screening_id}`);
    expect(own.status()).toBe(200);
    const recorded = expectAmlProcessing(toSnake((await own.json()).processingTrace), 'queue');
    expect(processing.processing_ms).toBe(recorded.processing_ms);
    expect(processing.am_attempts).toEqual(recorded.am_attempts);
    expect(Date.parse(processing.received_at)).toBe(Date.parse(recorded.received_at));
    expect(Date.parse(processing.reply_published_at as string)).toBe(Date.parse(recorded.reply_published_at as string));
  });

  test('sync (AMLService direct): the 201 trace is channel sync with no reply, same on screening and case', async ({ request }) => {
    const { requestId, response } = await postVerification(request, false);
    expect(response.status(), await response.text()).toBe(201);
    const body = await response.json();
    test.info().annotations.push({ type: 'request_id', description: `sync=${requestId} screening=${body.id}` });

    expectAmlProcessing(toSnake(body.processingTrace), 'sync');
    expect(body.processingTrace).toHaveProperty('replyPublishedAt', null);
    for (const path of [`/v1/screenings/${body.id}`, `/v1/cases/${body.id}`]) {
      const read = await amlGet(request, path);
      expect(read.status(), path).toBe(200);
      expect((await read.json()).processingTrace, path).toEqual(body.processingTrace);
    }
  });

  test('async (AMLService direct): channel async, received at acceptance, reply stamped only for a subscribed endpoint', async ({ request }) => {
    const subscribed = await hasSubscribedWebhook(request);
    const { requestId, response } = await postVerification(request, true);
    expect(response.status(), await response.text()).toBe(202);
    const dateHeader = Date.parse(response.headers()['date']);
    const { screeningId } = await response.json();
    test.info().annotations.push({ type: 'request_id', description: `async=${requestId} screening=${screeningId} webhook-subscriber=${subscribed}` });

    let raw: unknown;
    await expect
      .poll(
        async () => {
          const read = await amlGet(request, `/v1/screenings/${screeningId}`);
          if (read.status() !== 200) return `status ${read.status()}`;
          raw = (await read.json()).processingTrace;
          if (!raw) return 'trace not recorded';
          return subscribed && !(raw as { replyPublishedAt?: string }).replyPublishedAt ? 'reply not stamped' : 'ready';
        },
        { timeout: ASYNC_TRACE_TIMEOUT_MS, intervals: POLL_INTERVALS_MS, message: `processingTrace of ${screeningId}` },
      )
      .toBe('ready');

    const trace = expectAmlProcessing(toSnake(raw), 'async');
    const receivedAt = Date.parse(trace.received_at);
    expect(receivedAt, `received_at is the 202's acceptance (Date ${response.headers()['date']})`).toBeGreaterThanOrEqual(dateHeader - ACCEPTED_BEFORE_DATE_MS);
    expect(receivedAt).toBeLessThanOrEqual(dateHeader + ACCEPTED_AFTER_DATE_MS);
    if (subscribed) expect(trace.reply_published_at, 'subscribed endpoint: reply stamped').not.toBeNull();
    else expect(trace.reply_published_at, 'no subscribed endpoint: nothing handed off').toBeNull();
  });

  test('pre-change rows: the trace is null on the gateway and on AMLService, not an error', async ({ request }) => {
    await assertGatewayReachable(request);
    const aml = rowOf(await requestChecks(request, PRE_CHANGE_REQUEST_ID), AML_CHECK);
    expect(aml.status).toBe('completed');
    // 7e0c91c6 predates integration_trace itself (its /checks result has none), so absent-or-null is the contract.
    expect((aml.result?.integration_trace as GatewayTrace | undefined)?.aml_processing ?? null).toBeNull();

    const oldCase = await readAmlCase(request, PRE_CHANGE_REQUEST_ID);
    expect(oldCase.status(), await oldCase.text()).toBe(200);
    const caseData = (await oldCase.json()).data;
    expect(caseData).toHaveProperty('aml_processing', null);
    test.info().annotations.push({ type: 'request_id', description: `old=${PRE_CHANGE_REQUEST_ID} screening=${caseData.screening_id}` });

    for (const path of [`/v1/screenings/${caseData.screening_id}`, `/v1/cases/${caseData.screening_id}`]) {
      const read = await amlGet(request, path);
      expect(read.status(), path).toBe(200);
      expect(await read.json(), path).toHaveProperty('processingTrace', null);
    }
  });
});
