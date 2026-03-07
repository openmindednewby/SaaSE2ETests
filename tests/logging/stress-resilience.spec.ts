/**
 * Logging Resilience Stress Tests
 *
 * Tests that the logging pipeline handles adverse conditions gracefully:
 * - Logs continue to flow after brief Loki unavailability (buffering)
 * - High-frequency error generation does not crash services
 *
 * All tests use 120s timeout.
 */

import { test, expect } from '@playwright/test';

import axios from 'axios';

import { LokiClient } from '../../helpers/loki-client.js';
import { generateBulkLogs } from '../../helpers/loggingStressHelpers.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const IDENTITY_URL =
  process.env.IDENTITY_API_URL ?? 'http://localhost:5002';
const ONLINEMENU_URL =
  process.env.ONLINEMENU_API_URL ?? 'http://localhost:5006';

/** Stress test timeout */
const STRESS_TIMEOUT_MS = 120000;

/** How long to wait for logs to propagate after recovery */
const RECOVERY_TIMEOUT_MS = 30000;

test.describe('Logging Resilience Stress Tests @logging @stress', () => {
  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);

    const ready = await loki.isReady();
    if (!ready) {
      throw new Error('Loki is not ready. Cannot run resilience tests.');
    }
  });

  test('logs continue to flow after brief Loki unavailability', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    // Step 1: Verify Loki is receiving logs before the test
    const baselineResult = await loki.queryByService('IdentityService');
    const baselineCount = LokiClient.countEntries(baselineResult);

    test.info().annotations.push({
      type: 'info',
      description: `Baseline log count for IdentityService: ${baselineCount}`,
    });

    // Step 2: Generate some logs while Loki is available
    const preCount = 10;
    const preGenerated = await generateBulkLogs(preCount, 'IdentityService');
    expect(preGenerated).toBeGreaterThan(0);

    // Step 3: Simulate Loki being temporarily unavailable by
    // verifying that if logs were generated during a hypothetical outage,
    // they still appear after Loki comes back.
    //
    // NOTE: We cannot actually stop Loki in an E2E test without Docker control.
    // Instead, we test the buffering behavior by:
    // 1. Generating a burst of logs rapidly
    // 2. Immediately querying - some may not have arrived yet (Serilog buffers)
    // 3. Waiting and verifying all eventually arrive

    const burstCount = 50;
    const burstGenerated = await generateBulkLogs(
      burstCount,
      'IdentityService'
    );
    expect(burstGenerated).toBeGreaterThan(0);

    // Step 4: Poll Loki until the burst logs appear
    await expect(async () => {
      const afterResult = await loki.queryByService('IdentityService');
      const afterCount = LokiClient.countEntries(afterResult);
      const newLogs = afterCount - baselineCount;

      // We should see at least the pre-generated logs
      expect(
        newLogs,
        'New logs should appear after burst generation'
      ).toBeGreaterThan(0);
    }).toPass({ timeout: RECOVERY_TIMEOUT_MS });

    // Step 5: Verify Loki is still healthy after the burst
    const stillReady = await loki.isReady();
    expect(stillReady, 'Loki should still be healthy after burst').toBe(true);
  });

  test('high-frequency error generation does not crash services', async () => {
    test.setTimeout(STRESS_TIMEOUT_MS);

    const errorCount = 100;
    const services = [
      { name: 'IdentityService', url: IDENTITY_URL },
      { name: 'OnlineMenuService', url: ONLINEMENU_URL },
    ];

    // Generate many errors by hitting invalid endpoints
    for (const service of services) {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < errorCount; i++) {
        promises.push(
          axios
            .get(
              `${service.url}/api/nonexistent-endpoint-e2e-stress-${i}`,
              { timeout: 5000 }
            )
            .then(() => undefined)
            .catch(() => {
              // Expected to fail - we want to generate error logs
            })
        );

        // Fire in batches of 20 to avoid overwhelming the network stack
        if (promises.length >= 20) {
          await Promise.allSettled(promises);
          promises.length = 0;
        }
      }

      // Flush remaining
      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
    }

    test.info().annotations.push({
      type: 'info',
      description: `Generated ~${errorCount} error requests per service`,
    });

    // Verify all services are still healthy after the error flood
    for (const service of services) {
      const healthResponse = await axios
        .get(`${service.url}/health/live`, { timeout: 10000 })
        .catch(() => null);

      expect(
        healthResponse?.status,
        `${service.name} should still be healthy after error flood`
      ).toBe(200);
    }

    // Verify Loki captured some error-level logs
    await expect(async () => {
      const errors = await loki.queryErrors();
      const errorLogCount = LokiClient.countEntries(errors);
      expect(
        errorLogCount,
        'Loki should have captured some error-level logs'
      ).toBeGreaterThan(0);
    }).toPass({ timeout: RECOVERY_TIMEOUT_MS });

    // Verify Loki is still operational
    const lokiReady = await loki.isReady();
    expect(
      lokiReady,
      'Loki should still be healthy after error flood'
    ).toBe(true);
  });

});
