/**
 * Logging Throughput Stress Tests (Direct Loki Push API)
 *
 * Tests that push log entries directly to Loki via the push API:
 * - Push 1000 log entries rapidly, verify all are queryable within 30s
 * - Measure ingestion latency (time from push to queryable)
 *
 * All tests use 120s timeout to account for high volume.
 */

import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';

/** How long to wait for bulk logs to appear in Loki */
const BULK_INGESTION_TIMEOUT_MS = 30000;

/** Stress test timeout */
const STRESS_TIMEOUT_MS = 120000;

test.describe('Logging Throughput Stress Tests @logging @stress', () => {
  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);

    const ready = await loki.isReady();
    if (!ready) {
      throw new Error('Loki is not ready. Cannot run throughput tests.');
    }
  });

  test('should push 1000 log entries via Loki push API and verify all are queryable', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const entryCount = 1000;
    const testRunId = `stress-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now() * 1000000; // nanosecond timestamps

    // Build streams: push in batches of 100 entries per stream
    const batchSize = 100;
    const streams: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>;
    }> = [];

    for (let batch = 0; batch < entryCount / batchSize; batch++) {
      const values: Array<[string, string]> = [];
      for (let i = 0; i < batchSize; i++) {
        const entryIndex = batch * batchSize + i;
        const ts = (baseTimestamp + entryIndex * 1000).toString();
        values.push([
          ts,
          JSON.stringify({
            message: `Stress test entry ${entryIndex}/${entryCount}`,
            testRunId,
            index: entryIndex,
          }),
        ]);
      }
      streams.push({
        stream: {
          ServiceName: 'E2EStressTest',
          Level: 'Information',
          testRunId,
        },
        values,
      });
    }

    // Push all streams to Loki
    const pushStart = performance.now();
    await loki.push(streams);
    const pushDuration = performance.now() - pushStart;

    test.info().annotations.push({
      type: 'performance',
      description: `Push ${entryCount} entries: ${pushDuration.toFixed(0)}ms`,
    });

    // Verify all entries are queryable within 30 seconds
    const result = await loki.waitForLogs(
      `{testRunId="${testRunId}"}`,
      { timeout: BULK_INGESTION_TIMEOUT_MS, minCount: entryCount }
    );

    const totalFound = LokiClient.countEntries(result);
    expect(
      totalFound,
      `Expected all ${entryCount} entries to be queryable`
    ).toBeGreaterThanOrEqual(entryCount);

    test.info().annotations.push({
      type: 'info',
      description: `Verified ${totalFound}/${entryCount} entries are queryable`,
    });
  });

  test('should measure ingestion latency (time from push to queryable)', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const testRunId = `latency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = (Date.now() * 1000000).toString();

    const pushTime = performance.now();

    await loki.push([
      {
        stream: {
          ServiceName: 'E2ELatencyTest',
          Level: 'Information',
          testRunId,
        },
        values: [
          [
            ts,
            JSON.stringify({
              message: 'Latency measurement entry',
              testRunId,
            }),
          ],
        ],
      },
    ]);

    // Poll until the entry appears
    await loki.waitForLogs(`{testRunId="${testRunId}"}`, {
      timeout: BULK_INGESTION_TIMEOUT_MS,
      interval: 200,
      minCount: 1,
    });

    const ingestionLatency = performance.now() - pushTime;

    test.info().annotations.push({
      type: 'performance',
      description: `Ingestion latency (push to queryable): ${ingestionLatency.toFixed(0)}ms`,
    });

    // Ingestion latency should be under 30 seconds (generous for CI)
    expect(
      ingestionLatency,
      `Ingestion latency should be under ${BULK_INGESTION_TIMEOUT_MS}ms`
    ).toBeLessThan(BULK_INGESTION_TIMEOUT_MS);
  });
});
