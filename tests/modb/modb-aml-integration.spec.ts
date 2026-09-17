// @modb-api tier — MODB-2 task 6b. Module B gateway -> check mocks -> AMLService, driven over HTTP only.
// House rule: E2E drives the API, not the UI. This suite is the regression gate for MODB-2 tasks 9
// (async HTTP) and 10 (queue): rerun it per mode with MODB_AML_MODE set to what the gateway runs.
//
// Structurally blind to: client-side JS errors in wl-mvp-frontend, camera capture, and the browser ->
// Next.js server-action path of the public host. Those need a browser tier (MODB-2 task 8).
import { expect, test } from '@playwright/test';
import {
  ADVERSE_MEDIA_STATUSES,
  AML_CHECK,
  AML_DECISIONS,
  MODB_AML_MODE,
  MRZ_CHECK,
  assertGatewayReachable,
  getAmlCase,
  rowOf,
  submitVerification,
  waitForAmlTerminal,
} from './modb-helpers.js';

const OUTCOME_BY_DECISION: Record<string, string> = { Pass: 'passed', Review: 'review', Fail: 'failed' };

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

    const aml = rowOf(rows, AML_CHECK);
    expect(aml.status, JSON.stringify(aml.error)).toBe('completed');
    expect(aml.error).toBeNull();
    const result = aml.result ?? {};
    expect(result.screening_id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(AML_DECISIONS).toContain(result.decision);
    // outcome is derived from the AML decision alone (gateway decisionToOutcome), never from AM status.
    expect(aml.outcome).toBe(OUTCOME_BY_DECISION[result.decision as string]);
  });

  test('(b) a required check forced to fail -> AML is cancelled with a stated reason', async ({ request }) => {
    const requestId = await submitVerification(request, { mrz_match: 'failed' });
    test.info().annotations.push({ type: 'request_id', description: requestId });

    const rows = await waitForAmlTerminal(request, requestId);
    const mrz = rowOf(rows, MRZ_CHECK);
    expect(mrz.status).toBe('completed');
    expect(mrz.outcome).toBe('failed');

    const aml = rowOf(rows, AML_CHECK);
    expect(aml.status).toBe('cancelled');
    expect(aml.outcome).toBeNull();
    expect(aml.result).toBeNull();
    // The reason as the API exposes it today: the AML row's `error`, not a separate field.
    expect(aml.error?.code).toBe('AML_REQUIRED_CHECK_NOT_PASSED');
    expect(aml.error?.message).toContain('mrz_match completed with outcome failed');
  });

  // (c) WATCHLIST_UNAVAILABLE forcing is out of scope by owner decision D-INT-6 (MODB-2-INT-checklist.md); retry is unit-tested in the gateway.

  test('(d) adverse_media_status is explicit, in the enum, and independent of the decision', async ({
    request,
  }) => {
    const requestId = await submitVerification(request, { mrz_match: 'passed' });
    test.info().annotations.push({ type: 'request_id', description: requestId });

    const aml = rowOf(await waitForAmlTerminal(request, requestId), AML_CHECK);
    expect(aml.status, JSON.stringify(aml.error)).toBe('completed');
    const result = aml.result ?? {};
    // Present as its own key, so a Pass with AM Unavailable/NotReported can never read as clean.
    expect(result).toHaveProperty('adverse_media_status');
    const status = result.adverse_media_status as string;
    expect(ADVERSE_MEDIA_STATUSES).toContain(status);
    test.info().annotations.push({ type: 'adverse_media_status', description: `${result.decision}/${status}` });
    // NotReported means "the transport carried no AM status". Sync and async HTTP carry it; only queue
    // mode is allowed to report it until VerificationScreeningCompleted gains the field (task 5 note).
    if (MODB_AML_MODE !== 'queue') expect(status).not.toBe('NotReported');

    // The case-detail proxy reads the same screening and must agree on the AM status.
    const amlCase = await getAmlCase(request, requestId);
    expect(amlCase.status()).toBe(200);
    const caseData = (await amlCase.json()).data;
    expect(caseData.screening_id).toBe(result.screening_id);
    expect(caseData.adverse_media_status).toBe(status);
  });

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
    expect(AML_DECISIONS).toContain(body.data.decision);
    expect(Array.isArray(body.data.matches)).toBe(true);
    expect(body.data.matches.length).toBeGreaterThan(0);
    for (const match of body.data.matches) expect(match).toHaveProperty('source_list');

    await waitForAmlTerminal(request, refused);
    const missing = await getAmlCase(request, refused);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error?.code).toBe('AML_SCREENING_NOT_FOUND');
  });
});
