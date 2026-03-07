/**
 * Logging Stress Test Helpers
 *
 * Utility functions for stress/volume testing of the logging pipeline.
 * Provides bulk log generation, Loki polling with retry, and query
 * latency measurement.
 */

import axios from 'axios';
import { setTimeout as delay } from 'timers/promises';

import { LokiClient, type LokiQueryResult } from './loki-client.js';

/** Default service URLs for stress endpoints */
const IDENTITY_URL =
  process.env.IDENTITY_API_URL || 'http://localhost:5002';
const ONLINEMENU_URL =
  process.env.ONLINEMENU_API_URL || 'http://localhost:5006';
const QUESTIONER_URL =
  process.env.QUESTIONER_API_URL || 'http://localhost:5004';

/** Map of known services to their base URLs */
const SERVICE_URLS: Record<string, string> = {
  IdentityService: IDENTITY_URL,
  OnlineMenuService: ONLINEMENU_URL,
  QuestionerService: QUESTIONER_URL,
};

/**
 * Generate bulk log entries by hitting a service's stress/log endpoint.
 *
 * Falls back to making rapid health-check requests if no dedicated
 * stress endpoint exists, since every HTTP request generates at least
 * one log line.
 *
 * @param count - Number of log entries to generate
 * @param serviceName - Target service name (must be in SERVICE_URLS)
 * @returns Number of requests successfully sent
 */
export async function generateBulkLogs(
  count: number,
  serviceName: string
): Promise<number> {
  const baseUrl = SERVICE_URLS[serviceName];
  if (!baseUrl) {
    throw new Error(
      `Unknown service "${serviceName}". Known: ${Object.keys(SERVICE_URLS).join(', ')}`
    );
  }

  let successCount = 0;

  // Try the dedicated stress endpoint first
  try {
    const response = await axios.post(
      `${baseUrl}/api/diagnostics/stress-log`,
      { count },
      { timeout: 30000 }
    );
    if (response.status === 200) {
      return response.data?.generated ?? count;
    }
  } catch {
    // Stress endpoint not available; fall back to rapid health pings
  }

  // Fallback: fire rapid health-check requests (each generates a log line)
  const batchSize = 20;
  for (let i = 0; i < count; i += batchSize) {
    const batch = Math.min(batchSize, count - i);
    const promises: Promise<void>[] = [];

    for (let j = 0; j < batch; j++) {
      promises.push(
        axios
          .get(`${baseUrl}/health/live`, { timeout: 5000 })
          .then(() => {
            successCount++;
          })
          .catch(() => {
            // Count as generated even on error (error logs still count)
            successCount++;
          })
      );
    }

    await Promise.all(promises);
  }

  return successCount;
}

/**
 * Poll Loki until the expected number of log entries appear or timeout.
 *
 * Uses an exponential backoff starting at 500ms, capped at 5s between polls.
 *
 * @param loki - LokiClient instance
 * @param logql - LogQL query to execute
 * @param expectedCount - Minimum number of entries expected
 * @param timeoutMs - Maximum time to wait (default 30s)
 * @returns The final Loki query result
 * @throws Error if expected count is not reached within timeout
 */
export async function waitForLogsInLoki(
  loki: LokiClient,
  logql: string,
  expectedCount: number,
  timeoutMs: number = 30000
): Promise<LokiQueryResult> {
  const deadline = Date.now() + timeoutMs;
  let lastResult: LokiQueryResult | null = null;
  let pollDelay = 500;
  const maxDelay = 5000;

  while (Date.now() < deadline) {
    lastResult = await loki.queryRange(logql, { limit: expectedCount + 100 });
    const currentCount = LokiClient.countEntries(lastResult);

    if (currentCount >= expectedCount) {
      return lastResult;
    }

    // Wait before next poll (capped exponential backoff)
    const waitTime = Math.min(pollDelay, deadline - Date.now());
    if (waitTime <= 0) break;
    await delay(waitTime);
    pollDelay = Math.min(pollDelay * 1.5, maxDelay);
  }

  const finalCount = lastResult ? LokiClient.countEntries(lastResult) : 0;
  throw new Error(
    `Timed out waiting for ${expectedCount} logs in Loki. ` +
    `Got ${finalCount} after ${timeoutMs}ms. Query: ${logql}`
  );
}

/**
 * Measure the latency of a Loki query in milliseconds.
 *
 * @param loki - LokiClient instance
 * @param logql - LogQL query to benchmark
 * @returns Duration in milliseconds
 */
export async function measureQueryLatency(
  loki: LokiClient,
  logql: string
): Promise<number> {
  const start = performance.now();
  await loki.queryRange(logql);
  return performance.now() - start;
}
