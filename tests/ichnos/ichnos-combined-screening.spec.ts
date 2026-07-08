// @api tier for M1-2 POST /v1/screenings/combined (entity + declared wallets in ONE artifact — the
// differentiator). Unauthenticated negative always runs. The authed path runs opportunistically with an
// ichnos tenant token: it asserts the request is authorized (not 401) and — because combined screening
// surfaces partiality in the BODY, never a 503 — that `entityEngineAvailable` is a boolean and `wallets`
// is a non-empty array. Robust to the AMLService key not being wired: the entity portion may be
// unavailable (entityEngineAvailable=false), but the wallet results are always returned.
import { expect, test } from '@playwright/test';
import { ICHNOS_API_URL, getIchnosToken, tryRequest } from './ichnos-helpers.js';

const COMBINED_PATH = '/v1/screenings/combined';
const COMBINED = {
  entity: { name: 'Jane Doe', dateOfBirth: '1980-01-01', nationality: 'CY' },
  wallets: [{ chain: 'BTC', address: 'bc1qe2etestclearaddressxxxxxxxxxxxxxxxxxx' }],
  context: 'e2e-combined',
};

test.describe('Ichnos screen-combined @ichnos-api', () => {
  test('rejects an unauthenticated combined screening', async ({ request }) => {
    const result = await tryRequest(request, COMBINED_PATH, {
      method: 'POST',
      data: COMBINED,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('authorizes a tenant and returns wallet results plus an explicit entity-availability flag', async ({
    request,
  }) => {
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

    const result = await tryRequest(request, COMBINED_PATH, {
      method: 'POST',
      data: COMBINED,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(result).not.toBeNull();

    const status = result!.response.status();
    // Authorized (never 401). Completed (200) or out-of-credits (402) — combined never 503s.
    expect([200, 402], `unexpected status; body=${await result!.response.text()}`).toContain(status);
    if (status !== 200) return;

    const body = (await result!.response.json()) as {
      riskTier: string;
      entityEngineAvailable: boolean;
      wallets: unknown[];
      engineVersion: string;
    };

    expect(['direct', 'clear']).toContain(body.riskTier);
    expect(typeof body.entityEngineAvailable).toBe('boolean');
    expect(Array.isArray(body.wallets)).toBe(true);
    expect(body.wallets.length).toBeGreaterThan(0);
    expect(body.engineVersion).toBeTruthy();
  });
});
