/**
 * Prometheus HTTP Client for E2E Tests
 *
 * Provides utility functions for querying the Prometheus HTTP API
 * during E2E tests. Uses PromQL for metric queries.
 *
 * Prometheus API reference:
 * - GET /api/v1/query       - instant queries
 * - GET /api/v1/query_range - range queries
 * - GET /-/ready            - readiness probe
 */

import axios, { type AxiosInstance } from 'axios';
import { setTimeout as delay } from 'timers/promises';

/** Shape of a single metric result */
export interface PrometheusMetricResult {
  metric: Record<string, string>;
  value?: [number, string]; // [unix-timestamp, value] for instant queries
  values?: Array<[number, string]>; // for range queries
}

/** Shape of a Prometheus query response */
export interface PrometheusQueryResult {
  status: 'success' | 'error';
  data: {
    resultType: 'vector' | 'matrix' | 'scalar' | 'string';
    result: PrometheusMetricResult[];
  };
  errorType?: string;
  error?: string;
}

/** Shape of a single scrape target */
export interface PrometheusTarget {
  discoveredLabels: Record<string, string>;
  labels: Record<string, string>;
  scrapePool: string;
  scrapeUrl: string;
  globalUrl: string;
  lastError: string;
  lastScrape: string;
  lastScrapeDuration: number;
  health: 'up' | 'down' | 'unknown';
  scrapeInterval: string;
  scrapeTimeout: string;
}

/** Shape of the /api/v1/targets response */
export interface PrometheusTargetsResult {
  status: 'success' | 'error';
  data: {
    activeTargets: PrometheusTarget[];
    droppedTargets: Array<{ discoveredLabels: Record<string, string> }>;
  };
}

/** Timeout for individual Prometheus API requests */
const API_TIMEOUT_MS = 15000;

export class PrometheusClient {
  private client: AxiosInstance;

  constructor(baseUrl: string = 'http://localhost:9090') {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: API_TIMEOUT_MS,
    });
  }

  /**
   * Check if Prometheus is ready to accept requests.
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await this.client.get('/-/ready');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Execute an instant PromQL query.
   *
   * @param promql - PromQL expression
   * @param time - Optional evaluation timestamp (RFC3339 or Unix epoch)
   */
  async query(
    promql: string,
    time?: string
  ): Promise<PrometheusQueryResult> {
    const params: Record<string, string> = { query: promql };
    if (time) params.time = time;

    const response = await this.client.get('/api/v1/query', { params });
    return response.data as PrometheusQueryResult;
  }

  /**
   * Execute a range PromQL query.
   *
   * @param promql - PromQL expression
   * @param start - Start time (RFC3339 or Unix epoch)
   * @param end - End time (RFC3339 or Unix epoch)
   * @param step - Query resolution step width (e.g. "15s", "1m")
   */
  async queryRange(
    promql: string,
    start: string,
    end: string,
    step: string
  ): Promise<PrometheusQueryResult> {
    const response = await this.client.get('/api/v1/query_range', {
      params: { query: promql, start, end, step },
    });
    return response.data as PrometheusQueryResult;
  }

  /**
   * Get all active scrape targets from Prometheus.
   *
   * @returns Object containing activeTargets and droppedTargets arrays
   */
  async targets(): Promise<PrometheusTargetsResult> {
    const response = await this.client.get('/api/v1/targets');
    return response.data as PrometheusTargetsResult;
  }

  /**
   * Poll Prometheus until a metric matching the query exists (with retry).
   *
   * @param promql - PromQL query to check
   * @param options - Polling options: timeout, interval
   * @returns The Prometheus query result once at least one result is found
   * @throws Error if no results are found within timeout
   */
  async waitForMetric(
    promql: string,
    options?: { timeout?: number; interval?: number }
  ): Promise<PrometheusQueryResult> {
    const timeout = options?.timeout ?? 30000;
    const interval = options?.interval ?? 1000;
    const deadline = Date.now() + timeout;

    let lastResult: PrometheusQueryResult | null = null;

    while (Date.now() < deadline) {
      lastResult = await this.query(promql);

      if (
        lastResult.status === 'success' &&
        lastResult.data.result.length > 0
      ) {
        return lastResult;
      }

      const waitTime = Math.min(interval, deadline - Date.now());
      if (waitTime <= 0) break;
      await delay(waitTime);
    }

    const resultCount = lastResult?.data?.result?.length ?? 0;
    throw new Error(
      `Timed out waiting for metric in Prometheus. ` +
        `Got ${resultCount} results after ${timeout}ms. Query: ${promql}`
    );
  }

  /**
   * Get container CPU usage as a percentage for containers matching a name pattern.
   *
   * @param containerNamePattern - Regex pattern for container names (e.g. ".*identity.*")
   */
  async getContainerCpu(
    containerNamePattern: string
  ): Promise<PrometheusQueryResult> {
    return this.query(
      `sum(rate(container_cpu_usage_seconds_total{name=~"${containerNamePattern}"}[5m])) by (name) * 100`
    );
  }

  /**
   * Get container memory usage in bytes for containers matching a name pattern.
   *
   * @param containerNamePattern - Regex pattern for container names
   */
  async getContainerMemory(
    containerNamePattern: string
  ): Promise<PrometheusQueryResult> {
    return this.query(
      `container_memory_usage_bytes{name=~"${containerNamePattern}"}`
    );
  }

  /**
   * Get container network receive bytes for containers matching a name pattern.
   *
   * @param containerNamePattern - Regex pattern for container names
   */
  async getContainerNetworkRx(
    containerNamePattern: string
  ): Promise<PrometheusQueryResult> {
    return this.query(
      `sum(rate(container_network_receive_bytes_total{name=~"${containerNamePattern}"}[5m])) by (name)`
    );
  }

  /**
   * Get container network transmit bytes for containers matching a name pattern.
   *
   * @param containerNamePattern - Regex pattern for container names
   */
  async getContainerNetworkTx(
    containerNamePattern: string
  ): Promise<PrometheusQueryResult> {
    return this.query(
      `sum(rate(container_network_transmit_bytes_total{name=~"${containerNamePattern}"}[5m])) by (name)`
    );
  }
}
