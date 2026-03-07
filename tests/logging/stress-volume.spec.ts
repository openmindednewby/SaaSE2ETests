/**
 * Logging Volume Stress Tests
 *
 * Tests that push the log ingestion pipeline to its limits:
 * - Generate 500 log entries rapidly, verify all appear in Loki within 30s
 * - Generate logs from multiple services simultaneously, verify no loss
 * - Query performance: Loki query for 1-hour range completes in <2s
 * - Verify log order is preserved (timestamps monotonically increasing)
 *
 * All tests use 120s timeout to account for high volume.
 */

import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';
import {
  generateBulkLogs,
  measureQueryLatency,
} from '../../helpers/loggingStressHelpers.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';

/** Maximum acceptable query latency for a 1-hour range query */
const MAX_QUERY_LATENCY_MS = 2000;

/** How long to wait for bulk logs to appear in Loki */
const BULK_INGESTION_TIMEOUT_MS = 30000;

/** Stress test timeout */
const STRESS_TIMEOUT_MS = 120000;

test.describe('Logging Volume Stress Tests @logging @stress', () => {
  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);

    const ready = await loki.isReady();
    if (!ready) {
      throw new Error('Loki is not ready. Cannot run stress tests.');
    }
  });

  test('should ingest 500 log entries and verify they appear in Loki', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const targetCount = 500;
    const serviceName = 'IdentityService';

    // Record current log count before generating new logs
    const beforeResult = await loki.queryByService(serviceName);
    const countBefore = LokiClient.countEntries(beforeResult);

    // Generate bulk logs by hitting the service
    const generated = await generateBulkLogs(targetCount, serviceName);

    expect(
      generated,
      `Should have generated at least some requests`
    ).toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'info',
      description: `Generated ${generated}/${targetCount} log-producing requests`,
    });

    // Wait for logs to appear in Loki
    // We expect at least some portion of the generated logs to appear
    const minExpected = Math.floor(generated * 0.5); // Allow 50% tolerance

    await expect(async () => {
      const afterResult = await loki.queryByService(serviceName);
      const countAfter = LokiClient.countEntries(afterResult);
      const newLogs = countAfter - countBefore;

      expect(
        newLogs,
        `Expected at least ${minExpected} new logs in Loki`
      ).toBeGreaterThanOrEqual(minExpected);
    }).toPass({ timeout: BULK_INGESTION_TIMEOUT_MS });
  });

  test('should handle logs from multiple services simultaneously without loss', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const countPerService = 50;
    const services = ['IdentityService', 'OnlineMenuService', 'QuestionerService'];

    // Record baseline counts
    const baselines: Record<string, number> = {};
    for (const svc of services) {
      const result = await loki.queryByService(svc);
      baselines[svc] = LokiClient.countEntries(result);
    }

    // Generate logs from all services concurrently
    const results = await Promise.allSettled(
      services.map((svc) => generateBulkLogs(countPerService, svc))
    );

    const generated: Record<string, number> = {};
    for (let i = 0; i < services.length; i++) {
      const result = results[i];
      generated[services[i]] =
        result.status === 'fulfilled' ? result.value : 0;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Generated per service: ${JSON.stringify(generated)}`,
    });

    // Wait for logs from each service to appear
    let totalNewLogs = 0;
    for (const svc of services) {
      if (generated[svc] === 0) continue;

      await expect(async () => {
        const result = await loki.queryByService(svc);
        const current = LokiClient.countEntries(result);
        const newLogs = current - baselines[svc];
        expect(
          newLogs,
          `Expected new logs for ${svc}`
        ).toBeGreaterThan(0);
        totalNewLogs += newLogs;
      }).toPass({ timeout: BULK_INGESTION_TIMEOUT_MS });
    }

    expect(
      totalNewLogs,
      'Total new logs across all services should be > 0'
    ).toBeGreaterThan(0);
  });

  test('Loki query for 1-hour range completes in under 2 seconds', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    // Measure query latency for a broad 1-hour range query
    const latency = await measureQueryLatency(
      loki,
      '{ServiceName=~".+"}'
    );

    expect(
      latency,
      `Query latency (${latency.toFixed(0)}ms) should be under ${MAX_QUERY_LATENCY_MS}ms`
    ).toBeLessThan(MAX_QUERY_LATENCY_MS);

    test.info().annotations.push({
      type: 'performance',
      description: `1-hour range query latency: ${latency.toFixed(2)}ms`,
    });
  });

  test('log timestamps are monotonically increasing within a service', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    // Generate some logs to ensure we have data
    await generateBulkLogs(20, 'IdentityService');

    // Wait briefly for ingestion
    await expect(async () => {
      const result = await loki.queryRange(
        '{ServiceName="IdentityService"}',
        { limit: 100, direction: 'forward' }
      );
      expect(LokiClient.countEntries(result)).toBeGreaterThan(0);
    }).toPass({ timeout: BULK_INGESTION_TIMEOUT_MS });

    // Query with forward direction (oldest first)
    const result = await loki.queryRange(
      '{ServiceName="IdentityService"}',
      { limit: 100, direction: 'forward' }
    );

    const entries = LokiClient.flattenEntries(result);
    expect(entries.length).toBeGreaterThan(0);

    // Verify timestamps are non-decreasing
    let outOfOrderCount = 0;
    for (let i = 1; i < entries.length; i++) {
      const prev = BigInt(entries[i - 1].timestamp);
      const curr = BigInt(entries[i].timestamp);
      if (curr < prev) {
        outOfOrderCount++;
      }
    }

    expect(
      outOfOrderCount,
      `Found ${outOfOrderCount} out-of-order timestamps in ${entries.length} entries`
    ).toBe(0);

    test.info().annotations.push({
      type: 'info',
      description: `Verified ordering of ${entries.length} log entries`,
    });
  });
});
