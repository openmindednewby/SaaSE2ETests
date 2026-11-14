import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AML_KEY_ENV, AML_URL_ENV } from './modb-processing-trace.js';
import { mockIdentityFields } from './modb-demo-identity.js';
import { resolveGatewayUrl } from './modb-guards.js';
import {
  AML_CHECK,
  CLIENT_KEY_ENV,
  INTERNAL_TOKEN_ENV,
  MINIMAL_AML_FLOW,
  amlCase,
  assertGatewayReachable,
  clientApiKey,
  internalToken,
  rowOf,
  submitDocument,
  waitForAmlTerminal,
  type CheckRow,
  type SessionHandle,
} from './modb-session-helpers.js';

const MOCK_URL_ENV = 'MODB_MOCK_URL';
const MOCK_CONTROL_TOKEN_ENV = 'MODB_MOCK_CONTROL_TOKEN';
const REQUEST_TIMEOUT_MS = 30_000;
const WEBHOOK_TIMEOUT_MS = 60_000;
const POLL_INTERVALS_MS = [1_000, 2_000, 3_000];
const HTTP_CREATED = 201;
const HTTP_OK = 200;

interface DecisionProfile {
  code: string;
  name: string | null;
  flow: string | null;
  source: string | null;
}

interface Webhook {
  event: string;
  body: Record<string, unknown>;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  expect(value, `${name} is unset`).toBeTruthy();
  return (value as string).replace(/\/+$/, '');
}

function gatewayApi(): string {
  return `${resolveGatewayUrl(process.env)}/api`;
}

function moduleA(path: string): string {
  return `${env(AML_URL_ENV)}${path}`;
}

function moduleAHeaders(): Record<string, string> {
  return { 'x-api-key': env(AML_KEY_ENV) };
}

async function createProfile(request: APIRequestContext, code: string, name: string): Promise<void> {
  const response = await request.post(moduleA('/v1/decision-profiles'), {
    headers: moduleAHeaders(),
    data: { code, name },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect([HTTP_CREATED, HTTP_OK], `POST /v1/decision-profiles ${code}: ${await response.text()}`).toContain(
    response.status(),
  );
}

async function removeProfile(request: APIRequestContext, code: string): Promise<string> {
  const url = moduleA(`/v1/decision-profiles/${code}`);
  const options = { headers: moduleAHeaders(), timeout: REQUEST_TIMEOUT_MS, failOnStatusCode: false };
  const deleted = await request.delete(url, options);
  if (deleted.ok()) return 'deleted';
  const disabled = await request.post(`${url}/disable`, options);
  return disabled.ok() ? `disabled (delete answered ${deleted.status()})` : `left (delete ${deleted.status()}, disable ${disabled.status()})`;
}

async function createSession(request: APIRequestContext, decisionProfile?: string): Promise<SessionHandle> {
  const flowId = MINIMAL_AML_FLOW;
  const response = await request.post(`${gatewayApi()}/v1/identity-verification/sessions`, {
    headers: { 'x-api-key': clientApiKey() ?? '' },
    data: { externalApplicantId: `e2e-modb-${randomUUID()}`, flowId, ...(decisionProfile ? { decisionProfile } : {}) },
    timeout: REQUEST_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  expect(response.ok(), `POST /api/v1/identity-verification/sessions: ${await response.text()}`).toBe(true);
  const body = await response.json();
  return {
    sessionId: body.sessionId,
    verificationId: body.verificationId,
    applicantId: body.applicantId,
    flowId: body.flowId,
    token: body.access.token,
    status: body.status,
    creationStatus: body.creationStatus,
  };
}

async function screen(request: APIRequestContext, decisionProfile?: string): Promise<{ session: SessionHandle; requestId: string; aml: CheckRow }> {
  const session = await createSession(request, decisionProfile);
  const subject = `Dprofile Probe ${randomUUID().slice(0, 8)}`;
  const requestId = await submitDocument(request, session, {
    mockOutcomes: { mrz_match: 'passed' },
    extraFields: mockIdentityFields(subject),
  });
  test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
  const rows = await waitForAmlTerminal(request, session.sessionId);
  return { session, requestId, aml: rowOf(rows, AML_CHECK) };
}

async function readWebhooks(request: APIRequestContext, ids: string[]): Promise<Webhook[] | string> {
  const all: Webhook[] = [];
  for (const id of ids) {
    const response = await request
      .get(`${env(MOCK_URL_ENV)}/test/webhooks`, {
        params: { requestId: id },
        headers: { 'x-mock-control-token': process.env[MOCK_CONTROL_TOKEN_ENV] ?? '' },
        timeout: REQUEST_TIMEOUT_MS,
        failOnStatusCode: false,
      })
      .catch((error: Error) => error);
    if (response instanceof Error) return `transport-error: ${response.message.split(/\r?\n/)[0]}`;
    if (!response.ok()) return `receiver answered ${response.status()}`;
    all.push(...((await response.json()) as Webhook[]));
  }
  return all;
}

async function profiledWebhooks(request: APIRequestContext, ids: string[]): Promise<Webhook[]> {
  let found: Webhook[] = [];
  await expect
    .poll(
      async () => {
        const read = await readWebhooks(request, ids);
        if (typeof read === 'string') return read;
        found = read.filter((webhook) => webhook.body?.decision_profile);
        const events = read.map((webhook) => webhook.event).join(',') || 'none';
        return found.length > 0 ? 'delivered' : `no webhook with decision_profile (${events})`;
      },
      { timeout: WEBHOOK_TIMEOUT_MS, intervals: POLL_INTERVALS_MS, message: `no webhook of ${ids.join('/')} carried decision_profile` },
    )
    .toBe('delivered');
  return found;
}

async function caseProfile(request: APIRequestContext, requestId: string): Promise<DecisionProfile | null> {
  const response = await amlCase(request, requestId);
  expect(response.status(), `GET aml-case ${requestId}: ${await response.text()}`).toBe(HTTP_OK);
  const body = await response.json();
  return ((body.data ?? body).decision_profile ?? null) as DecisionProfile | null;
}

test.describe('ERIC-SETTLE-1 session decision profile override @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    expect(clientApiKey(), `${CLIENT_KEY_ENV} is unset: no session can be created`).toBeTruthy();
    expect(internalToken(), `${INTERNAL_TOKEN_ENV} is unset: no check row can be read`).toBeTruthy();
    await assertGatewayReachable(request);
  });

  test('AC-ES-11 a session naming no decision profile, is decided by the session-flow default on check, case and webhook', async ({
    request,
  }) => {
    const expectedSource = 'flow_default';

    const { session, requestId, aml } = await screen(request);

    expect(aml.status, `aml_screening error: ${JSON.stringify(aml.error)}`).toBe('completed');
    const checkProfile = aml.result?.decision_profile as DecisionProfile | undefined;
    expect(checkProfile?.source, `check result decision_profile: ${JSON.stringify(checkProfile)}`).toBe(expectedSource);
    expect((await caseProfile(request, requestId))?.source).toBe(expectedSource);
    const hooks = await profiledWebhooks(request, [requestId, session.verificationId]);
    for (const hook of hooks)
      expect((hook.body.decision_profile as DecisionProfile).source, `${hook.event} decision_profile`).toBe(expectedSource);
  });

  test('AC-ES-12 a session naming a tenant decision profile, shows that code with source request on check, case and webhook', async ({
    request,
  }) => {
    const code = `E2E_DP_${randomUUID().slice(0, 8).toUpperCase()}`;
    const name = `E2E decision profile ${code}`;
    const expectedSource = 'request';
    await createProfile(request, code, name);

    try {
      const { session, requestId, aml } = await screen(request, code);

      expect(aml.status, `aml_screening error: ${JSON.stringify(aml.error)}`).toBe('completed');
      const checkProfile = aml.result?.decision_profile as DecisionProfile | undefined;
      expect(checkProfile, 'check result decision_profile').toMatchObject({ code, name, source: expectedSource });
      expect(await caseProfile(request, requestId), 'aml-case decision_profile').toMatchObject({ code, source: expectedSource });
      const hooks = await profiledWebhooks(request, [requestId, session.verificationId]);
      for (const hook of hooks)
        expect(hook.body.decision_profile, `${hook.event} decision_profile`).toMatchObject({ code, source: expectedSource });
    } finally {
      test.info().annotations.push({ type: 'cleanup', description: `${code}: ${await removeProfile(request, code)}` });
    }
  });

  test('AC-ES-11 a session naming an unknown decision profile, fails its screening with a profile-not-found error', async ({
    request,
  }) => {
    const code = `E2E_NOPE_${randomUUID().slice(0, 8).toUpperCase()}`;

    const { aml } = await screen(request, code);

    expect(aml.status, `aml_screening must not complete: ${JSON.stringify(aml)}`).not.toBe('completed');
    expect(JSON.stringify(aml.error), 'the error names the missing profile').toMatch(new RegExp(`PROFILE_NOT_FOUND|${code}`));
  });
});
