// SCREEN-PERF-1 "Screening back under 1 s without the SSD" -- owner decision N1 (2026-09-24):
// p95 over 10 screenings on staging, <= 1 s without adverse media and <= 2 s with it.
// Task doc: BaseClient/docs/Tasks/IN_PROGRESS/SCREEN-PERF-1-screening-latency.md
//
// Written RED on purpose: the SPEED-1 screening c59d1d08 took 15,305 ms (persist 14,830 ms). These
// turn green when reads are cache-first and the save is write-behind (N2), not by widening a bound.
//
// WHAT IS TIMED. Only the POST round-trip: a monotonic clock around one request, no retry, no
// backoff, no inter-request pause. fuzzy-measure.ts screenOne() is NOT reused because its latencyMs
// is taken after its INTER_REQUEST_MS sleep and across retries, so it measures the pacing too.
//
// P95 OF 10. quantile() takes index floor(n * 0.95) = 9 of 10, i.e. the SLOWEST sample. With n=10
// the p95 bound is a max bound: one slow screening turns the test red. That is the owner's target.
//
// AM OFF screens as the AML_API_KEY tenant; AM ON as the surface-ON tenant (MODB_SURFACE_ON_AML_API_KEY).
// ADVERSE MEDIA IS OBSERVED, NOT ASSUMED. Each row records the SERVED adverseMediaStatus. The ON test
// fails if any sample did not report the stage as run ('Ok'); the OFF test fails if any did. A latency
// for a path that was not taken is a number about the wrong code.
//
// A non-201 fails the test by name. A request that times out at REQUEST_TIMEOUT_MS is kept as a
// sample at its elapsed time (HTTP 0), so the other nine are still measured and logged.
//
// NOT COVERED: this helper hand-assembles its request, so it tests the server path only, never the
// aml-v2 client's request shape; and it measures from the E2E host, so WAN RTT is in every sample.
import { performance } from 'node:perf_hooks';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AML_API_KEY, AML_API_URL, amlReachable } from './aml-helpers.js';
import { surfaceOnKeyOrSkip } from './am-hit-helpers.js';
import { quantile } from './fuzzy-measure.js';

const SCREEN_PATH = '/v1/screenings/check';
const CREATED = 201;
const SAMPLES = 10;
const P50 = 0.5;
const P95 = 0.95;
/** N1 targets, in ms. Stated by the owner before any measurement; never fitted to a run. */
const P95_CEILING_NO_AM_MS = 1000;
const P95_CEILING_AM_MS = 2000;
/** Per-request cap. Far above the ceilings, so a slow request is still MEASURED, not aborted. */
const REQUEST_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = SAMPLES * REQUEST_TIMEOUT_MS + 60_000;
const AM_RAN = 'Ok';

/** Ten distinct subjects: sanctioned, PEP, common and no-hit names, so no single row dominates. */
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

interface Sample {
  readonly subject: string;
  readonly ms: number;
  readonly status: number;
  readonly adverseMediaStatus: string;
}

/** The samples ARE the deliverable (N1: log every sample plus p50/p95), so they go to the run log. */
function report(line: string): void {
  // eslint-disable-next-line no-console-in-tests/no-console-in-tests -- the measurement is the output, not debugging
  console.log(`[screen-perf] ${line}`);
}

/** HTTP status recorded for a request that hit REQUEST_TIMEOUT_MS or failed in transport. */
const NO_RESPONSE = 0;

/** A timed-out request is KEPT as a sample at its elapsed time, so one hang cannot hide the other nine. */
async function timeOne(request: APIRequestContext, subject: string, adverseMedia: boolean, apiKey: string): Promise<Sample> {
  const started = performance.now();
  try {
    const res = await request.post(`${AML_API_URL}${SCREEN_PATH}`, {
      data: { fullName: subject, adverseMedia },
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const ms = Math.round(performance.now() - started);
    const status = res.status();
    const body = status === CREATED ? ((await res.json()) as { adverseMediaStatus?: string | null }) : null;
    return { subject, ms, status, adverseMediaStatus: body?.adverseMediaStatus?.trim() || '(none)' };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const [reason] = (error as Error).message.split(/\r?\n/);
    return { subject, ms, status: NO_RESPONSE, adverseMediaStatus: `(no response: ${reason})` };
  }
}

interface Run {
  readonly adverseMedia: boolean;
  readonly apiKey: string;
  readonly label: string;
}

async function runSamples(request: APIRequestContext, { adverseMedia, apiKey, label }: Run): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const subject of SUBJECTS) {
    const sample = await timeOne(request, subject, adverseMedia, apiKey);
    samples.push(sample);
    report(
      `${label} #${samples.length} ${sample.subject}: ${sample.ms} ms ` +
        `HTTP ${sample.status} adverseMediaStatus=${sample.adverseMediaStatus}`,
    );
  }
  return samples;
}

function summarise(samples: Sample[], label: string): { p50: number; p95: number } {
  const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b);
  const p50 = quantile(sorted, P50);
  const p95 = quantile(sorted, P95);
  report(
    `${label} n=${sorted.length} p50 ${p50} ms p95 ${p95} ms ` +
      `samples [${samples.map(sample => sample.ms).join(', ')}] host ${AML_API_URL} at ${new Date().toISOString()}`,
  );
  test.info().annotations.push({ type: 'screen-perf', description: `${label} p50=${p50} p95=${p95}` });
  return { p50, p95 };
}

function expectAllCreated(samples: Sample[]): void {
  const failed = samples.filter(sample => sample.status !== CREATED);
  expect(
    failed.map(sample => `${sample.subject}: HTTP ${sample.status}`),
    'every screening must return 201; a 429/5xx/timeout (HTTP 0) is not a passing sample',
  ).toEqual([]);
}

test.describe('SCREEN-PERF-1 screening latency on staging @aml-api', () => {
  test.describe.configure({ retries: 0 });

  test.beforeEach(async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    test.skip(!AML_API_KEY, 'AML_API_KEY not set for this environment');
    // NOT a skip: under the load this task measures, /version itself can time out, and a skipped perf
    // test reports nothing. An unreachable target is a red with its reason, never an unknown green.
    expect(await amlReachable(request), `AML API /version not reachable at ${AML_API_URL}`).toBeTruthy();
  });

  test('SCREEN-PERF-1 AC-1 p95 of 10 screenings without adverse media is <= 1000 ms', async ({ request }) => {
    const samples = await runSamples(request, { adverseMedia: false, apiKey: AML_API_KEY ?? '', label: 'AM OFF' });
    const { p95 } = summarise(samples, 'AM OFF');
    expectAllCreated(samples);
    const ran = samples.filter(sample => sample.adverseMediaStatus === AM_RAN).map(sample => sample.subject);
    expect(ran, 'adverseMedia:false was sent but the stage ran for these subjects').toEqual([]);
    expect(p95, `AM OFF p95 ${p95} ms exceeds the N1 ceiling of ${P95_CEILING_NO_AM_MS} ms`).toBeLessThanOrEqual(
      P95_CEILING_NO_AM_MS,
    );
  });

  test('SCREEN-PERF-1 AC-2 p95 of 10 screenings with adverse media is <= 2000 ms', async ({ request }) => {
    // D-MODB-AM-15: staging runs AdverseMedia__Enabled=false and only the surface-ON tenant has the
    // master switch ON. Measured 2026-09-25: the default tenant answers adverseMedia:true with
    // adverseMediaStatus=null, so its "AM ON" timings measure the OFF path.
    const apiKey = surfaceOnKeyOrSkip();
    const samples = await runSamples(request, { adverseMedia: true, apiKey, label: 'AM ON' });
    const { p95 } = summarise(samples, 'AM ON');
    expectAllCreated(samples);
    const skipped = samples
      .filter(sample => sample.adverseMediaStatus !== AM_RAN)
      .map(sample => `${sample.subject}=${sample.adverseMediaStatus}`);
    expect(skipped, `adverseMedia:true was sent but the stage did not report '${AM_RAN}'`).toEqual([]);
    expect(p95, `AM ON p95 ${p95} ms exceeds the N1 ceiling of ${P95_CEILING_AM_MS} ms`).toBeLessThanOrEqual(
      P95_CEILING_AM_MS,
    );
  });
});
