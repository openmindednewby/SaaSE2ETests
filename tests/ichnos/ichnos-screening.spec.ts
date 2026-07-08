// @api tier for M1-1 POST /v1/screenings/address (two-tier E2E: seconds, no browser).
// The unauthenticated negative assertion always runs. The authed positive path runs
// opportunistically when an ichnos-realm token can be acquired (staging/prod runners with
// TEST_USER_* + the client secret); otherwise it skips with a clear reason. The @ui tier
// (portal screen flow) lands with M1-4.
import { expect, test } from '@playwright/test';
import { ICHNOS_API_URL, getIchnosToken, tryRequest } from './ichnos-helpers.js';

const SCREEN_PATH = '/v1/screenings/address';

// A well-formed but plainly non-sanctioned address — a screening of it must come back "clear".
const CLEAR_ADDRESS = { chain: 'BTC', address: 'bc1qe2etestclearaddressxxxxxxxxxxxxxxxxxx' };

test.describe('Ichnos screen-address @ichnos-api', () => {
  test('rejects an unauthenticated screening request', async ({ request }) => {
    const result = await tryRequest(request, SCREEN_PATH, {
      method: 'POST',
      data: CLEAR_ADDRESS,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('screens a clear address and returns provenance + credit cost', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }

    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
      return;
    }

    const result = await tryRequest(request, SCREEN_PATH, {
      method: 'POST',
      data: { ...CLEAR_ADDRESS, context: 'e2e-clear' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(result, 'screening request should reach the service').not.toBeNull();
    expect(result!.response.status(), await result!.response.text()).toBe(200);

    const body = (await result!.response.json()) as {
      screeningId: string;
      riskTier: string;
      directMatch: boolean;
      matches: unknown[];
      creditCost: number;
      engineVersion: string;
      screenedAt: string;
      datasetVersions: unknown[];
    };

    expect(body.riskTier).toBe('clear');
    expect(body.directMatch).toBe(false);
    expect(body.matches).toEqual([]);
    expect(body.engineVersion).toBe('list-match-v1');
    expect(body.screeningId).toBeTruthy();
    expect(body.screenedAt).toBeTruthy();
    expect(typeof body.creditCost).toBe('number');
    expect(Array.isArray(body.datasetVersions)).toBe(true);
  });
});
