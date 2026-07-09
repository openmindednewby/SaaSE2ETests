// @api tier for M1-3 GET /v1/screenings/{id}/report?format=pdf|csv — the regulator-ready report.
// The report renders from the PERSISTED screening (never a re-screen) and is tenant-scoped.
//
// Unauthenticated negative always runs. The authed path runs opportunistically with an ichnos tenant
// token: it creates an entity screening, then downloads its CSV report and asserts 200 + text/csv + the
// screening id appears in the body (the immutable audit record). Tolerant: if the entity engine is
// unavailable (503, no id) or no token is configured, the authed assertions skip rather than false-fail.
import { expect, test } from '@playwright/test';
import { ICHNOS_API_URL, getIchnosToken, tryRequest } from './ichnos-helpers.js';

const ENTITY_PATH = '/v1/screenings/entity';
const ENTITY = { name: 'Jane Doe', dateOfBirth: '1980-01-01', nationality: 'CY', context: 'e2e-report' };
const reportPath = (id: string, format: string) => `/v1/screenings/${id}/report?format=${format}`;

test.describe('Ichnos screening report @ichnos-api', () => {
  test('rejects an unauthenticated report download', async ({ request }) => {
    const someId = '00000000-0000-0000-0000-000000000000';
    const result = await tryRequest(request, reportPath(someId, 'csv'));
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('returns a tenant-scoped CSV report for a persisted screening', async ({ request }) => {
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

    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // Create a screening to report on.
    const screened = await tryRequest(request, ENTITY_PATH, { method: 'POST', data: ENTITY, headers: authHeaders });
    expect(screened).not.toBeNull();
    const screenStatus = screened!.response.status();
    if (screenStatus === 503) {
      test.skip(true, 'Entity engine unavailable — no screening id to report on');
      return;
    }
    expect(screenStatus, `unexpected screen status; body=${await screened!.response.text()}`).toBe(200);

    const { screeningId } = (await screened!.response.json()) as { screeningId: string };
    expect(screeningId).toBeTruthy();

    // Download its CSV report.
    const report = await tryRequest(request, reportPath(screeningId, 'csv'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(report).not.toBeNull();
    expect(report!.response.status(), `report body=${await report!.response.text()}`).toBe(200);
    expect(report!.response.headers()['content-type']).toContain('text/csv');

    const body = await report!.response.text();
    // The immutable audit record carries the screening id (and the transparency header columns).
    expect(body).toContain(screeningId);
    expect(body).toContain('listSource');
    expect(body).toContain('contentDigest');
  });

  test('does not leak another tenant\'s screening (404 for an unknown id)', async ({ request }) => {
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token configured');
      return;
    }
    const unknownId = '11111111-2222-3333-4444-555555555555';
    const result = await tryRequest(request, reportPath(unknownId, 'csv'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect(result.response.status()).toBe(404);
  });
});
