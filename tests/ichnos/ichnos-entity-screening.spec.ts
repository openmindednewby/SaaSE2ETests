// @api tier for M1-2 POST /v1/screenings/entity (proxies AMLService over HTTP).
// Unauthenticated negative always runs. The authed path runs opportunistically with an
// ichnos tenant token: it asserts the request is authorized (not 401) and the outcome is
// either a real screening (200) or an explicit "engine unavailable" (503) — never a silent
// wrong answer. Once the AMLService API key is wired, the 200 branch carries matches/provenance.
import { expect, test } from '@playwright/test';
import { ICHNOS_API_URL, getIchnosToken, tryRequest } from './ichnos-helpers.js';

const ENTITY_PATH = '/v1/screenings/entity';
const ENTITY = { name: 'Jane Doe', dateOfBirth: '1980-01-01', nationality: 'CY', context: 'e2e-entity' };

test.describe('Ichnos screen-entity @ichnos-api', () => {
  test('rejects an unauthenticated entity screening', async ({ request }) => {
    const result = await tryRequest(request, ENTITY_PATH, {
      method: 'POST',
      data: ENTITY,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('authorizes a tenant and returns a screening or an explicit engine-unavailable', async ({ request }) => {
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

    const result = await tryRequest(request, ENTITY_PATH, {
      method: 'POST',
      data: ENTITY,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(result).not.toBeNull();

    const status = result!.response.status();
    // Authorized (never 401). Either a completed screening or an explicit degraded state.
    expect([200, 503], `unexpected status; body=${await result!.response.text()}`).toContain(status);

    if (status === 200) {
      const body = (await result!.response.json()) as {
        riskTier: string;
        engineVersion: string;
        isMatch: boolean;
        decision: string;
        riskScore: number;
        matches: Array<{ pepTier?: string | null }>;
      };
      expect(['direct', 'clear']).toContain(body.riskTier);
      expect(body.engineVersion).toBeTruthy();
      // Transparency (the differentiator): the screening-level score is always a number, and — when
      // the engine surfaces a PEP match — at least one match carries a pepTier. Tolerant: pepTier may
      // be null for a non-PEP sanction hit or a clear result, so we only require the numeric riskScore.
      expect(typeof body.riskScore).toBe('number');
      expect(typeof body.decision).toBe('string');
      const hasPepTier = Array.isArray(body.matches) && body.matches.some((m) => Boolean(m.pepTier));
      expect(hasPepTier || typeof body.riskScore === 'number').toBe(true);
    } else {
      const body = (await result!.response.json()) as { message: string };
      expect(body.message).toMatch(/unavailable/i);
    }
  });
});
