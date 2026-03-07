/**
 * Logging Push Resilience Stress Tests (Direct Loki Push API)
 *
 * Tests that Loki handles adverse push conditions gracefully:
 * - Push large batch (500 entries at once)
 * - Push entries with large payloads (1KB messages)
 * - Verify no data loss after rapid sequential pushes
 * - Verify Loki remains healthy after stress
 *
 * All tests use 120s timeout.
 */

import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';

/** Stress test timeout */
const STRESS_TIMEOUT_MS = 120000;

/** How long to wait for logs to propagate */
const INGESTION_TIMEOUT_MS = 30000;

test.describe('Logging Push Resilience Stress Tests @logging @stress', () => {
  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);

    const ready = await loki.isReady();
    if (!ready) {
      throw new Error(
        'Loki is not ready. Cannot run push resilience tests.'
      );
    }
  });

  test('should push large batch (500 entries at once) via Loki push API', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const batchSize = 500;
    const testRunId = `resilience-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now() * 1000000;

    // Build a single stream with 500 entries
    const values: Array<[string, string]> = [];
    for (let i = 0; i < batchSize; i++) {
      values.push([
        (baseTimestamp + i * 1000).toString(),
        JSON.stringify({
          message: `Batch entry ${i}/${batchSize}`,
          testRunId,
          index: i,
        }),
      ]);
    }

    await loki.push([
      {
        stream: {
          ServiceName: 'E2EResilienceTest',
          Level: 'Information',
          testRunId,
        },
        values,
      },
    ]);

    // Verify all entries are queryable
    const result = await loki.waitForLogs(
      `{testRunId="${testRunId}"}`,
      { timeout: INGESTION_TIMEOUT_MS, minCount: batchSize }
    );

    const totalFound = LokiClient.countEntries(result);
    expect(
      totalFound,
      `Expected all ${batchSize} batch entries to be queryable`
    ).toBeGreaterThanOrEqual(batchSize);

    test.info().annotations.push({
      type: 'info',
      description: `Large batch: ${totalFound}/${batchSize} entries verified`,
    });
  });

  test('should push entries with large payloads (1KB messages)', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const entryCount = 50;
    const testRunId = `resilience-large-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now() * 1000000;

    // Generate a ~1KB payload string
    const padding = 'A'.repeat(900); // ~900 bytes of padding

    const values: Array<[string, string]> = [];
    for (let i = 0; i < entryCount; i++) {
      values.push([
        (baseTimestamp + i * 1000).toString(),
        JSON.stringify({
          message: `Large payload entry ${i}`,
          testRunId,
          payload: padding,
          index: i,
        }),
      ]);
    }

    await loki.push([
      {
        stream: {
          ServiceName: 'E2ELargePayloadTest',
          Level: 'Information',
          testRunId,
        },
        values,
      },
    ]);

    // Verify entries are queryable and payload is intact
    const result = await loki.waitForLogs(
      `{testRunId="${testRunId}"}`,
      { timeout: INGESTION_TIMEOUT_MS, minCount: entryCount }
    );

    const totalFound = LokiClient.countEntries(result);
    expect(
      totalFound,
      `Expected all ${entryCount} large-payload entries`
    ).toBeGreaterThanOrEqual(entryCount);

    // Verify payload content is preserved
    const entries = LokiClient.flattenEntries(result);
    const firstEntry = entries[0];
    expect(firstEntry.line).toContain(padding.slice(0, 50));

    test.info().annotations.push({
      type: 'info',
      description: `Large payload: ${totalFound}/${entryCount} entries with ~1KB payloads verified`,
    });
  });

  test('should verify no data loss after rapid sequential pushes', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const pushCount = 20;
    const entriesPerPush = 25;
    const totalExpected = pushCount * entriesPerPush;
    const testRunId = `resilience-seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now() * 1000000;

    // Push entries sequentially in rapid succession (no delay)
    for (let push = 0; push < pushCount; push++) {
      const values: Array<[string, string]> = [];
      for (let i = 0; i < entriesPerPush; i++) {
        const globalIndex = push * entriesPerPush + i;
        values.push([
          (baseTimestamp + globalIndex * 1000).toString(),
          JSON.stringify({
            message: `Sequential push ${push} entry ${i}`,
            testRunId,
            pushIndex: push,
            entryIndex: i,
            globalIndex,
          }),
        ]);
      }

      await loki.push([
        {
          stream: {
            ServiceName: 'E2ESequentialPushTest',
            Level: 'Information',
            testRunId,
          },
          values,
        },
      ]);
    }

    // Verify all entries from all pushes are queryable
    const result = await loki.waitForLogs(
      `{testRunId="${testRunId}"}`,
      { timeout: INGESTION_TIMEOUT_MS, minCount: totalExpected }
    );

    const totalFound = LokiClient.countEntries(result);
    expect(
      totalFound,
      `Expected all ${totalExpected} entries from ${pushCount} pushes`
    ).toBeGreaterThanOrEqual(totalExpected);

    test.info().annotations.push({
      type: 'info',
      description: `Sequential: ${totalFound}/${totalExpected} from ${pushCount} pushes verified`,
    });
  });

  test('Loki remains healthy after push stress tests', async () => {
    const ready = await loki.isReady();
    expect(
      ready,
      'Loki should still be healthy after all push resilience tests'
    ).toBe(true);

    // Verify query API still works
    const result = await loki.queryRange('{ServiceName=~".+"}', {
      limit: 1,
    });
    expect(result.status).toBe('success');
  });
});
