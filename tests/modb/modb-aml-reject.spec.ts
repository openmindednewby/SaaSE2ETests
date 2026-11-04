import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  AML_CHECK,
  CLIENT_KEY_ENV,
  INTERNAL_TOKEN_ENV,
  assertGatewayReachable,
  clientApiKey,
  internalToken,
  progressState,
  rowOf,
  sessionConfiguration,
  waitForAmlTerminal,
  type CheckRow,
  type SessionHandle,
} from './modb-session-helpers.js';
import { screenViaSession, type ScreenRequest } from './modb-session-mock.js';

const MOCK_URL_ENV = 'MODB_MOCK_URL';
const MOCK_CONTROL_TOKEN_ENV = 'MODB_MOCK_CONTROL_TOKEN';
const MOCK_CONTROL_TOKEN_HEADER = 'x-mock-control-token';
const REVIEWED_EVENT = 'verificationReviewed';
const WEBHOOK_TIMEOUT_MS = 60_000;
const QUIET_WINDOW_MS = 20_000;
const QUIET_MARGIN_MS = 15_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const REQUEST_TIMEOUT_MS = 30_000;

interface ReviewedBody {
  session_id: string;
  request_id: string;
  status: string;
  decision: string;
  rejection_type: string | null;
  reason_codes: string[];
}

interface ReceivedWebhook {
  event: string;
  signatureValid: boolean;
  body: ReviewedBody;
}

interface ScreenedSession {
  session: SessionHandle;
  aml: CheckRow;
}

function mockUrl(): string {
  const raw = process.env[MOCK_URL_ENV]?.trim();
  if (!raw) throw new Error(`${MOCK_URL_ENV} is unset: the webhook receiver of aml-moduleb-mock cannot be read`);
  return raw.replace(/\/+$/, '');
}

async function readReviewedWebhooks(
  request: APIRequestContext,
  verificationId: string,
): Promise<ReceivedWebhook[] | string> {
  const response = await request
    .get(`${mockUrl()}/test/webhooks`, {
      params: { requestId: verificationId },
      headers: { [MOCK_CONTROL_TOKEN_HEADER]: process.env[MOCK_CONTROL_TOKEN_ENV] ?? '' },
      timeout: REQUEST_TIMEOUT_MS,
      failOnStatusCode: false,
    })
    .catch((error: Error) => error);
  if (response instanceof Error) return `transport-error: ${response.message.split(/\r?\n/)[0]}`;
  if (!response.ok()) return `receiver answered ${response.status()}`;
  const received = (await response.json()) as ReceivedWebhook[];
  return received.filter((webhook) => webhook.event === REVIEWED_EVENT);
}

async function firstReviewedWebhook(request: APIRequestContext, verificationId: string): Promise<ReceivedWebhook> {
  let delivered: ReceivedWebhook[] = [];
  await expect
    .poll(
      async () => {
        const read = await readReviewedWebhooks(request, verificationId);
        if (typeof read === 'string') return read;
        delivered = read;
        return delivered.length > 0 ? 'delivered' : 'none';
      },
      {
        timeout: WEBHOOK_TIMEOUT_MS,
        intervals: POLL_INTERVALS_MS,
        message: `the ${REVIEWED_EVENT} webhook of ${verificationId} never reached the receiver`,
      },
    )
    .toBe('delivered');
  return delivered[0];
}

async function holdReviewedCount(
  request: APIRequestContext,
  verificationId: string,
  expectedCount: number,
): Promise<void> {
  const startedAt = Date.now();
  await expect
    .poll(
      async () => {
        const read = await readReviewedWebhooks(request, verificationId);
        if (typeof read === 'string') return read;
        if (read.length !== expectedCount) return `${read.length} ${REVIEWED_EVENT} webhooks`;
        return Date.now() - startedAt >= QUIET_WINDOW_MS ? 'held' : 'holding';
      },
      {
        timeout: QUIET_WINDOW_MS + QUIET_MARGIN_MS,
        intervals: POLL_INTERVALS_MS,
        message: `${verificationId} must hold exactly ${expectedCount} ${REVIEWED_EVENT} webhooks for ${QUIET_WINDOW_MS} ms`,
      },
    )
    .toBe('held');
}

async function screenToAmlTerminal(request: APIRequestContext, screen: ScreenRequest): Promise<ScreenedSession> {
  const { session, requestId } = await screenViaSession(request, screen);
  test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
  const rows = await waitForAmlTerminal(request, session.sessionId);
  return { session, aml: rowOf(rows, AML_CHECK) };
}

test.describe('Module B session outcome of an AML decision @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    expect(clientApiKey(), `${CLIENT_KEY_ENV} is unset: no session can be created`).toBeTruthy();
    expect(internalToken(), `${INTERNAL_TOKEN_ENV} is unset: no check row can be read`).toBeTruthy();
    expect(process.env[MOCK_CONTROL_TOKEN_ENV], `${MOCK_CONTROL_TOKEN_ENV} is unset: the receiver cannot be read`).toBeTruthy();
    await assertGatewayReachable(request);
  });

  test('AC1 with an AML Fail and later steps never submitted, the session completes REJECTED FINAL', async ({
    request,
  }) => {
    const subject = 'Viktor Bout';
    const birthDate = '1967-01-13';
    const flowId = 'standard-kyc';
    const amlStep = 'aml-screening';
    const expectedAmlOutcome = 'failed';
    const expectedStatus = 'COMPLETED';
    const expectedDecision = 'REJECTED';
    const expectedRejectionType = 'FINAL';
    const expectedProgress = 'complete';

    const { session, aml } = await screenToAmlTerminal(request, { subject, birthDate, flowId });

    const { steps } = await sessionConfiguration(request, session);
    expect(steps.indexOf(amlStep), `${flowId} must keep a step after ${amlStep}: ${steps.join(' > ')}`).toBeLessThan(
      steps.length - 1,
    );
    expect(aml.outcome).toBe(expectedAmlOutcome);
    const { body } = await firstReviewedWebhook(request, session.verificationId);
    expect(body.status).toBe(expectedStatus);
    expect(body.decision).toBe(expectedDecision);
    expect(body.rejection_type).toBe(expectedRejectionType);
    expect(await progressState(request, session)).toBe(expectedProgress);
  });

  test('AC2 with an AML Fail on a sanctions match, the session reason codes name AML_SANCTIONS', async ({ request }) => {
    const subject = 'Viktor Bout';
    const birthDate = '1967-01-13';
    const expectedStoredCategory = 'SANCTIONS';
    const expectedSessionCode = 'AML_SANCTIONS';

    const { session, aml } = await screenToAmlTerminal(request, { subject, birthDate });

    expect(aml.result?.reason_codes).toContain(expectedStoredCategory);
    const { body } = await firstReviewedWebhook(request, session.verificationId);
    expect(body.reason_codes).toContain(expectedSessionCode);
  });

  test('AC4 with an AML Fail, the client receives one signed verificationReviewed carrying the codes', async ({
    request,
  }) => {
    const subject = 'Viktor Bout';
    const birthDate = '1967-01-13';
    const expectedDeliveries = 1;
    const expectedSessionCode = 'AML_SANCTIONS';

    const { session } = await screenToAmlTerminal(request, { subject, birthDate });

    const webhook = await firstReviewedWebhook(request, session.verificationId);
    await holdReviewedCount(request, session.verificationId, expectedDeliveries);
    expect(webhook.signatureValid, 'the final webhook must carry a valid HMAC signature').toBe(true);
    expect(webhook.body.session_id).toBe(session.sessionId);
    expect(webhook.body.reason_codes).toContain(expectedSessionCode);
  });

  test('AC7 with an AML Review, progress is in_review and no verificationReviewed is sent', async ({ request }) => {
    const subject = 'Vladimir Putin';
    const expectedAmlOutcome = 'review';
    const expectedProgress = 'in_review';
    const expectedDeliveries = 0;

    const { session, aml } = await screenToAmlTerminal(request, { subject });

    expect(aml.outcome).toBe(expectedAmlOutcome);
    expect(await progressState(request, session)).toBe(expectedProgress);
    await holdReviewedCount(request, session.verificationId, expectedDeliveries);
  });
});
