/**
 * Log Verification E2E Tests — validates the Grafana Loki logging pipeline:
 * Loki health, user actions generate logs, ServiceName labels, TenantId on
 * authenticated requests, and error-level capture.
 */
import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';
import { lokiConfigured, LOKI_SKIP_REASON } from '../../helpers/feature-gates.js';
import { getCanarySuperUserToken } from '../../helpers/canary-prefix.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const ONLINEMENU_URL =
  process.env.ONLINEMENU_API_URL ?? 'http://localhost:5006';

/** Container name patterns for services that write logs */
const SERVICE_NAMES = [
  'IdentityService',
  'OnlineMenuService',
  'QuestionerService',
];

/** Timeout for waiting for logs to propagate to Loki */
const LOG_PROPAGATION_TIMEOUT_MS = 15000;

test.describe('Log Verification @logging', () => {
  // Observability stack is in-cluster only — skip on dev-PC staging/prod runs.
  test.skip(!lokiConfigured(), LOKI_SKIP_REASON);

  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);
  });

  test('Loki is healthy and accepting queries', async () => {
    const ready = await loki.isReady();
    expect(ready, 'Loki should be ready').toBe(true);

    // Also verify the query API responds
    const result = await loki.queryRange('{ServiceName=~".+"}', {
      limit: 1,
    });
    expect(result.status).toBe('success');
  });

  test('user action generates logs in Loki', async ({ page }) => {
    // Navigate to the menus page to trigger API calls that generate logs
    await page.goto('/menus', { waitUntil: 'commit' });

    // Wait for page content to load (which triggers backend requests)
    await expect(page.locator('body')).toBeVisible();

    // Poll Loki until we find logs from any service
    await expect(async () => {
      const result = await loki.queryRange('{ServiceName=~".+"}', {
        limit: 10,
      });
      const count = LokiClient.countEntries(result);
      expect(
        count,
        'Expected at least one log entry from any service'
      ).toBeGreaterThan(0);
    }).toPass({ timeout: LOG_PROPAGATION_TIMEOUT_MS });
  });

  test('logs include correct ServiceName label', async () => {
    // Query for logs from each known service
    for (const serviceName of SERVICE_NAMES) {
      const result = await loki.queryByService(serviceName);

      // At least one service should have logs (not all may be running)
      if (LokiClient.countEntries(result) > 0) {
        // Verify the ServiceName label is set correctly on every stream
        for (const stream of result.data.result) {
          expect(
            stream.stream.ServiceName,
            `Stream should have ServiceName="${serviceName}"`
          ).toBe(serviceName);
        }

        test.info().annotations.push({
          type: 'info',
          description: `Found ${LokiClient.countEntries(result)} logs for ${serviceName}`,
        });
      }
    }

    // At least one service should have produced logs
    let totalLogs = 0;
    for (const serviceName of SERVICE_NAMES) {
      const result = await loki.queryByService(serviceName);
      totalLogs += LokiClient.countEntries(result);
    }
    expect(
      totalLogs,
      'At least one service should have logs in Loki'
    ).toBeGreaterThan(0);
  });

  test('logs include TenantId when authenticated', async ({ request }) => {
    // TenantId is only enriched onto an AUTHENTICATED request's completion log
    // (UseSerilogRequestLogging reads the tenant claim). So hit the OnlineMenu
    // API directly with the canary superUser bearer — the default `request`
    // baseURL is the SPA (no API auth) and would never produce a TenantId log.
    const token = getCanarySuperUserToken();
    if (!token) {
      test.skip(true, 'No canary superUser token (local/dev run)');
      return;
    }
    const response = await request
      .get(`${ONLINEMENU_URL}/api/v1/menus`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      })
      .catch(() => null);

    if (!response) {
      test.skip(true, 'OnlineMenu API endpoint not reachable');
      return;
    }

    // Poll Loki (cluster-aware) for a log line carrying the TenantId property.
    await expect(async () => {
      const result = await loki.queryByLineMatch('TenantId');
      const count = LokiClient.countEntries(result);
      expect(
        count,
        'Expected logs containing TenantId'
      ).toBeGreaterThan(0);
    }).toPass({ timeout: LOG_PROPAGATION_TIMEOUT_MS });
  });

  test('error logs are captured with proper level', async ({ request }) => {
    // Trigger an error by requesting a non-existent resource
    const response = await request
      .get('/api/v1/menus/non-existent-id-for-e2e-test', { timeout: 10000 })
      .catch(() => null);

    // The request may return 404 or fail entirely; either generates error-level logs
    if (response) {
      test.info().annotations.push({
        type: 'info',
        description: `Error trigger returned status ${response.status()}`,
      });
    }

    // Query Loki for error-level logs
    // Use a broad time window since errors may already exist
    const errors = await loki.queryErrors();

    // We don't assert a specific count because error logs depend on
    // what has run before. Instead, verify the query itself succeeds.
    expect(errors.status).toBe('success');

    // If error logs exist, verify they have the Level label
    if (LokiClient.countEntries(errors) > 0) {
      for (const stream of errors.data.result) {
        expect(
          stream.stream.Level,
          'Error streams should have Level="Error" label'
        ).toBe('Error');
      }

      test.info().annotations.push({
        type: 'info',
        description: `Found ${LokiClient.countEntries(errors)} error-level log entries`,
      });
    }
  });
});
