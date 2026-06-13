import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { getRealmToken } from '../../helpers/realm-token-helper.js';

/**
 * Katalogos (OnlineMenu) custom-domain API contract (Batch C).
 *
 * Exercises the tenant-owner + anonymous endpoints (onlinemenu-api, global RoutePrefix `api/v1`):
 *   - POST   /api/v1/CustomDomains                  (Admin) → 201 + ownership token + CNAME instruction
 *   - GET    /api/v1/CustomDomains                  (Admin) → the tenant's current domain
 *   - POST   /api/v1/CustomDomains/{externalId}/verify (Admin) → 200 (re-queues verification)
 *   - DELETE /api/v1/CustomDomains/{externalId}     (Admin) → 200 (revokes)
 *   - GET    /api/v1/internal/domains/check?Domain= (anon)  → 200 available / 404 claimed
 *   - GET    /api/v1/public/domains/resolve?Domain= (anon)  → 200 {menuExternalId} / 404
 *
 * Contract-only: with the verification poller off (the C-1 default), a domain stays Pending and
 * never resolves — so we assert the Pending + claimed + unresolved contract, not activation. The
 * endpoints pre-date the package migration, so this spec is valid against the current deployment too.
 */

const API_TIMEOUT_MS = 30_000;
const SETUP_TIMEOUT_MS = 60_000;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return value !== undefined && value.trim().length > 0
    ? value.trim().replace(/\/+$/, '')
    : fallback;
}

const ONLINEMENU_API_URL = resolveBaseUrl('ONLINEMENU_API_URL', 'https://localhost:5006');

async function makeApiContext(token?: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: ONLINEMENU_API_URL,
    ignoreHTTPSErrors: true,
    timeout: API_TIMEOUT_MS,
    extraHTTPHeaders: token !== undefined ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

test.describe.serial('OnlineMenu custom domains @online-menus @custom-domain', () => {
  let adminApi: APIRequestContext;
  let anonApi: APIRequestContext;
  let createdExternalId: string | null = null;
  const domainName = `e2e-cd-${Date.now()}.example.com`;

  test.beforeAll(async () => {
    test.setTimeout(SETUP_TIMEOUT_MS);
    const token = await getRealmToken('onlinemenu');
    if (token.accessToken === undefined || token.accessToken === '') {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    adminApi = await makeApiContext(token.accessToken);
    anonApi = await makeApiContext();
  });

  test.afterAll(async () => {
    test.setTimeout(API_TIMEOUT_MS);
    if (createdExternalId !== null) {
      await adminApi?.delete(`/api/v1/CustomDomains/${createdExternalId}`, { failOnStatusCode: false })
        .catch(() => undefined);
    }
    await adminApi?.dispose().catch(() => {});
    await anonApi?.dispose().catch(() => {});
  });

  test('POST creates a domain in a pending (not-yet-active) state with an ownership token', async () => {
    const response = await adminApi.post('/api/v1/CustomDomains', {
      data: { domainName },
      failOnStatusCode: false,
    });

    expect(response.status(), await response.text()).toBe(HTTP_CREATED);
    const body = await response.json();
    expect(body.externalId).toBeTruthy();
    expect(String(body.domainName).toLowerCase()).toBe(domainName.toLowerCase());
    expect(String(body.ownershipToken)).toMatch(/^saas-/);
    expect(body.cnameTarget).toBeTruthy();
    // Not active yet — fresh domain awaits DNS + verification.
    expect(String(body.status)).not.toMatch(/^Active$/i);

    createdExternalId = String(body.externalId);
  });

  test('POST a second time for the same tenant is rejected (one domain per tenant)', async () => {
    const response = await adminApi.post('/api/v1/CustomDomains', {
      data: { domainName: `e2e-cd-dup-${Date.now()}.example.com` },
      failOnStatusCode: false,
    });
    // 409 Conflict (tenant already has an active/pending domain).
    expect(response.status()).toBe(409);
  });

  test('GET returns the tenant\'s domain', async () => {
    const response = await adminApi.get('/api/v1/CustomDomains', { failOnStatusCode: false });
    expect(response.status()).toBe(HTTP_OK);
    const body = await response.json();
    expect(String(body.domainName).toLowerCase()).toBe(domainName.toLowerCase());
  });

  test('availability check: claimed domain → 404, random domain → 200', async () => {
    const claimed = await anonApi.get(
      `/api/v1/internal/domains/check?Domain=${encodeURIComponent(domainName)}`,
      { failOnStatusCode: false });
    expect(claimed.status()).toBe(HTTP_NOT_FOUND);

    const random = await anonApi.get(
      `/api/v1/internal/domains/check?Domain=${encodeURIComponent(`free-${Date.now()}.example.com`)}`,
      { failOnStatusCode: false });
    expect(random.status()).toBe(HTTP_OK);
  });

  test('public resolve of a pending/unknown domain returns 404 (only Active domains resolve)', async () => {
    const pending = await anonApi.get(
      `/api/v1/public/domains/resolve?Domain=${encodeURIComponent(domainName)}`,
      { failOnStatusCode: false });
    expect(pending.status()).toBe(HTTP_NOT_FOUND);
  });

  test('verify re-queues the pending domain (200)', async () => {
    expect(createdExternalId, 'domain must have been created').not.toBeNull();
    const response = await adminApi.post(`/api/v1/CustomDomains/${createdExternalId}/verify`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(HTTP_OK);
  });

  test('DELETE revokes the domain; GET then reports none', async () => {
    expect(createdExternalId, 'domain must have been created').not.toBeNull();
    const del = await adminApi.delete(`/api/v1/CustomDomains/${createdExternalId}`, {
      failOnStatusCode: false,
    });
    expect(del.status()).toBe(HTTP_OK);
    createdExternalId = null;

    const after = await adminApi.get('/api/v1/CustomDomains', { failOnStatusCode: false });
    expect([HTTP_OK, HTTP_NO_CONTENT]).toContain(after.status());
    if (after.status() === HTTP_OK) {
      const body = await after.json().catch(() => null);
      // A revoked domain must not be returned as the tenant's active domain.
      if (body !== null && body.domainName !== undefined) {
        expect(String(body.domainName).toLowerCase()).not.toBe(domainName.toLowerCase());
      }
    }
  });
});
