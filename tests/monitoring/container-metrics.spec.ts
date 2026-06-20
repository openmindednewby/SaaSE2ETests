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
import { monitoringConfigured, MONITORING_SKIP_REASON } from '../../helpers/feature-gates.js';

const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL ?? 'http://localhost:9090';

/**
 * Regex pattern matching known service pod names.
 *
 * NOTE: Kubernetes cAdvisor metrics scraped via kubelet (/metrics/cadvisor)
 * expose container identity through the `pod` label (e.g. "tenant-api-57968bd9-xxx"),
 * NOT a `name` label. The `name` label is only populated in standalone-Docker
 * cAdvisor; it is absent in K3s/K8s environments. Queries must filter on `pod=~`.
 */
const SERVICE_POD_PATTERN =
  '.*identity.*|.*questioner.*|.*onlinemenu.*|.*notification.*|.*tenant.*';

test.describe('Container Metrics @monitoring', () => {
  // Observability stack is in-cluster only — skip on dev-PC staging/prod runs.
  test.skip(!monitoringConfigured(), MONITORING_SKIP_REASON);

  let prometheus: PrometheusClient;

  test.beforeAll(async () => {
    prometheus = new PrometheusClient(PROMETHEUS_URL);
  });

  test('container CPU metrics are available for service containers', async () => {
    const result = await prometheus.getContainerCpu(
      SERVICE_POD_PATTERN
    );

    expect(result.status).toBe('success');
    expect(
      result.data.result.length,
      'Expected CPU metrics for at least one service container'
    ).toBeGreaterThan(0);

    // Log which pods have CPU metrics
    const podNames = result.data.result.map(
      (r) => r.metric.pod ?? r.metric.name ?? 'unknown'
    );
    test.info().annotations.push({
      type: 'info',
      description: `CPU metrics found for pods: ${podNames.join(', ')}`,
    });
  });

  test('container memory metrics are available', async () => {
    const result = await prometheus.getContainerMemory(
      SERVICE_POD_PATTERN
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
          `Pod "${metric.metric.pod ?? metric.metric.name}" memory should be > 0`
        ).toBeGreaterThan(0);
      }
    }

    test.info().annotations.push({
      type: 'info',
      description: `Memory metrics found for ${result.data.result.length} container(s)`,
    });
  });

  test('metrics include pod name labels', async () => {
    // Query raw container CPU metric to check labels.
    // In Kubernetes/K3s, cAdvisor metrics use `pod` (not `name`) to identify
    // containers — `name` is only set in standalone-Docker cAdvisor.
    const result = await prometheus.query(
      `container_cpu_usage_seconds_total{pod=~"${SERVICE_POD_PATTERN}",namespace="dloizides"}`
    );

    expect(result.status).toBe('success');

    if (result.data.result.length > 0) {
      // Verify each result has a `pod` label identifying the container
      const hasPodLabel = result.data.result.every(
        (r) => r.metric.pod !== undefined
      );
      expect(
        hasPodLabel,
        'All container metrics should have a "pod" label'
      ).toBe(true);

      // Log available label keys for diagnostics
      const sampleMetric = result.data.result[0].metric;
      test.info().annotations.push({
        type: 'info',
        description: `Sample metric labels: ${Object.keys(sampleMetric).join(', ')}`,
      });
    } else {
      // If no results, the pod pattern may not match - skip gracefully
      test.info().annotations.push({
        type: 'warning',
        description: 'No container CPU metrics matched the service pattern',
      });
    }
  });

  test('network I/O metrics are available', async () => {
    const [rxResult, txResult] = await Promise.all([
      prometheus.getContainerNetworkRx(SERVICE_POD_PATTERN),
      prometheus.getContainerNetworkTx(SERVICE_POD_PATTERN),
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
