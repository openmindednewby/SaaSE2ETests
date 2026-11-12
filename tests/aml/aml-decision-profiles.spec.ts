import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const API_URL = (process.env.AML_API_URL?.trim() || 'https://aml-screening.dloizides.com').replace(/\/$/, '');
const IDP_URL = (process.env.AML_IDP_URL?.trim() || 'https://aml-identity.dloizides.com').replace(/\/$/, '');
const TENANT_ID = process.env.AML_TESTER_TENANT_ID?.trim() || '7e57a001-0000-0000-0000-000000000001';
const API_KEY = process.env.AML_TESTER_API_KEY?.trim() || '';
const CLI_SECRET = process.env.AML_ADMIN_CLI_SECRET?.trim() || '';
const TEST_TENANT_NAME = /^AML Tester [0-9]+$/;
const TIMEOUT_MS = 25_000;
const SUBJECT = 'Quillon Varnasse';
const PROFILE_CODE = `QA_SMOKE_${Date.now()}`;
const OPERATOR_PROFILES = `/v1/tenants/${TENANT_ID}/decision-profiles`;

interface DecisionProfileRef {
  code: string;
  name: string;
  flow: string;
  source: string;
}

let operatorToken = '';

const keyHeaders = (): Record<string, string> => ({ 'X-Api-Key': API_KEY, Authorization: `Bearer ${API_KEY}` });
const operatorHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${operatorToken}` });

async function check(request: APIRequestContext, body: Record<string, unknown>): Promise<APIResponse> {
  return request.post(`${API_URL}/v1/screenings/check`, { data: body, headers: keyHeaders(), timeout: TIMEOUT_MS });
}

async function errorCode(response: APIResponse): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  expect(API_KEY, 'AML_TESTER_API_KEY (an aml-tester-1 key) is required').not.toBe('');
  expect(CLI_SECRET, 'AML_ADMIN_CLI_SECRET is required for profile writes').not.toBe('');
  const token = await request.post(`${IDP_URL}/connect/token`, {
    form: { grant_type: 'client_credentials', client_id: 'aml-admin-cli', client_secret: CLI_SECRET },
    timeout: TIMEOUT_MS,
  });
  expect(token.status(), 'aml-admin-cli token mint').toBe(200);
  operatorToken = ((await token.json()) as { access_token: string }).access_token;
  const me = await request.get(`${API_URL}/v1/me`, { headers: keyHeaders(), timeout: TIMEOUT_MS });
  expect(me.status(), 'GET /v1/me with the tester key').toBe(200);
  const tenant = (await me.json()) as { tenantId: string; tenantName: string };
  expect(tenant.tenantId, 'the key must belong to the configured test tenant').toBe(TENANT_ID);
  expect(tenant.tenantName, 'TEST-TENANT-1: only an aml-tester-* tenant').toMatch(TEST_TENANT_NAME);
});

test('MP-SMOKE-1 operator creates a new profile, returns 201', async ({ request }) => {
  const body = { code: PROFILE_CODE, name: `QA smoke ${PROFILE_CODE}` };

  const response = await request.post(`${API_URL}${OPERATOR_PROFILES}`, { data: body, headers: operatorHeaders(), timeout: TIMEOUT_MS });

  expect(response.status(), await response.text()).toBe(201);
});

test('MP-SMOKE-2 check with an unknown profile code, returns 400 PROFILE_NOT_FOUND', async ({ request }) => {
  const body = { fullName: SUBJECT, decisionProfile: 'NOPE' };

  const response = await check(request, body);

  expect(response.status()).toBe(400);
  expect(await errorCode(response)).toBe('PROFILE_NOT_FOUND');
});

test('MP-SMOKE-3 check naming the new profile, returns 201 with source request', async ({ request }) => {
  const body = { fullName: SUBJECT, decisionProfile: PROFILE_CODE };

  const response = await check(request, body);

  expect(response.status(), await response.text()).toBe(201);
  const profile = ((await response.json()) as { decisionProfile: DecisionProfileRef }).decisionProfile;
  expect(profile.code).toBe(PROFILE_CODE);
  expect(profile.source).toBe('request');
});

test('MP-SMOKE-4 check with no profile, returns 201 with source flow_default on flow api', async ({ request }) => {
  const body = { fullName: SUBJECT };

  const response = await check(request, body);

  expect(response.status(), await response.text()).toBe(201);
  const profile = ((await response.json()) as { decisionProfile: DecisionProfileRef }).decisionProfile;
  expect(profile.source).toBe('flow_default');
  expect(profile.flow).toBe('api');
});

test('MP-SMOKE-5 profile read after it decided a screening, returns frozen true', async ({ request }) => {
  const path = `${API_URL}${OPERATOR_PROFILES}/${PROFILE_CODE}`;

  const response = await request.get(path, { headers: operatorHeaders(), timeout: TIMEOUT_MS });

  expect(response.status()).toBe(200);
  expect(((await response.json()) as { frozen: boolean }).frozen).toBe(true);
});

test('MP-SMOKE-6 rename of a frozen profile, returns 409 PROFILE_FROZEN', async ({ request }) => {
  const body = { name: 'Renamed after use' };

  const response = await request.put(`${API_URL}${OPERATOR_PROFILES}/${PROFILE_CODE}`, { data: body, headers: operatorHeaders(), timeout: TIMEOUT_MS });

  expect(response.status()).toBe(409);
  expect(await errorCode(response)).toBe('PROFILE_FROZEN');
});

test('MP-SMOKE-7 check naming a disabled profile, returns 400 PROFILE_DISABLED', async ({ request }) => {
  const disable = await request.post(`${API_URL}${OPERATOR_PROFILES}/${PROFILE_CODE}/disable`, { headers: operatorHeaders(), timeout: TIMEOUT_MS });
  expect(disable.status(), await disable.text()).toBe(200);
  const body = { fullName: SUBJECT, decisionProfile: PROFILE_CODE };

  const response = await check(request, body);

  expect(response.status()).toBe(400);
  expect(await errorCode(response)).toBe('PROFILE_DISABLED');
});
