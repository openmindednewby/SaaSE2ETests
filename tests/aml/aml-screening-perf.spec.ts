// SCREEN-PERF-1 "Screening back under 1 s without the SSD" -- gate per owner decision Q19 "Perf gate"
// (2026-09-26, "server gate + looser client", reverses Q10). Task doc:
// BaseClient/docs/Tasks/IN_PROGRESS/SCREEN-PERF-1-screening-latency.md -> "Owner decision Q19".
//
// TWO GATES PER TEST, both p95 over 20 warm samples:
//   SERVER  diagnostics.totalMs (the request sends includeDiagnostics) <= 1000 ms AM OFF / 2000 ms AM ON.
//   CLIENT  the POST round-trip from the E2E host <= 1500 ms AM OFF / 2500 ms AM ON.
// Why: warm server totals measured 33-159 ms while client p95 failed on connection + proxy cost alone
// (new connection +0.55 s, cold first request +1.2-2.3 s). The server gate holds the product to N1;
// the client gate still catches a regression in the path a caller actually sees.
//
// WARM-UP. 2 untimed screenings on the SAME request context first, so the samples reuse its connection.
// The first warm-up's client time is ANNOTATED as the cold first request, never gated (Q19).
//
// RATE LIMIT. Samples are spaced SAMPLE_SPACING_MS apart (~20/min per tenant; an unspaced 33 in ~90 s
// drew 429s on 2026-09-26). A 429 is retried ONCE after its Retry-After; a second 429 fails by name.
// The spacing pause is outside the timed window: only the POST round-trip is timed.
//
// P95 OF 20. quantile() takes index floor(20 * 0.95) = 19, the SLOWEST sample, so each p95 is a max bound.
//
// ADVERSE MEDIA IS OBSERVED, NOT ASSUMED: every row records the served adverseMediaStatus; the ON test
// fails unless every sample reports 'Ok', the OFF test fails if any does.
//
// NOT COVERED: the request is hand-assembled, so this tests the server path only, never the aml-v2
// client's request shape; client times include WAN RTT from the E2E host; totalMs is the server's own
// clock and cannot see ingress, the prod->staging proxy, or time queued before the endpoint runs.
import { performance } from 'node:perf_hooks';
// Rate-limit pacing between API calls, not a wait for app state: nothing here is polled.
import { setTimeout as pause } from 'node:timers/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AML_API_KEY, AML_API_URL, amlReachable } from './aml-helpers.js';
import { surfaceOnKeyOrSkip } from './am-hit-helpers.js';
import { quantile } from './fuzzy-measure.js';

const SCREEN_PATH = '/v1/screenings/check';
const CREATED = 201;
const TOO_MANY_REQUESTS = 429;
const NO_RESPONSE = 0;
const SAMPLES = 20;
const WARM_UPS = 2;
const P50 = 0.5;
const P95 = 0.95;
/** Q19 targets, in ms. Stated by the owner before any measurement; never fitted to a run. */
const SERVER_P95_NO_AM_MS = 1000;
const SERVER_P95_AM_MS = 2000;
const CLIENT_P95_NO_AM_MS = 1500;
const CLIENT_P95_AM_MS = 2500;
/** Per-request cap. Far above the ceilings, so a slow request is still MEASURED, not aborted. */
const REQUEST_TIMEOUT_MS = 30_000;
const SAMPLE_SPACING_MS = 3000;
const MS_PER_SECOND = 1000;
/** Used when a 429 carries no parseable Retry-After; capped so one bad header cannot eat the test. */
const RETRY_AFTER_FALLBACK_S = 10;
const RETRY_AFTER_CAP_S = 60;
const TEST_SLACK_MS = 60_000;
const TEST_TIMEOUT_MS =
  (SAMPLES + WARM_UPS) * (REQUEST_TIMEOUT_MS + SAMPLE_SPACING_MS) + RETRY_AFTER_CAP_S * MS_PER_SECOND + TEST_SLACK_MS;
const AM_RAN = 'Ok';

/** Ten distinct subjects (sanctioned, PEP, common, no-hit), cycled twice for 20 samples. */
const SUBJECTS: readonly string[] = [
  'Bashar al-Assad',
  'Antonio Guterres',
  'Xi Jinping',
  'Donald Trump',
  'Vladimir Putin',
  'John Smith',
  'Maria Garcia',
  'Kim Jong Un',
  'Ramzan Kadyrov',
  'Eleni Papadopoulou',
];
const WARM_UP_SUBJECT = 'Warm Up Subject';

interface Sample {
  readonly subject: string;
  readonly clientMs: number;
  /** diagnostics.totalMs, or null when the response carried no diagnostics. */
  readonly serverMs: number | null;
  readonly status: number;
  readonly adverseMediaStatus: string;
  readonly retried: boolean;
}

type Attempt = Omit<Sample, 'retried'> & { readonly retryAfter?: string };

interface Run {
  readonly adverseMedia: boolean;
  readonly apiKey: string;
  readonly label: string;
}

interface ScreenBody {
  adverseMediaStatus?: string | null;
  diagnostics?: { totalMs?: number } | null;
}

/** The samples ARE the deliverable, so they go to the run log. */
function report(line: string): void {
  // eslint-disable-next-line no-console-in-tests/no-console-in-tests -- the measurement is the output, not debugging
  console.log(`[screen-perf] ${line}`);
}

function retryAfterMs(header: string | undefined): number {
  const seconds = Number.parseInt(header ?? '', 10);
  const usable = Number.isFinite(seconds) && seconds >= 0 ? seconds : RETRY_AFTER_FALLBACK_S;
  return Math.min(usable, RETRY_AFTER_CAP_S) * MS_PER_SECOND;
}

/** One POST, timed around the round-trip only. A timeout is KEPT as a sample (HTTP 0) at its elapsed time. */
async function timeOne(request: APIRequestContext, subject: string, run: Run): Promise<Attempt> {
  const started = performance.now();
  try {
    const res = await request.post(`${AML_API_URL}${SCREEN_PATH}`, {
      data: { fullName: subject, adverseMedia: run.adverseMedia, includeDiagnostics: true },
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': run.apiKey, Authorization: `Bearer ${run.apiKey}` },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const clientMs = Math.round(performance.now() - started);
    const status = res.status();
    const body = status === CREATED ? ((await res.json()) as ScreenBody) : null;
    const total = body?.diagnostics?.totalMs;
    return {
      subject,
      clientMs,
      serverMs: typeof total === 'number' ? total : null,
      status,
      adverseMediaStatus: body?.adverseMediaStatus?.trim() || '(none)',
      retryAfter: res.headers()['retry-after'],
    };
  } catch (error) {
    const clientMs = Math.round(performance.now() - started);
    const [reason] = (error as Error).message.split(/\r?\n/);
    return { subject, clientMs, serverMs: null, status: NO_RESPONSE, adverseMediaStatus: `(no response: ${reason})` };
  }
}

/** Honour Retry-After ONCE on a 429; the retried request's own round-trip is the sample. */
async function screen(request: APIRequestContext, subject: string, run: Run): Promise<Sample> {
  const first = await timeOne(request, subject, run);
  if (first.status !== TOO_MANY_REQUESTS) return { ...first, retried: false };
  const waitMs = retryAfterMs(first.retryAfter);
  report(`${run.label} ${subject}: HTTP 429, retry-after=${first.retryAfter ?? '(none)'}, retrying once in ${waitMs} ms`);
  await pause(waitMs);
  return { ...(await timeOne(request, subject, run)), retried: true };
}

function describeSample(sample: Sample): string {
  const server =
    sample.serverMs === null
      ? 'server n/a'
      : `server ${sample.serverMs} ms, client-server ${sample.clientMs - sample.serverMs} ms`;
  const retried = sample.retried ? ' (after one 429 retry)' : '';
  return `${sample.subject}: client ${sample.clientMs} ms, ${server}, HTTP ${sample.status} am=${sample.adverseMediaStatus}${retried}`;
}

/** Untimed warm-ups on the same context; the first one's client time is the cold-request annotation. */
async function warmUp(request: APIRequestContext, run: Run): Promise<void> {
  for (let index = 1; index <= WARM_UPS; index += 1) {
    const sample = await screen(request, WARM_UP_SUBJECT, run);
    report(`${run.label} warm-up #${index} (not gated) ${describeSample(sample)}`);
    if (index === 1)
      test.info().annotations.push({
        type: 'screen-perf-cold',
        description: `${run.label} cold first request (not gated) ${describeSample(sample)}`,
      });
    await pause(SAMPLE_SPACING_MS);
  }
}

async function runSamples(request: APIRequestContext, run: Run): Promise<Sample[]> {
  await warmUp(request, run);
  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const sample = await screen(request, SUBJECTS[index % SUBJECTS.length], run);
    samples.push(sample);
    const line = `${run.label} #${samples.length} ${describeSample(sample)}`;
    report(line);
    test.info().annotations.push({ type: 'screen-perf-sample', description: line });
    if (index < SAMPLES - 1) await pause(SAMPLE_SPACING_MS);
  }
  return samples;
}

function percentiles(values: number[]): { p50: number; p95: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: quantile(sorted, P50), p95: quantile(sorted, P95) };
}

interface P95 {
  readonly client: number;
  readonly server: number;
}

function summarise(samples: Sample[], label: string): P95 {
  const client = percentiles(samples.map(sample => sample.clientMs));
  // A missing totalMs sorts last, so it can never pull the server p95 DOWN; it also fails by name below.
  const server = percentiles(samples.map(sample => sample.serverMs ?? Number.POSITIVE_INFINITY));
  const line =
    `${label} n=${samples.length} server p50 ${server.p50} p95 ${server.p95} ms; ` +
    `client p50 ${client.p50} p95 ${client.p95} ms; host ${AML_API_URL} at ${new Date().toISOString()}`;
  report(line);
  test.info().annotations.push({ type: 'screen-perf', description: line });
  return { client: client.p95, server: server.p95 };
}

function expectAllCreatedWithDiagnostics(samples: Sample[]): void {
  const failed = samples.filter(sample => sample.status !== CREATED);
  expect(
    failed.map(sample => `${sample.subject}: HTTP ${sample.status}`),
    'every screening must return 201; a 429 after one retry, a 5xx or a timeout (HTTP 0) is not a passing sample',
  ).toEqual([]);
  const blind = samples.filter(sample => sample.serverMs === null).map(sample => sample.subject);
  expect(blind, 'includeDiagnostics was sent but diagnostics.totalMs is missing; the server gate is unreadable').toEqual(
    [],
  );
}

function expectWithinCeilings(p95: P95, ceilings: P95, label: string): void {
  expect(
    p95.server,
    `${label} server p95 ${p95.server} ms (diagnostics.totalMs) exceeds the Q19 ceiling of ${ceilings.server} ms`,
  ).toBeLessThanOrEqual(ceilings.server);
  expect(
    p95.client,
    `${label} warm client p95 ${p95.client} ms exceeds the Q19 ceiling of ${ceilings.client} ms`,
  ).toBeLessThanOrEqual(ceilings.client);
}

test.describe('SCREEN-PERF-1 screening latency on staging @aml-api', () => {
  test.describe.configure({ retries: 0 });

  test.beforeEach(async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    test.skip(!AML_API_KEY, 'AML_API_KEY not set for this environment');
    // NOT a skip: an unreachable target is a red with its reason, never an unknown green.
    expect(await amlReachable(request), `AML API /version not reachable at ${AML_API_URL}`).toBeTruthy();
  });

  test('SCREEN-PERF-1 AC-1 without adverse media: server p95 <= 1000 ms, warm client p95 <= 1500 ms', async ({
    request,
  }) => {
    const label = 'AM OFF';
    const samples = await runSamples(request, { adverseMedia: false, apiKey: AML_API_KEY ?? '', label });
    const p95 = summarise(samples, label);
    expectAllCreatedWithDiagnostics(samples);
    const ran = samples.filter(sample => sample.adverseMediaStatus === AM_RAN).map(sample => sample.subject);
    expect(ran, 'adverseMedia:false was sent but the stage ran for these subjects').toEqual([]);
    expectWithinCeilings(p95, { server: SERVER_P95_NO_AM_MS, client: CLIENT_P95_NO_AM_MS }, label);
  });

  test('SCREEN-PERF-1 AC-2 with adverse media: server p95 <= 2000 ms, warm client p95 <= 2500 ms', async ({
    request,
  }) => {
    // D-MODB-AM-15: staging runs AdverseMedia__Enabled=false and only the surface-ON tenant has the
    // master switch ON; the default tenant answers adverseMedia:true with adverseMediaStatus=null.
    const label = 'AM ON';
    const samples = await runSamples(request, { adverseMedia: true, apiKey: surfaceOnKeyOrSkip(), label });
    const p95 = summarise(samples, label);
    expectAllCreatedWithDiagnostics(samples);
    const skipped = samples
      .filter(sample => sample.adverseMediaStatus !== AM_RAN)
      .map(sample => `${sample.subject}=${sample.adverseMediaStatus}`);
    expect(skipped, `adverseMedia:true was sent but the stage did not report '${AM_RAN}'`).toEqual([]);
    expectWithinCeilings(p95, { server: SERVER_P95_AM_MS, client: CLIENT_P95_AM_MS }, label);
  });
});
