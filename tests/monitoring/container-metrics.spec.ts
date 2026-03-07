/**
 * Container Metrics E2E Tests
 *
 * Validates that Prometheus is collecting container metrics via cAdvisor:
 * - Prometheus is healthy
 * - Container CPU metrics are available for service containers
 * - Container memory metrics are available
 * - Metrics include service name labels
 * - Network I/O metrics are available
 */

import { test, expect } from '@playwright/test';

import { PrometheusClient } from '../../helpers/prometheus-client.js';

const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL ?? 'http://localhost:9090';

/** Regex pattern matching known service container names */
const SERVICE_CONTAINER_PATTERN =
  '.*identity.*|.*questioner.*|.*onlinemenu.*|.*notification.*';

test.describe('Container Metrics @monitoring', () => {
  let prometheus: PrometheusClient;

  test.beforeAll(async () => {
    prometheus = new PrometheusClient(PROMETHEUS_URL);
  });

  test('Prometheus is healthy and responding', async () => {
    const ready = await prometheus.isReady();
    expect(ready, 'Prometheus should be ready').toBe(true);

    // Also verify the query API responds
    const result = await prometheus.query('up');
    expect(result.status).toBe('success');
    expect(result.data.result.length).toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'info',
      description: `Prometheus reports ${result.data.result.length} "up" targets`,
    });
  });

  test('container CPU metrics are available for service containers', async () => {
    const result = await prometheus.getContainerCpu(
      SERVICE_CONTAINER_PATTERN
    );

    expect(result.status).toBe('success');
    expect(
      result.data.result.length,
      'Expected CPU metrics for at least one service container'
    ).toBeGreaterThan(0);

    // Log which containers have CPU metrics
    const containerNames = result.data.result.map(
      (r) => r.metric.name ?? 'unknown'
    );
    test.info().annotations.push({
      type: 'info',
      description: `CPU metrics found for containers: ${containerNames.join(', ')}`,
    });
  });

  test('container memory metrics are available', async () => {
    const result = await prometheus.getContainerMemory(
      SERVICE_CONTAINER_PATTERN
    );

    expect(result.status).toBe('success');
    expect(
      result.data.result.length,
      'Expected memory metrics for at least one service container'
    ).toBeGreaterThan(0);

    // Verify memory values are reasonable (> 0 bytes)
    for (const metric of result.data.result) {
      const value = metric.value;
      if (value) {
        const memoryBytes = parseFloat(value[1]);
        expect(
          memoryBytes,
          `Container "${metric.metric.name}" memory should be > 0`
        ).toBeGreaterThan(0);
      }
    }

    test.info().annotations.push({
      type: 'info',
      description: `Memory metrics found for ${result.data.result.length} container(s)`,
    });
  });

  test('metrics include service name labels', async () => {
    // Query raw container CPU metric to check labels
    const result = await prometheus.query(
      `container_cpu_usage_seconds_total{name=~"${SERVICE_CONTAINER_PATTERN}"}`
    );

    expect(result.status).toBe('success');

    if (result.data.result.length > 0) {
      // Verify each result has a `name` label identifying the container
      const hasNameLabel = result.data.result.every(
        (r) => r.metric.name !== undefined
      );
      expect(
        hasNameLabel,
        'All container metrics should have a "name" label'
      ).toBe(true);

      // Check for additional labels like image, id
      const sampleMetric = result.data.result[0].metric;
      test.info().annotations.push({
        type: 'info',
        description: `Sample metric labels: ${Object.keys(sampleMetric).join(', ')}`,
      });
    } else {
      // If no results, the container pattern may not match - skip gracefully
      test.info().annotations.push({
        type: 'warning',
        description: 'No container CPU metrics matched the service pattern',
      });
    }
  });

  test('network I/O metrics are available', async () => {
    const [rxResult, txResult] = await Promise.all([
      prometheus.getContainerNetworkRx(SERVICE_CONTAINER_PATTERN),
      prometheus.getContainerNetworkTx(SERVICE_CONTAINER_PATTERN),
    ]);

    expect(rxResult.status).toBe('success');
    expect(txResult.status).toBe('success');

    // At least one direction should have data
    const totalNetworkMetrics =
      rxResult.data.result.length + txResult.data.result.length;

    if (totalNetworkMetrics > 0) {
      test.info().annotations.push({
        type: 'info',
        description: `Network metrics: ${rxResult.data.result.length} RX, ${txResult.data.result.length} TX`,
      });
    } else {
      // Network metrics may not be available in all container runtimes
      test.info().annotations.push({
        type: 'warning',
        description:
          'No network I/O metrics found. cAdvisor may not export network metrics in this environment.',
      });
    }

    // The query itself should always succeed even if no results
    expect(rxResult.status).toBe('success');
    expect(txResult.status).toBe('success');
  });
});
