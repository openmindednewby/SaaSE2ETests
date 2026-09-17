// @aml-api tier — D-INT-17 "aml-v2 integration test + how-to-test pages", acceptance tests
// AC-17-4, AC-17-8, AC-17-9, AC-17-11, AC-17-12, AC-17-21. Pure HTTP against the deployed
// AMLService; no browser, per the house rule that E2E drives the API.
//
// Committed RED before 17b. AC-17-21 is red on missing implementation: the D-INT-24 option-2
// operator-gated publish endpoint (`POST /v1/screenings/verification/queue-test`) does not exist,
// so the service answers 404 where the criterion requires a 401/403 refusal.
//
// Every request goes through `call()`, which converts a transport failure into `status: 0` instead
// of throwing, so each test REACHES its assertion and reports what it saw rather than a stack.
//
// Env:  AML_API_URL (default staging) · AML_API_KEY (a TEST-class demo-tenant key)
//       AML_OTHER_TENANT_SCREENING_ID (optional: a screening owned by a different tenant)
//
// Locked per SPEC-1 Q7 (.claude/hooks/acceptance-lock.js).
import { expect, test, type APIRequestContext } from '@playwright/test';

const AML_API_URL = (process.env.AML_API_URL?.trim() || 'https://aml-screening.dloizides.com').replace(/\/$/, '');
const AML_API_KEY = process.env.AML_API_KEY?.trim() || '';
const OTHER_TENANT_SCREENING_ID = process.env.AML_OTHER_TENANT_SCREENING_ID?.trim() || '00000000-0000-4000-8000-0000000d1e17';

const REFUSED_WITHOUT_KEY = [401, 403];
const REQUEST_TIMEOUT_MS = 30_000;
/** Bounded read-back for the async channel (spec §4.3: a stated ceiling, never an unbounded loop). */
const ASYNC_POLL_CEILING = 20;
const ASYNC_POLL_INTERVAL_MS = 1_500;
/** Fields that would mean personal data reached the trace. */
const PII_FIELDS = ['fullName', 'firstName', 'lastName', 'dateOfBirth', 'documentNumber', 'nationalId', 'email'];

interface Call {
  status: number;
  body: Record<string, unknown>;
  error: string | null;
}

async function call(
  request: APIRequestContext,
  method: 'get' | 'post',
  path: string,
  options: { key?: string; bearer?: string; data?: unknown } = {},
): Promise<Call> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.key) headers['X-Api-Key'] = options.key;
  if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
  try {
    const response = await request[method](`${AML_API_URL}${path}`, {
      headers,
      data: options.data as Record<string, unknown> | undefined,
      timeout: REQUEST_TIMEOUT_MS,
      failOnStatusCode: false,
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: response.status(), body, error: null };
  } catch (cause) {
    return { status: 0, body: {}, error: String(cause) };
  }
}

/** First assertion of every test: the target answered at all. A 0 here is the environment, not the code. */
async function expectReachable(request: APIRequestContext): Promise<void> {
  const version = await call(request, 'get', '/version');
  expect(version.status === 200 ? 'reachable' : `AML API UNREACHABLE at ${AML_API_URL} (status ${version.status}) ${version.error ?? ''}`).toBe('reachable');
}

/** A test-class key is required to run anything; its absence is a stated failure, not a silent skip. */
function expectTestKey(): string {
  expect(AML_API_KEY ? 'present' : 'AML_API_KEY is not set: the Test lab acceptance runs need a TEST-class demo key').toBe('present');
  return AML_API_KEY;
}

const syntheticSubject = (suffix: string) => ({
  fullName: `Test Synthetic ${suffix}`,
  dateOfBirth: '1980-01-01',
  countryCode: 'CY',
  externalReference: `d-int-17-${suffix}`,
});

const traceOf = (body: Record<string, unknown>): Record<string, unknown> | null =>
  (body.processingTrace as Record<string, unknown> | undefined) ?? null;

test.describe('D-INT-17 integration trace and test lab @aml-api', () => {
  test('AC-17-4: the SERVICE refuses a verification run without an api key, UI gate removed from the path', async ({ request }) => {
    await expectReachable(request);

    const noKey = await call(request, 'post', '/v1/screenings/verification', { data: syntheticSubject('nokey') });
    expect(REFUSED_WITHOUT_KEY).toContain(noKey.status);

    // The operator's Bearer session is NOT an accepted scheme on this route (spec §3.2.2). The
    // boundary is the endpoint, not the hidden button.
    const bearerOnly = await call(request, 'post', '/v1/screenings/verification', {
      bearer: 'not-a-session',
      data: syntheticSubject('bearer'),
    });
    expect(REFUSED_WITHOUT_KEY).toContain(bearerOnly.status);
    expect(bearerOnly.body.screeningId).toBeUndefined();
  });

  test('AC-17-8: GET /v1/screenings/{id} returns a complete processingTrace carrying no personal data', async ({ request }) => {
    await expectReachable(request);
    const key = expectTestKey();

    const run = await call(request, 'post', '/v1/screenings/verification', { key, data: syntheticSubject('trace') });
    expect(run.status).toBe(201);
    const screeningId = String(run.body.screeningId ?? run.body.id ?? '');
    expect(screeningId).not.toHaveLength(0);

    const read = await call(request, 'get', `/v1/screenings/${screeningId}`, { key });
    expect(read.status).toBe(200);
    const trace = traceOf(read.body);
    expect(trace ? 'present' : 'NOT IMPLEMENTED: the read-back carried no processingTrace').toBe('present');
    expect(Object.keys(trace ?? {})).toEqual(
      expect.arrayContaining(['channel', 'receivedAt', 'processingMs', 'stages', 'amAttempts', 'replyPublishedAt']),
    );
    const stages = (trace?.stages ?? {}) as Record<string, unknown>;
    expect(Object.keys(stages)).toEqual(expect.arrayContaining(['localWatchlist', 'adverseMedia']));

    const traceJson = JSON.stringify(trace);
    expect(PII_FIELDS.filter((field) => traceJson.includes(`"${field}"`))).toEqual([]);
  });

  test('AC-17-9: a screening owned by another tenant does not return its trace', async ({ request }) => {
    await expectReachable(request);
    const key = expectTestKey();

    const read = await call(request, 'get', `/v1/screenings/${OTHER_TENANT_SCREENING_ID}`, { key });
    expect([403, 404]).toContain(read.status);
    expect(traceOf(read.body)).toBeNull();
  });

  test('AC-17-11: a sync run returns 201 and the stored screening reads channel "sync"', async ({ request }) => {
    await expectReachable(request);
    const key = expectTestKey();

    const run = await call(request, 'post', '/v1/screenings/verification', { key, data: syntheticSubject('sync') });
    expect(run.status).toBe(201);
    const screeningId = String(run.body.screeningId ?? run.body.id ?? '');
    expect(screeningId).not.toHaveLength(0);

    const read = await call(request, 'get', `/v1/screenings/${screeningId}`, { key });
    expect(read.status).toBe(200);
    expect(traceOf(read.body)?.channel).toBe('sync');
  });

  test('AC-17-12: an async run returns 202, reads back as channel "async", and the poll stops at its ceiling', async ({ request }) => {
    await expectReachable(request);
    const key = expectTestKey();

    const run = await call(request, 'post', '/v1/screenings/verification/async', { key, data: syntheticSubject('async') });
    expect(run.status).toBe(202);
    const screeningId = String(run.body.screeningId ?? '');
    expect(screeningId).not.toHaveLength(0);
    expect(String(run.body.requestId ?? '')).not.toHaveLength(0);

    let attempts = 0;
    let read: Call = { status: 0, body: {}, error: null };
    while (attempts < ASYNC_POLL_CEILING) {
      attempts += 1;
      read = await call(request, 'get', `/v1/screenings/${screeningId}`, { key });
      if (read.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS));
    }
    // The bound is the criterion: a 404 while the screen is still running is expected, an unbounded
    // wait is not.
    expect(attempts).toBeLessThanOrEqual(ASYNC_POLL_CEILING);
    expect(read.status).toBe(200);
    expect(traceOf(read.body)?.channel).toBe('async');
  });

  test('AC-17-21: the queue publish endpoint refuses everything outside its operator/test-class guard', async ({ request }) => {
    await expectReachable(request);
    const path = '/v1/screenings/verification/queue-test';

    const noKey = await call(request, 'post', path, { data: syntheticSubject('queue-nokey') });
    expect(noKey.status === 404 ? 'NOT IMPLEMENTED: the D-INT-24 queue publish endpoint does not exist' : 'implemented').toBe('implemented');
    expect(REFUSED_WITHOUT_KEY).toContain(noKey.status);

    // A tenant session must never reach a broker-publishing route (D-INT-24 guard).
    const bearerOnly = await call(request, 'post', path, { bearer: 'not-a-session', data: syntheticSubject('queue-bearer') });
    expect(REFUSED_WITHOUT_KEY).toContain(bearerOnly.status);

    // The demo test-class key is not a platform operator: role is the guard, not key class alone.
    const tenantKey = await call(request, 'post', path, { key: AML_API_KEY || 'no-key', data: syntheticSubject('queue-tenant') });
    expect(tenantKey.status).toBe(403);
    expect(tenantKey.body.requestId).toBeUndefined();
  });
});
