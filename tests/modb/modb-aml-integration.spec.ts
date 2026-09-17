// @modb-api tier — MODB-2 task 6b + Q5. Module B gateway -> check mocks -> AMLService, driven over HTTP only.
// House rule: E2E drives the API, not the UI. Queue is the standing AML mode (D-INT-13); set MODB_AML_MODE to
// what the gateway runs when gating sync or async.
//
// Structurally blind to: client-side JS errors in wl-mvp-frontend, camera capture, and the browser ->
// Next.js server-action path of the public host. Those need a browser tier (MODB-2 task 8).
import { expect, test } from '@playwright/test';
import { expectCancelledAml, expectScreenedAml, expectSources } from './modb-assertions.js';
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
import { MOCK_CHECK_TYPES, MODB_SCENARIOS, expectedCheck, pendingChecks } from './modb-scenarios.js';

const SUBMITTED_CHECKS = [...MOCK_CHECK_TYPES];
const MAX_DEPENDENCY_ATTEMPTS = 3;
/**
 * no_callback scenarios are OPT-IN. Each check type has worker concurrency 1 (wl-api-gateway
 * verification.processors.ts:17) and a silent callback holds that slot for CHECK_CALLBACK_TIMEOUT_MS x 3
 * (verification.processor.base.ts:108, ~3 h on staging), so one run starves every later liveness (or MRZ, and so
 * every AML screening) on staging for ~3 h. Measured 2026-09-17: after one liveness no_callback, later requests
 * sat liveness=queued attempt_count=0 (c4aee973, d5d54f31, 63bdd891).
 */
const RUN_NO_CALLBACK = process.env.MODB_E2E_NO_CALLBACK === '1';

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
      message: 'mrz_match completed with outcome failed',
    });
  });

  // (c) WATCHLIST_UNAVAILABLE forcing is out of scope by owner decision D-INT-6 (MODB-2-INT-checklist.md); retry is unit-tested in the gateway.

  test('(e) aml-case returns the screening with matches; a request never screened is 404', async ({ request }) => {
    const screened = await submitVerification(request, { mrz_match: 'passed' });
    const refused = await submitVerification(request, { mrz_match: 'failed' });
    test.info().annotations.push({ type: 'request_id', description: `screened=${screened} refused=${refused}` });

    const screenedAml = rowOf(await waitForAmlTerminal(request, screened), AML_CHECK);
    expect(screenedAml.status, JSON.stringify(screenedAml.error)).toBe('completed');
    const ok = await getAmlCase(request, screened);
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.meta.request_id).toBe(screened);
    expect(body.data.screening_id).toBe(screenedAml.result?.screening_id);
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

  for (const scenario of MODB_SCENARIOS) {
    const pending = pendingChecks(scenario);
    const optIn = pending.length > 0 && !RUN_NO_CALLBACK;
    (optIn ? test.skip : test)(`${scenario.id}: ${scenario.expected}`, async ({ request }) => {
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
