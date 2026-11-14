import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AML_KEY_ENV, AML_URL_ENV } from './modb-processing-trace.js';
import { CLIENT_KEY_ENV, INTERNAL_TOKEN_ENV, assertGatewayReachable, clientApiKey, internalToken } from './modb-session-helpers.js';
import { screenToAmlTerminal } from './modb-reviewed-webhooks.js';

const LIST_TAKE = 50;
const REQUEST_TIMEOUT_MS = 30_000;

interface CaseItem {
  id: string;
  fullName: string;
  source: string;
}

async function caseNamesBySource(request: APIRequestContext, source: string): Promise<CaseItem[]> {
  const base = process.env[AML_URL_ENV]?.trim();
  const key = process.env[AML_KEY_ENV]?.trim();
  expect(base, `${AML_URL_ENV} is unset: Module A cannot be read`).toBeTruthy();
  expect(key, `${AML_KEY_ENV} is unset: Module A cannot be read`).toBeTruthy();
  const response = await request.get(`${base}/v1/cases?source=${source}&take=${LIST_TAKE}`, {
    headers: { 'x-api-key': key as string },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect(response.status(), `GET /v1/cases?source=${source}: ${await response.text()}`).toBe(200);
  return ((await response.json()).items ?? []) as CaseItem[];
}

test.describe('ERIC-SETTLE-1 gateway screenings stored as session @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    expect(clientApiKey(), `${CLIENT_KEY_ENV} is unset: no session can be created`).toBeTruthy();
    expect(internalToken(), `${INTERNAL_TOKEN_ENV} is unset: no check row can be read`).toBeTruthy();
    await assertGatewayReachable(request);
  });

  test('AC-ES-1 a screening requested through a gateway session, is listed under source session and not under api', async ({
    request,
  }) => {
    const subject = `Esession Probe ${randomUUID().slice(0, 8)}`;
    const flowId = 'frontend-v1-active-liveness.mrz-match.aml-screening';
    const expectedSource = 'session';

    await screenToAmlTerminal(request, { subject, flowId });

    const sessionCases = await caseNamesBySource(request, expectedSource);
    const apiCases = await caseNamesBySource(request, 'api');
    const stored = sessionCases.find((item) => item.fullName === subject);
    expect(stored, `${subject} must be in the newest ${LIST_TAKE} source=session cases`).toBeTruthy();
    expect(stored?.source).toBe(expectedSource);
    expect(apiCases.map((item) => item.fullName), 'source=api must not list the gateway screening').not.toContain(subject);
  });
});
