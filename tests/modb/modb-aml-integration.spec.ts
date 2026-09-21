// @modb-api tier — MODB-2 task 6b + Q5. Module B gateway -> check mocks -> AMLService, driven over HTTP only.
// House rule: E2E drives the API, not the UI. Queue is the standing AML mode (D-INT-13); set MODB_AML_MODE to
// what the gateway runs when gating sync or async.
//
// Environment (parsed in modb-guards.ts; a malformed value FAILS the run, never skips):
//   MODB_GATEWAY_URL                 wl-api-gateway base URL. .env.local / .env.staging carry the staging NodePort;
//                                    an in-cluster or CI runner must set it, and unset fails with a clear message.
//   MODB_E2E_NO_CALLBACK=<id>        enables exactly ONE no_callback scenario (`mrz-no-callback` or
//                                    `liveness-no-callback`). Blocks a shared staging check worker for ~3 h: see
//                                    NO_CALLBACK_BLAST_RADIUS below.
//   MODB_E2E_ALLOW_AM_UNAVAILABLE=1  a run that screened but never observed a score > 0 warns
//                                    instead of failing. Set it only when GDELT is known degraded on staging.
//
// D-MODB-AM-15 "Adverse media fully OFF by default, with a per-tenant MASTER switch for development"
// (owner, 2026-09-21): the gateway tenant has adverse media OFF, so every screened row asserts
// `adverse_media_status=NotReported` (modb-assertions.ts). The ERIKSSON specimen now screens clean (0 matches), so
// (e) screens "Viktor Bout" (OFAC) through the mock identity field: that is this suite's positive screen.
//
// Structurally blind to: client-side JS errors in wl-mvp-frontend, camera capture, and the browser ->
// Next.js server-action path of the public host. Those need a browser tier (MODB-2 task 8).
import { expect, test } from '@playwright/test';
import { expectCancelledAml, expectScreenedAml, expectSources, recordAdverseMedia, screenLedger } from './modb-assertions.js';
import { mockIdentityFields } from './modb-demo-identity.js';
import { positiveScreenVerdict, scenarioEnabled, selectNoCallbackScenario } from './modb-guards.js';
import {
  AML_CHECK,
  MRZ_CHECK,
  TERMINAL_STATUSES,
  assertGatewayReachable,
  getAmlCase,
  rowOf,
  submitVerification,
  waitForAmlTerminal,
  waitForSettled,
} from './modb-helpers.js';
import {
  MOCK_CHECK_TYPES,
  MODB_NO_CALLBACK_SCENARIOS,
  MODB_SCENARIOS,
  expectedCheck,
  pendingChecks,
} from './modb-scenarios.js';

const SUBMITTED_CHECKS = [...MOCK_CHECK_TYPES];
/** A sanctions subject with an OFAC watchlist match (wl-mvp-frontend demo-identities.json). */
const WATCHLIST_SUBJECT = 'Viktor Bout';
const MAX_DEPENDENCY_ATTEMPTS = 3;
/**
 * NO_CALLBACK_BLAST_RADIUS. no_callback scenarios are OPT-IN, ONE per run (MODB_E2E_NO_CALLBACK=<scenario id>).
 * Each check type has worker concurrency 1 (wl-api-gateway verification.processors.ts:17) and a silent callback
 * holds that slot for CHECK_CALLBACK_TIMEOUT_MS x 3 (verification.processor.base.ts:108, ~3 h on staging). One
 * opted-in scenario therefore starves every later check of that type on SHARED staging for ~3 h:
 * `mrz-no-callback` blocks MRZ and with it every AML screening; `liveness-no-callback` blocks liveness. Two in one
 * run fail deterministically, because the second waits on the slot the first holds. Measured 2026-09-17: after one
 * liveness no_callback, later requests sat liveness=queued attempt_count=0 (c4aee973, d5d54f31, 63bdd891).
 */
const SELECTED_NO_CALLBACK = selectNoCallbackScenario(
  process.env,
  MODB_NO_CALLBACK_SCENARIOS.map((scenario) => scenario.id),
);

// A green run must prove a positive screen happened: fail when this worker screened and never saw a score > 0.
test.afterAll(() => {
  const verdict = positiveScreenVerdict(screenLedger, process.env);
  if (verdict.warn) test.info().annotations.push({ type: 'aml-not-observed', description: verdict.warn });
  if (verdict.fail) throw new Error(verdict.fail);
});

test.describe('MODB gateway <-> mocks <-> AML @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    await assertGatewayReachable(request);
  });

  test('(a) every required mock check passes -> AML runs to a terminal result', async ({ request }) => {
    const requestId = await submitVerification(request, { mrz_match: 'passed' });
    test.info().annotations.push({ type: 'request_id', description: requestId });

    const rows = await waitForAmlTerminal(request, requestId);
    const mrz = rowOf(rows, MRZ_CHECK);
    expect(mrz.status).toBe('completed');
    expect(mrz.outcome).toBe('passed');
    expectSources(rows);
    await expectScreenedAml(request, requestId, rowOf(rows, AML_CHECK));
  });

  test('(b) a required check forced to fail -> AML is cancelled with a stated reason', async ({ request }) => {
    const requestId = await submitVerification(request, { mrz_match: 'failed' });
    test.info().annotations.push({ type: 'request_id', description: requestId });

    const rows = await waitForAmlTerminal(request, requestId);
    const mrz = rowOf(rows, MRZ_CHECK);
    expect(mrz.status).toBe('completed');
    expect(mrz.outcome).toBe('failed');
    expectSources(rows);
    // The reason as the API exposes it today: the AML row's `error`, not a separate field.
    await expectCancelledAml(request, requestId, rowOf(rows, AML_CHECK), {
      code: 'AML_REQUIRED_CHECK_NOT_PASSED',
      message: 'Required check mrz_match completed with outcome failed; AML screening was not requested.',
    });
  });

  // (c) WATCHLIST_UNAVAILABLE forcing is out of scope by owner decision D-INT-6 (MODB-2-INT-checklist.md); retry is unit-tested in the gateway.

  test('(e) aml-case returns the screening with matches; a request never screened is 404', async ({ request }) => {
    const screened = await submitVerification(request, { mrz_match: 'passed' }, [MRZ_CHECK], mockIdentityFields(WATCHLIST_SUBJECT));
    const refused = await submitVerification(request, { mrz_match: 'failed' });
    test.info().annotations.push({ type: 'request_id', description: `screened=${screened} refused=${refused}` });

    const screenedAml = rowOf(await waitForAmlTerminal(request, screened), AML_CHECK);
    expect(screenedAml.status, JSON.stringify(screenedAml.error)).toBe('completed');
    const ok = await getAmlCase(request, screened);
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.meta.request_id).toBe(screened);
    expect(body.data.screening_id).toBe(screenedAml.result?.screening_id);
    const amStatus = body.data.adverse_media_status;
    const score = screenedAml.result?.score;
    const note = `(e) ${screened} score=${score} am=${amStatus} matches=${body.data.matches.length}`;
    recordAdverseMedia(note, amStatus, score);
    expect(amStatus, 'the gateway tenant has adverse media OFF (D-MODB-AM-15)').toBe('NotReported');
    // Viktor Bout carries an OFAC match (measured 2026-09-21: 1 match, score 0.735), so the list is never vacuous.
    expect(body.data.matches.length, `a watchlist subject screened with no match: ${note}`).toBeGreaterThan(0);
    for (const match of body.data.matches) expect(match).toHaveProperty('source_list');

    await waitForAmlTerminal(request, refused);
    const missing = await getAmlCase(request, refused);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error?.code).toBe('AML_SCREENING_NOT_FOUND');
  });
});

// One test per D-INT-12 scenario, all five mock checks submitted with the scenario's outcomes.
test.describe('MODB D-INT-12 demo scenarios @modb-api', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ request }) => {
    await assertGatewayReachable(request);
  });

  for (const scenario of [...MODB_SCENARIOS, ...MODB_NO_CALLBACK_SCENARIOS]) {
    const pending = pendingChecks(scenario);
    const enabled = scenarioEnabled(scenario.id, pending.length, SELECTED_NO_CALLBACK);
    (enabled ? test : test.skip)(`${scenario.id}: ${scenario.expected}`, async ({ request }) => {
      const requestId = await submitVerification(request, scenario.outcomes, SUBMITTED_CHECKS);
      test.info().annotations.push({ type: 'request_id', description: requestId });

      // no_callback checks stay open ~3 h, so they are asserted non-terminal after dispatch, never awaited.
      const rows = await waitForSettled(request, requestId, pending);
      expectSources(rows);
      for (const checkType of MOCK_CHECK_TYPES) {
        const row = rowOf(rows, checkType);
        if (pending.includes(checkType)) {
          expect(TERMINAL_STATUSES, `${checkType} must still be open`).not.toContain(row.status);
          expect(row.attempt_count, `${checkType} was dispatched`).toBeGreaterThanOrEqual(1);
          continue;
        }
        const expected = expectedCheck(scenario, checkType);
        expect({ status: row.status, outcome: row.outcome }, `${checkType} ${JSON.stringify(row.error)}`).toEqual(expected);
        if (expected.status === 'failed') expect(row.error?.code, `${checkType} error code`).toBeTruthy();
        if (scenario.dependencyFailed?.includes(checkType)) expect(row.attempt_count).toBe(MAX_DEPENDENCY_ATTEMPTS);
      }

      const aml = rowOf(rows, AML_CHECK);
      if (scenario.aml === 'screened') {
        await expectScreenedAml(request, requestId, aml);
        if (scenario.amlDecision) expect(aml.result?.decision).toBe(scenario.amlDecision);
      } else if (scenario.aml === 'cancelled') {
        await expectCancelledAml(request, requestId, aml, scenario.cancel as { code: string; message: string });
      } else {
        expect(TERMINAL_STATUSES, 'AML waits on the silent required check').not.toContain(aml.status);
      }
    });
  }
});
