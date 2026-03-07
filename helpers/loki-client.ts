/**
 * Loki HTTP Client for E2E Tests
 *
 * Provides utility functions for querying Grafana Loki's HTTP API
 * during E2E tests. Uses LogQL for log queries.
 *
 * Loki API reference:
 * - GET /loki/api/v1/query_range  - range queries
 * - GET /loki/api/v1/query        - instant queries
 * - GET /ready                    - readiness probe
 *
 * Labels used by the observability stack:
 *   ServiceName, Level, TenantId, Environment
 */

import axios, { type AxiosInstance } from 'axios';
import { setTimeout as delay } from 'timers/promises';

/** Shape of a single log stream returned by Loki */
export interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>; // [nanosecond-timestamp, log-line]
}

/** Shape of a Loki query result */
export interface LokiQueryResult {
  status: string;
  data: {
    resultType: 'streams' | 'matrix' | 'vector' | 'scalar';
    result: LokiStream[];
    stats?: Record<string, unknown>;
  };
}

/** Timeout for individual Loki API requests */
const API_TIMEOUT_MS = 15000;

export class LokiClient {
  private client: AxiosInstance;

  constructor(baseUrl: string = 'http://localhost:3100') {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: API_TIMEOUT_MS,
    });
  }

  /**
   * Check if Loki is ready to accept requests.
   * Uses the /ready endpoint which returns 200 when Loki is operational.
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await this.client.get('/ready');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Execute an instant LogQL query against Loki.
   *
   * @param logql - LogQL query string, e.g. `{ServiceName="IdentityService"}`
   * @param options - Optional time, limit, and direction parameters
   */
  async query(
    logql: string,
    options?: {
      time?: string;
      limit?: number;
      direction?: 'forward' | 'backward';
    }
  ): Promise<LokiQueryResult> {
    const params: Record<string, string | number> = { query: logql };
    if (options?.time) params.time = options.time;
    if (options?.limit) params.limit = options.limit;
    if (options?.direction) params.direction = options.direction;

    const response = await this.client.get('/loki/api/v1/query', { params });
    return response.data as LokiQueryResult;
  }

  /**
   * Execute a range LogQL query against Loki.
   *
   * @param logql - LogQL query string
   * @param options - Time range (start/end as RFC3339 or Unix epoch), limit, direction
   */
  async queryRange(
    logql: string,
    options?: {
      start?: string;
      end?: string;
      limit?: number;
      direction?: 'forward' | 'backward';
    }
  ): Promise<LokiQueryResult> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    const params: Record<string, string | number> = {
      query: logql,
      start: options?.start ?? oneHourAgo.toISOString(),
      end: options?.end ?? now.toISOString(),
    };
    if (options?.limit) params.limit = options.limit;
    if (options?.direction) params.direction = options.direction;

    const response = await this.client.get('/loki/api/v1/query_range', {
      params,
    });
    return response.data as LokiQueryResult;
  }

  /**
   * Convenience: query logs by ServiceName label.
   *
   * @param serviceName - Value of the ServiceName label
   * @param filter - Optional line-filter expression appended after the stream selector
   */
  async queryByService(
    serviceName: string,
    filter?: string
  ): Promise<LokiQueryResult> {
    const lineFilter = filter ? ` |= \`${filter}\`` : '';
    return this.queryRange(`{ServiceName="${serviceName}"}${lineFilter}`);
  }

  /**
   * Convenience: query logs containing a specific correlation ID.
   *
   * Uses a line-filter (`|=`) because the correlation ID may be a
   * structured field inside the log line rather than a stream label.
   */
  async queryByCorrelationId(
    correlationId: string
  ): Promise<LokiQueryResult> {
    return this.queryRange(
      `{ServiceName=~".+"} |= \`${correlationId}\``
    );
  }

  /**
   * Convenience: query error-level logs, optionally filtered by service.
   */
  async queryErrors(serviceName?: string): Promise<LokiQueryResult> {
    const serviceSelector = serviceName
      ? `ServiceName="${serviceName}"`
      : 'ServiceName=~".+"';
    return this.queryRange(`{${serviceSelector}, Level="Error"}`);
  }

  /**
   * Get all label names known to Loki.
   *
   * @returns Array of label name strings (e.g. ["ServiceName", "Level", "TenantId"])
   */
  async labels(): Promise<string[]> {
    const response = await this.client.get('/loki/api/v1/labels');
    const body = response.data as { status: string; data: string[] };
    return body.data ?? [];
  }

  /**
   * Get all values for a specific label.
   *
   * @param label - Label name to query values for
   * @returns Array of label value strings
   */
  async labelValues(label: string): Promise<string[]> {
    const response = await this.client.get(
      `/loki/api/v1/label/${encodeURIComponent(label)}/values`
    );
    const body = response.data as { status: string; data: string[] };
    return body.data ?? [];
  }

  /**
   * Push log entries directly to Loki via the push API.
   * Useful for testing ingestion without requiring a running service.
   *
   * @param streams - Array of log streams to push
   */
  async push(streams: LokiStream[]): Promise<void> {
    await this.client.post(
      '/loki/api/v1/push',
      { streams },
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Poll Loki until logs matching a query appear (with retry).
   *
   * @param logql - LogQL query to execute
   * @param options - Polling options: timeout, interval, minCount
   * @returns The Loki query result once minCount entries are found
   * @throws Error if minCount is not reached within timeout
   */
  async waitForLogs(
    logql: string,
    options?: {
      timeout?: number;
      interval?: number;
      minCount?: number;
    }
  ): Promise<LokiQueryResult> {
    const timeout = options?.timeout ?? 30000;
    const interval = options?.interval ?? 1000;
    const minCount = options?.minCount ?? 1;
    const deadline = Date.now() + timeout;

    let lastResult: LokiQueryResult | null = null;

    while (Date.now() < deadline) {
      lastResult = await this.queryRange(logql, {
        limit: minCount + 100,
      });
      const currentCount = LokiClient.countEntries(lastResult);

      if (currentCount >= minCount) {
        return lastResult;
      }

      const waitTime = Math.min(interval, deadline - Date.now());
      if (waitTime <= 0) break;
      await delay(waitTime);
    }

    const finalCount = lastResult ? LokiClient.countEntries(lastResult) : 0;
    throw new Error(
      `Timed out waiting for ${minCount} logs in Loki. ` +
        `Got ${finalCount} after ${timeout}ms. Query: ${logql}`
    );
  }

  /**
   * Get the total number of log entries across all streams in a result.
   */
  static countEntries(result: LokiQueryResult): number {
    if (!result.data?.result) return 0;
    return result.data.result.reduce(
      (sum, stream) => sum + stream.values.length,
      0
    );
  }

  /**
   * Flatten all log lines from a Loki query result into a single array.
   * Returns entries sorted by timestamp ascending.
   */
  static flattenEntries(
    result: LokiQueryResult
  ): Array<{ timestamp: string; line: string; labels: Record<string, string> }> {
    if (!result.data?.result) return [];

    const entries: Array<{
      timestamp: string;
      line: string;
      labels: Record<string, string>;
    }> = [];

    for (const stream of result.data.result) {
      for (const [ts, line] of stream.values) {
        entries.push({ timestamp: ts, line, labels: stream.stream });
      }
    }

    return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}
