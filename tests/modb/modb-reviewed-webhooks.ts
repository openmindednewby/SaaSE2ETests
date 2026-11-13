import { expect, test, type APIRequestContext } from '@playwright/test';
import { AML_CHECK, rowOf, waitForAmlTerminal, type CheckRow, type SessionHandle } from './modb-session-helpers.js';
import { screenViaSession, type ScreenRequest } from './modb-session-mock.js';

const MOCK_URL_ENV = 'MODB_MOCK_URL';
export const MOCK_CONTROL_TOKEN_ENV = 'MODB_MOCK_CONTROL_TOKEN';
const MOCK_CONTROL_TOKEN_HEADER = 'x-mock-control-token';
export const REVIEWED_EVENT = 'verificationReviewed';
const WEBHOOK_TIMEOUT_MS = 60_000;
const QUIET_WINDOW_MS = 20_000;
const QUIET_MARGIN_MS = 15_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const REQUEST_TIMEOUT_MS = 30_000;

export interface ReviewedBody {
  session_id: string;
  request_id: string;
  status: string;
  decision: string;
  rejection_type: string | null;
  reason_codes: string[];
}

export interface ReceivedWebhook {
  event: string;
  signatureValid: boolean;
  body: ReviewedBody;
}

export interface ScreenedSession {
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

export async function firstReviewedWebhook(request: APIRequestContext, verificationId: string): Promise<ReceivedWebhook> {
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

export async function holdReviewedCount(
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

export async function screenToAmlTerminal(request: APIRequestContext, screen: ScreenRequest): Promise<ScreenedSession> {
  const { session, requestId } = await screenViaSession(request, screen);
  test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
  const rows = await waitForAmlTerminal(request, session.sessionId);
  return { session, aml: rowOf(rows, AML_CHECK) };
}
