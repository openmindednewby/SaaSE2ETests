import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Katalogos (OnlineMenu) custom-domain PUBLIC surface (Batch C).
 *
 * Covers the anonymous endpoints a menu served on a tenant custom host depends on
 * (onlinemenu-api, global RoutePrefix `api/v1`):
 *   - GET /api/v1/internal/domains/check?Domain= → 200 claimed / 404 available (no body, no info disclosure)
 *   - GET /api/v1/public/domains/resolve?Domain= → 200 {menuExternalId} / 404
 *   - the custom-domain CORS policy: these endpoints reflect any Origin (so a menu on
 *     menu.acme.com can call katalogos-api.dloizides.com cross-origin).
 *
 * The owner CRUD endpoints (POST/GET/DELETE /CustomDomains, /verify) require the BFF
 * browser session the other online-menus specs use (a raw realm token has no tenant/Admin
 * context → 401); that admin-CRUD E2E is a follow-up. The CRUD + store-adapter logic is
 * covered by the OnlineMenu unit suite.
 */

const API_TIMEOUT_MS = 30_000;
const HTTP_NOT_FOUND = 404;
const CUSTOM_ORIGIN = 'https://menu.e2e-acme.example';

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return value !== undefined && value.trim().length > 0
    ? value.trim().replace(/\/+$/, '')
    : fallback;
}

const ONLINEMENU_API_URL = resolveBaseUrl('ONLINEMENU_API_URL', 'https://localhost:5006');

test.describe('OnlineMenu custom domains — public surface @online-menus @custom-domain', () => {
  let anonApi: APIRequestContext;

  test.beforeAll(async () => {
    anonApi = await playwrightRequest.newContext({
      baseURL: ONLINEMENU_API_URL,
      ignoreHTTPSErrors: true,
      timeout: API_TIMEOUT_MS,
    });
  });

  test.afterAll(async () => {
    await anonApi?.dispose().catch(() => {});
  });

  test('availability check: an unclaimed domain is available → 404 (200 means claimed)', async () => {
    const response = await anonApi.get(
      `/api/v1/internal/domains/check?Domain=${encodeURIComponent(`free-${Date.now()}.example.com`)}`,
      { failOnStatusCode: false });
    expect(response.status()).toBe(HTTP_NOT_FOUND);
  });

  test('public resolve of an unknown domain returns 404 (only Active domains resolve)', async () => {
    const response = await anonApi.get(
      `/api/v1/public/domains/resolve?Domain=${encodeURIComponent(`unknown-${Date.now()}.example.com`)}`,
      { failOnStatusCode: false });
    expect(response.status()).toBe(HTTP_NOT_FOUND);
  });

  test('resolve reflects a custom Origin (CORS) so menus on custom hosts can call it', async () => {
    const response = await anonApi.get(
      `/api/v1/public/domains/resolve?Domain=${encodeURIComponent(`cors-${Date.now()}.example.com`)}`,
      { headers: { Origin: CUSTOM_ORIGIN }, failOnStatusCode: false });
    // CORS headers are applied regardless of the 404 body.
    expect(response.headers()['access-control-allow-origin']).toBe(CUSTOM_ORIGIN);
  });

  test('OPTIONS preflight on a public endpoint succeeds with CORS headers', async () => {
    const response = await anonApi.fetch(
      `/api/v1/public/menus/11111111-1111-1111-1111-111111111111`,
      {
        method: 'OPTIONS',
        headers: { Origin: CUSTOM_ORIGIN, 'Access-Control-Request-Method': 'GET' },
        failOnStatusCode: false,
      });
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe(CUSTOM_ORIGIN);
    expect(headers['access-control-allow-methods']).toContain('GET');
  });
});
