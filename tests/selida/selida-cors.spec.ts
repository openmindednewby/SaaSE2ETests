// Selida @api — the browser path: the site calls the API cross-origin.
//
// The upload form lives on SELIDA_SITE_BASE and the API on SELIDA_API_BASE, so every browser
// POST and DELETE is preceded by a CORS preflight. A hand-built API request (which is what every
// other spec in this folder sends) never triggers one, so without this file a missing origin in
// `Cors:AllowedOrigins` would pass the whole suite and break every real upload.
//
// Contract: Program.cs:142-153 (policy `AllowedOrigins`: WithOrigins(config) + AllowAnyHeader +
// AllowAnyMethod, no credentials) · Program.cs:247 (UseCors) · appsettings.Production.json:2-6.
// No uploads: a preflight is answered by the CORS middleware and never reaches the endpoint.
import { expect, test } from '@playwright/test';

import {
  SELIDA_ROUTES,
  SELIDA_SITE_BASE,
  UNGENERATABLE_SLUG,
  anonymousApi,
  describeResponse,
} from './selida-helpers.js';

import type { APIRequestContext, APIResponse } from '@playwright/test';

const PREFLIGHT_OK = 204;
const SITE_ORIGIN = new URL(SELIDA_SITE_BASE).origin;
const FOREIGN_ORIGIN = 'https://selida-e2e-not-allowed.example';

/** Splits a comma-separated CORS list header into lowercase tokens. */
function tokens(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

test.describe('Selida CORS for the site origin @selida-api @selida', () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await anonymousApi();
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  async function preflight(url: string, origin: string, method: string, headers?: string): Promise<APIResponse> {
    return api.fetch(url, {
      method: 'OPTIONS',
      maxRedirects: 0,
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        ...(headers ? { 'Access-Control-Request-Headers': headers } : {}),
      },
    });
  }

  test('the upload preflight (POST /api/v1/pages) allows the site origin', async () => {
    const response = await preflight(SELIDA_ROUTES.pages, SITE_ORIGIN, 'POST');
    expect(response.status(), await describeResponse(response)).toBe(PREFLIGHT_OK);
    expect(response.headers()['access-control-allow-origin']).toBe(SITE_ORIGIN);
    expect(tokens(response.headers()['access-control-allow-methods'])).toContain('post');
  });

  test('the delete preflight allows DELETE with the x-claim-token header', async () => {
    const response = await preflight(SELIDA_ROUTES.page(UNGENERATABLE_SLUG), SITE_ORIGIN, 'DELETE', 'x-claim-token');
    expect(response.status(), await describeResponse(response)).toBe(PREFLIGHT_OK);
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
    expect(tokens(headers['access-control-allow-methods'])).toContain('delete');
    // AllowAnyHeader echoes the requested list; `*` would also admit it.
    const allowed = tokens(headers['access-control-allow-headers']);
    expect(allowed.includes('x-claim-token') || allowed.includes('*'), `allow-headers: ${allowed.join(',')}`).toBe(true);
  });

  test('a foreign origin gets no access-control-allow-origin', async () => {
    const response = await preflight(SELIDA_ROUTES.pages, FOREIGN_ORIGIN, 'POST');
    const acao = response.headers()['access-control-allow-origin'];
    expect(acao === FOREIGN_ORIGIN || acao === '*', `ACAO for a foreign origin: ${acao}`).toBe(false);
  });
});
