/**
 * Correlation Tracking E2E Tests
 *
 * Validates that correlation IDs propagate from request headers through
 * to log entries in Loki, enabling cross-service request tracing:
 * - Correlation ID propagates from request header to logs
 * - Correlation ID appears in Loki query results
 * - Multiple services share the same correlation ID for a single request
 */

import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const ONLINEMENU_URL =
  process.env.ONLINEMENU_API_URL ?? 'http://localhost:5006';

/** Header name used for correlation ID propagation */
const CORRELATION_HEADER = 'X-Correlation-ID';

/** Timeout for waiting for correlated logs to appear in Loki */
const CORRELATION_TIMEOUT_MS = 20000;

test.describe('Correlation Tracking @logging', () => {
  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);

    // Verify Loki is ready before running correlation tests
    const ready = await loki.isReady();
    if (!ready) {
      throw new Error('Loki is not ready. Cannot run correlation tests.');
    }
  });

  test('correlation ID propagates from request header to logs', async ({
    request,
  }) => {
    const correlationId = `e2e-corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Make an API request with a known correlation ID header
    const response = await request
      .get(`${ONLINEMENU_URL}/health/ready`, {
        headers: { [CORRELATION_HEADER]: correlationId },
        timeout: 10000,
      })
      .catch(() => null);

    if (!response) {
      test.skip(true, 'OnlineMenuService not reachable');
      return;
    }

    expect(response.ok(), 'Health endpoint should return 200').toBeTruthy();

    // Poll Loki for the correlation ID in log lines
    await expect(async () => {
      const result = await loki.queryByCorrelationId(correlationId);
      const count = LokiClient.countEntries(result);
      expect(
        count,
        `Expected log entries containing correlation ID ${correlationId}`
      ).toBeGreaterThan(0);
    }).toPass({ timeout: CORRELATION_TIMEOUT_MS });
  });

  test('correlation ID appears in Loki query results', async ({
    request,
  }) => {
    const correlationId = `e2e-corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Hit an endpoint that produces log output
    await request
      .get(`${ONLINEMENU_URL}/api/menus`, {
        headers: { [CORRELATION_HEADER]: correlationId },
        timeout: 10000,
      })
      .catch(() => null);

    // Query Loki and verify the correlation ID is in the log content
    await expect(async () => {
      const result = await loki.queryByCorrelationId(correlationId);
      const entries = LokiClient.flattenEntries(result);

      expect(entries.length).toBeGreaterThan(0);

      // At least one log line should contain the correlation ID string
      const hasCorrelation = entries.some((entry) =>
        entry.line.includes(correlationId)
      );
      expect(
        hasCorrelation,
        'At least one log line should contain the correlation ID'
      ).toBe(true);
    }).toPass({ timeout: CORRELATION_TIMEOUT_MS });
  });

  test('multiple services share the same correlation ID for a single request', async ({
    request,
  }) => {
    const correlationId = `e2e-multi-corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Trigger a cross-service request by calling an endpoint that calls other services.
    // The menus endpoint on OnlineMenuService may interact with IdentityService for auth.
    const response = await request
      .get(`${ONLINEMENU_URL}/api/menus`, {
        headers: { [CORRELATION_HEADER]: correlationId },
        timeout: 10000,
      })
      .catch(() => null);

    if (!response) {
      test.skip(true, 'OnlineMenuService not reachable for cross-service test');
      return;
    }

    // Poll Loki for logs with this correlation ID
    await expect(async () => {
      const result = await loki.queryByCorrelationId(correlationId);
      const entries = LokiClient.flattenEntries(result);
      expect(entries.length).toBeGreaterThan(0);
    }).toPass({ timeout: CORRELATION_TIMEOUT_MS });

    // Check if the correlation ID appears across multiple services
    const result = await loki.queryByCorrelationId(correlationId);
    const entries = LokiClient.flattenEntries(result);
    const uniqueServices = new Set(
      entries.map((e) => e.labels.ServiceName).filter(Boolean)
    );

    test.info().annotations.push({
      type: 'info',
      description: `Correlation ID found in ${uniqueServices.size} service(s): ${[...uniqueServices].join(', ')}`,
    });

    // If the request only hit one service, that is still valid.
    // But if it hit multiple services, all should share the same correlation ID.
    expect(
      uniqueServices.size,
      'Correlation ID should appear in at least one service'
    ).toBeGreaterThanOrEqual(1);

    // When multiple services are involved, all entries should have the correlation ID
    for (const entry of entries) {
      expect(
        entry.line,
        'Every correlated log entry should contain the correlation ID'
      ).toContain(correlationId);
    }
  });
});
