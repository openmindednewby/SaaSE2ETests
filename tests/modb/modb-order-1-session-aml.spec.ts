// MODB-E2E-SESSION-1 "Session-based AML smoke test" — proves MODB-ORDER-1 "Tenant-configurable verification step
// order with optional AML screening after a valid MRZ" on the deployed staging gateway (`3685be2`, AML mode `queue`,
// AMLService `cc6ffb43`) through the CURRENT session API.
//
// Why a new file: the locked acceptance specs (modb-aml-integration, modb-mock-identity, modb-mock-source-links,
// modb-processing-trace) drive `POST /api/v1/verifications`, which the deployed gateway no longer registers
// (MODB-ENDPOINT-1, open with Valentinos). Nothing here touches them or modb-helpers.ts.
//
// Prerequisites, each skipped with its reason rather than asserted around:
//   MODB_CLIENT_API_KEY  — the gateway's CLIENT_API_KEY; without it every session create answers 503
//                          CLIENT_AUTH_NOT_CONFIGURED (external-client.guard.ts:29-33).
//   MODB_INTERNAL_TOKEN  — the gateway's INTERNAL_API_TOKEN; without it check rows cannot be read.
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  AML_CHECK,
  CLIENT_KEY_ENV,
  INTERNAL_TOKEN_ENV,
  MRZ_CHECK,
  clientApiKey,
  createSession,
  internalToken,
  progressState,
  rowOf,
  sessionChecks,
  sessionConfiguration,
  submitDocument,
  waitForAmlTerminal,
  type CheckRow,
  type SessionHandle,
} from './modb-session-helpers.js';

/** A catalog flow: MODB-ORDER-1 put `aml-screening` right after `document` in the six built-in flows. */
const CATALOG_FLOW = 'standard-kyc';
/** The smallest flow that still contains the AML step, so one document submission can finish the session. */
const MINIMAL_FLOW = 'frontend-v1-passive-mrz-match.aml-screening';
const DOCUMENT_STEP = 'document';
const AML_STEP = 'aml-screening';
const ONE_SCREENING = 1;

let session: SessionHandle;
let settledRows: CheckRow[] = [];

function missingPrerequisite(): string | null {
  if (!clientApiKey()) return `${CLIENT_KEY_ENV} is unset: the buyer session API cannot be called`;
  if (!internalToken()) return `${INTERNAL_TOKEN_ENV} is unset: session check rows cannot be read`;
  return null;
}

async function flowSteps(request: APIRequestContext, flowId: string): Promise<string[]> {
  const created = await createSession(request, flowId, `e2e-modb-order-1-${randomUUID()}`);
  return (await sessionConfiguration(request, created)).steps;
}

test.describe('MODB-ORDER-1 session-based AML screening (staging, API-driven)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const missing = missingPrerequisite();
    test.skip(missing !== null, missing ?? '');
  });

  test('AC-ORD-10: the standard-kyc session flow lists aml-screening immediately after document', async ({
    request,
  }) => {
    const steps = await flowSteps(request, CATALOG_FLOW);
    expect(steps, `${CATALOG_FLOW} must contain the ${AML_STEP} step`).toContain(AML_STEP);
    expect(
      steps.indexOf(AML_STEP),
      `${AML_STEP} must sit immediately after ${DOCUMENT_STEP} in ${CATALOG_FLOW}; got ${steps.join(' > ')}`,
    ).toBe(steps.indexOf(DOCUMENT_STEP) + 1);
  });

  test('AC-ORD-1: a session flow can carry only document + aml-screening', async ({ request }) => {
    session = await createSession(request, MINIMAL_FLOW, `e2e-modb-order-1-${randomUUID()}`);
    const configuration = await sessionConfiguration(request, session);
    expect(configuration.session_id, 'the SDK token must resolve to the session it was minted for').toBe(
      session.sessionId,
    );
    expect(configuration.steps, `${MINIMAL_FLOW} must expose document then ${AML_STEP}`).toEqual([
      DOCUMENT_STEP,
      AML_STEP,
    ]);
  });

  test('AC-ORD-3: a document whose MRZ passes starts exactly one AML screening for the session', async ({
    request,
  }) => {
    const requestId = await submitDocument(request, session);
    settledRows = await waitForAmlTerminal(request, session.sessionId);

    const mrz = rowOf(settledRows, MRZ_CHECK);
    expect(mrz.outcome, `the mocked ${MRZ_CHECK} of ${requestId} must pass before screening is expected`).toBe(
      'passed',
    );
    const screenings = settledRows.filter((row) => row.check_type === AML_CHECK);
    expect(
      screenings.length,
      `one passing document MRZ must start exactly one ${AML_CHECK}; got ${screenings
        .map((row) => `${row.status}/${row.outcome}`)
        .join(',')}`,
    ).toBe(ONE_SCREENING);
    expect(screenings[0]!.request_id, `the ${AML_CHECK} row must belong to the document step request`).toBe(requestId);
  });

  test('AC-ORD-5: the aml_screening check reaches a terminal state with a decided outcome', async ({ request }) => {
    const aml = rowOf(settledRows, AML_CHECK);
    expect(aml.status, `${AML_CHECK} must end completed, not ${aml.status} (${aml.error?.code ?? 'no error'})`).toBe(
      'completed',
    );
    expect(
      aml.outcome,
      `${AML_CHECK} must carry a decided outcome; error was ${aml.error?.message ?? 'none'}`,
    ).toMatch(/^(passed|review)$/);
    // Re-read: the row must stay terminal, i.e. nothing re-opens the screening after it settled.
    const reread = rowOf(await sessionChecks(request, session.sessionId), AML_CHECK);
    expect(reread.status, `${AML_CHECK} must stay terminal on a re-read`).toBe(aml.status);
  });

  test('AC-ORD-5: a passed screening completes the session; a review outcome leaves it processing', async ({
    request,
  }) => {
    const aml = rowOf(settledRows, AML_CHECK);
    const state = await progressState(request, session);
    if (aml.outcome === 'passed') {
      expect(state, 'a session whose only open step was a passed AML screening must be complete').toBe('complete');
      return;
    }
    expect(
      state,
      `a review outcome (${aml.error?.code ?? 'no code'}) must leave the session in manual review, not complete`,
    ).toBe('processing');
  });
});
