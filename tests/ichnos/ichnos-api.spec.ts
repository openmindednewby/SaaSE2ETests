// Health/smoke spec for ichnos-api (M0-9). Two-tier E2E: this is the @api tier
// (seconds, no browser). The @ui tier (real portal login) is added in M1 with the
// screening screens. Generated from the service scaffold, then the protected-endpoint
// probe was pointed at the real authed endpoint (/v1/datasets).
import { expect, test } from '@playwright/test';
import { ICHNOS_API_URL, tryRequest, waitForHealthy } from './ichnos-helpers.js';

test.describe('Ichnos Service Health Probes @ichnos-api @health', () => {
  const healthPaths = [
    { name: 'startup', path: '/health/start' },
    { name: 'liveness', path: '/health/live' },
    { name: 'readiness', path: '/health/ready' },
  ] as const;

  for (const probe of healthPaths) {
    test(`Service ${probe.name} probe should return healthy`, async ({ request }) => {
      const quickCheck = await tryRequest(request, probe.path);
      if (!quickCheck) {
        test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
        return;
      }
      const { response, url } = await waitForHealthy(request, probe.path, 10_000);
      expect(response.status(), `Expected 200 OK from ${url}`).toBe(200);
    });
  }
});

test.describe('Ichnos Service API @ichnos-api', () => {
  test('the datasets endpoint should require authentication', async ({ request }) => {
    // /v1/datasets is tenant-scoped behind the realm wall — an unauthenticated
    // request must be rejected. (The real dataset content is asserted post-deploy
    // once the OFAC ingestion has produced a snapshot — M0-8.)
    const result = await tryRequest(request, '/v1/datasets', { method: 'GET' });
    if (!result) {
      test.skip(true, 'Service not available');
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });
});
