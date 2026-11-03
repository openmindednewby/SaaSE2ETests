import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, request as playwrightRequest, test, type BrowserContext } from '@playwright/test';

import { loginRefusalSink, realTenantOfSession, refuseRealTenantBearer } from '../../fixtures/real-tenant-guard.js';

const REAL_TENANT = 'ubs';
const TEST_TENANT = 'e2e';
const SESSION_COOKIE = 'stub-session=1; Path=/';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function startStubBff(tenantSlug: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/bff/login') {
      res.writeHead(200, { ...JSON_HEADERS, 'Set-Cookie': SESSION_COOKIE });
      res.end('{}');
      return;
    }
    if (req.url === '/bff/api/kefi/api/v1/admin/landing-config') {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ tenantSlug }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html></html>');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}` });
    });
  });
}

async function signInThroughPage(context: BrowserContext, origin: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    await fetch('/bff/login', { method: 'POST', credentials: 'include' });
  });
}

test.describe('TEST-TENANT-1 "Tests never write to a real customer tenant": login guard', () => {
  const originalFail = loginRefusalSink.fail;
  let refusals: string[] = [];
  let server: Server | undefined;

  test.beforeEach(() => {
    refusals = [];
    loginRefusalSink.fail = (message) => refusals.push(message);
  });

  test.afterEach(() => {
    loginRefusalSink.fail = originalFail;
    server?.close();
  });

  test('AC-LOGIN-1 a browser login landing on a real tenant, refuses the test and drops the session', async ({ browser }) => {
    const stub = await startStubBff(REAL_TENANT);
    server = stub.server;
    const context = await browser.newContext();

    await signInThroughPage(context, stub.origin);

    await expect.poll(() => refusals.join(' ')).toContain('REFUSING TEST LOGIN ON A REAL TENANT');
    await expect.poll(() => context.cookies()).toEqual([]);
    await context.close();
  });

  test('AC-LOGIN-2 a browser login landing on a test tenant, keeps the session', async ({ browser }) => {
    const stub = await startStubBff(TEST_TENANT);
    server = stub.server;
    const context = await browser.newContext();

    await signInThroughPage(context, stub.origin);

    await expect.poll(async () => (await context.cookies()).length).toBe(1);
    await context.request.get(`${stub.origin}/bff/api/kefi/api/v1/admin/landing-config`);
    expect(refusals).toEqual([]);
    await context.close();
  });

  test('AC-LOGIN-3 an API login landing on a real tenant, throws', async () => {
    const stub = await startStubBff(REAL_TENANT);
    server = stub.server;
    const api = await playwrightRequest.newContext();

    const attempt = api.post(`${stub.origin}/bff/login`);

    await expect(attempt).rejects.toThrow('REFUSING TEST LOGIN ON A REAL TENANT');
    await api.dispose();
  });

  test('AC-LOGIN-4 a GET of the session tenant on a real tenant, throws', async () => {
    const stub = await startStubBff(REAL_TENANT);
    server = stub.server;
    const api = await playwrightRequest.newContext();

    const attempt = api.get(`${stub.origin}/bff/api/kefi/api/v1/admin/landing-config`);

    await expect(attempt).rejects.toThrow('REFUSING TEST LOGIN ON A REAL TENANT');
    await api.dispose();
  });

  test('AC-LOGIN-5 a tenant-owner bearer on a real tenant, throws; on a test tenant, passes', async () => {
    const clientFor = (tenantSlug: string) => ({
      get: () => Promise.resolve({ status: 200, data: { tenantSlug } }),
    });

    const onReal = refuseRealTenantBearer(clientFor(REAL_TENANT), 'token');
    const onTest = refuseRealTenantBearer(clientFor(TEST_TENANT), 'token');

    await expect(onReal).rejects.toThrow('REFUSING TEST LOGIN ON A REAL TENANT');
    await expect(onTest).resolves.toBe('token');
  });

  test('AC-LOGIN-6 a session body names its tenant, only a protected slug counts', () => {
    const bodies = [{ tenantSlug: ' UBS ' }, { tenantSlug: 'e2e' }, {}, null];

    const results = bodies.map((body) => realTenantOfSession(body));

    expect(results).toEqual(['ubs', undefined, undefined, undefined]);
  });
});
