import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  AML_CHECK,
  CLIENT_KEY_ENV,
  INTERNAL_TOKEN_ENV,
  MRZ_CHECK,
  assertGatewayReachable,
  clientApiKey,
  internalToken,
  rowOf,
  waitForAmlTerminal,
  type CheckRow,
} from './modb-session-helpers.js';
import { screenViaSession } from './modb-session-mock.js';

const MOCK_URL_ENV = 'MODB_MOCK_URL';
const CHECK_COMPLETED_EVENT = 'verificationCheckCompleted';
const WEBHOOK_TIMEOUT_MS = 60_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const REQUEST_TIMEOUT_MS = 30_000;

interface WebhookBody {
  request_id: string;
  check_type?: string;
  status: string;
  outcome?: string | null;
  reason_codes?: string[];
  reason_code?: string;
}

interface ReceivedWebhook {
  receivedAt: string;
  event: string;
  signatureValid: boolean;
  body: WebhookBody;
}

interface ScreenedSubject {
  aml: CheckRow;
  mrz: CheckRow;
  amlWebhook: ReceivedWebhook;
  mrzWebhook: ReceivedWebhook;
}

function mockUrl(): string {
  const raw = process.env[MOCK_URL_ENV]?.trim();
  if (!raw) throw new Error(`${MOCK_URL_ENV} is unset: the webhook receiver of aml-moduleb-mock cannot be read`);
  return raw.replace(/\/+$/, '');
}

async function deliveredWebhook(
  request: APIRequestContext,
  requestId: string,
  checkType: string,
): Promise<ReceivedWebhook> {
  let received: ReceivedWebhook[] = [];
  const isWanted = (webhook: ReceivedWebhook): boolean => webhook.body.check_type === checkType;
  await expect
    .poll(
      async () => {
        const response = await request
          .get(`${mockUrl()}/test/webhooks`, {
            params: { requestId },
            timeout: REQUEST_TIMEOUT_MS,
            failOnStatusCode: false,
          })
          .catch((error: Error) => error);
        if (response instanceof Error) return `transport-error: ${response.message.split(/\r?\n/)[0]}`;
        if (!response.ok()) return `receiver answered ${response.status()}`;
        received = (await response.json()) as ReceivedWebhook[];
        if (received.some(isWanted)) return 'delivered';
        return `received: ${received.map((webhook) => webhook.body.check_type ?? webhook.event).join(',') || 'none'}`;
      },
      {
        timeout: WEBHOOK_TIMEOUT_MS,
        intervals: POLL_INTERVALS_MS,
        message: `the ${checkType} webhook of ${requestId} never reached the receiver`,
      },
    )
    .toBe('delivered');
  return received.find(isWanted) as ReceivedWebhook;
}

async function screenSubject(request: APIRequestContext, subject: string): Promise<ScreenedSubject> {
  const { session, requestId } = await screenViaSession(request, { subject });
  test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
  const rows = await waitForAmlTerminal(request, session.sessionId);
  return {
    aml: rowOf(rows, AML_CHECK),
    mrz: rowOf(rows, MRZ_CHECK),
    amlWebhook: await deliveredWebhook(request, requestId, AML_CHECK),
    mrzWebhook: await deliveredWebhook(request, requestId, MRZ_CHECK),
  };
}

function expectSignedFor(webhook: ReceivedWebhook, row: CheckRow): void {
  expect(webhook.signatureValid, `the ${row.check_type} webhook must carry a valid HMAC signature`).toBe(true);
  expect(webhook.event).toBe(CHECK_COMPLETED_EVENT);
  expect(webhook.body.status).toBe(row.status);
  expect(webhook.body.outcome).toBe(row.outcome);
}

test.describe('Module B reason codes on the stored result and the signed webhook @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    expect(clientApiKey(), `${CLIENT_KEY_ENV} is unset: no session can be created`).toBeTruthy();
    expect(internalToken(), `${INTERNAL_TOKEN_ENV} is unset: no check row can be read`).toBeTruthy();
    await assertGatewayReachable(request);
  });

  test('AC6 with a sanctioned subject, stored result and signed webhook carry SANCTIONS and SANCTIONS_EXACT_NAME', async ({
    request,
  }) => {
    const subject = 'Vladimir Putin';
    const expectedCategory = 'SANCTIONS';
    const expectedReasonCode = 'SANCTIONS_EXACT_NAME';

    const { aml, amlWebhook } = await screenSubject(request, subject);

    expect(aml.status).toBe('completed');
    expect(aml.result?.reason_codes).toContain(expectedCategory);
    expect(aml.result?.reason_code).toBe(expectedReasonCode);
    expectSignedFor(amlWebhook, aml);
    expect(amlWebhook.body.reason_codes).toEqual(aml.result?.reason_codes);
    expect(amlWebhook.body.reason_code).toBe(expectedReasonCode);
  });

  test('AC6 with a PEP subject, stored result and signed webhook carry PEP and PEP_MATCH, not SANCTIONS', async ({
    request,
  }) => {
    const subject = 'Emmanuel Macron';
    const expectedCategory = 'PEP';
    const absentCategory = 'SANCTIONS';
    const expectedReasonCode = 'PEP_MATCH';

    const { aml, amlWebhook } = await screenSubject(request, subject);

    expect(aml.status).toBe('completed');
    expect(aml.result?.reason_codes).toContain(expectedCategory);
    expect(aml.result?.reason_codes).not.toContain(absentCategory);
    expect(aml.result?.reason_code).toBe(expectedReasonCode);
    expectSignedFor(amlWebhook, aml);
    expect(amlWebhook.body.reason_codes).toEqual(aml.result?.reason_codes);
    expect(amlWebhook.body.reason_code).toBe(expectedReasonCode);
  });

  test('AC6 with a clean subject, stored result and signed webhook carry no categories and NO_BLOCKING_MATCH', async ({
    request,
  }) => {
    const subject = 'Jane Doe';
    const expectedCategories: string[] = [];
    const expectedReasonCode = 'NO_BLOCKING_MATCH';

    const { aml, amlWebhook } = await screenSubject(request, subject);

    expect(aml.status).toBe('completed');
    expect(aml.result?.reason_codes).toEqual(expectedCategories);
    expect(aml.result?.reason_code).toBe(expectedReasonCode);
    expectSignedFor(amlWebhook, aml);
    expect(amlWebhook.body.reason_codes).toEqual(expectedCategories);
    expect(amlWebhook.body.reason_code).toBe(expectedReasonCode);
  });

  test('AC7 with an MRZ check on the same session, its stored result and signed webhook have neither key', async ({
    request,
  }) => {
    const subject = 'Jane Doe';
    const expectedMrzOutcome = 'passed';

    const { aml, mrz, mrzWebhook } = await screenSubject(request, subject);

    expect(mrz.request_id).toBe(aml.request_id);
    expect(mrz.outcome).toBe(expectedMrzOutcome);
    expect(mrz.result).not.toHaveProperty('reason_codes');
    expect(mrz.result).not.toHaveProperty('reason_code');
    expectSignedFor(mrzWebhook, mrz);
    expect(mrzWebhook.body).not.toHaveProperty('reason_codes');
    expect(mrzWebhook.body).not.toHaveProperty('reason_code');
  });
});
