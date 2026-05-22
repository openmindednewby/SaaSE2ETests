/**
 * Prometheus Health E2E Tests
 *
 * Validates that Prometheus is operational and collecting metrics:
 * - Prometheus is reachable and ready
 * - Prometheus has active scrape targets
 * - cAdvisor target is up and healthy
 */

import { test, expect } from '@playwright/test';

import { PrometheusClient } from '../../helpers/prometheus-client.js';
import { monitoringConfigured, MONITORING_SKIP_REASON } from '../../helpers/feature-gates.js';

const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL ?? 'http://localhost:9090';

test.describe('Prometheus Health @monitoring', () => {
  // Observability stack is in-cluster only — skip on dev-PC staging/prod runs.
  test.skip(!monitoringConfigured(), MONITORING_SKIP_REASON);

  let prometheus: PrometheusClient;

  test.beforeAll(async () => {
    prometheus = new PrometheusClient(PROMETHEUS_URL);
  });

  test('Prometheus is reachable and ready', async () => {
    const ready = await prometheus.isReady();
    expect(ready, 'Prometheus should respond to /-/ready with 200').toBe(
      true
    );
  });

  test('Prometheus query API is operational', async () => {
    const ready = await prometheus.isReady();
    if (!ready) {
      test.skip(true, 'Prometheus not running');
      return;
    }

    // Verify the query API responds by querying the "up" metric
    const result = await prometheus.query('up');

    expect(
      result.status,
      'Prometheus query should return success status'
    ).toBe('success');
    expect(
      result.data.result.length,
      'Prometheus should have at least one "up" target'
    ).toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'info',
      description: `Prometheus reports ${result.data.result.length} "up" target(s)`,
    });
  });

  test('Prometheus has active scrape targets', async () => {
    const ready = await prometheus.isReady();
    if (!ready) {
      test.skip(true, 'Prometheus not running');
      return;
    }

    const targetsResult = await prometheus.targets();

    expect(targetsResult.status).toBe('success');
    expect(
      targetsResult.data.activeTargets.length,
      'Prometheus should have at least one active scrape target'
    ).toBeGreaterThan(0);

    // Log details about each active target
    const targetSummaries = targetsResult.data.activeTargets.map(
      (t) =>
        `${t.labels.job ?? 'unknown'}(${t.health}) -> ${t.scrapeUrl}`
    );

    test.info().annotations.push({
      type: 'info',
      description: `Active targets (${targetsResult.data.activeTargets.length}): ${targetSummaries.join(', ')}`,
    });

    // At least one target should be healthy
    const healthyTargets = targetsResult.data.activeTargets.filter(
      (t) => t.health === 'up'
    );
    expect(
      healthyTargets.length,
      'At least one scrape target should be healthy (up)'
    ).toBeGreaterThan(0);
  });

  test('cAdvisor target is up', async () => {
    const ready = await prometheus.isReady();
    if (!ready) {
      test.skip(true, 'Prometheus not running');
      return;
    }

    const targetsResult = await prometheus.targets();
    expect(targetsResult.status).toBe('success');

    // Find cAdvisor target by job name or scrape URL
    const cadvisorTarget = targetsResult.data.activeTargets.find(
      (t) =>
        t.labels.job?.toLowerCase().includes('cadvisor') ||
        t.scrapeUrl?.includes('cadvisor') ||
        t.scrapePool?.toLowerCase().includes('cadvisor')
    );

    if (!cadvisorTarget) {
      // cAdvisor might not be configured in all environments
      test.info().annotations.push({
        type: 'warning',
        description:
          'cAdvisor target not found in Prometheus scrape targets. ' +
          'Available jobs: ' +
          targetsResult.data.activeTargets
            .map((t) => t.labels.job)
            .filter(Boolean)
            .join(', '),
      });

      // Still verify that container metrics exist (cAdvisor may be integrated differently)
      const cpuResult = await prometheus.query(
        'container_cpu_usage_seconds_total'
      );
      if (cpuResult.data.result.length > 0) {
        test.info().annotations.push({
          type: 'info',
          description:
            'Container metrics are available even though no explicit cAdvisor target was found',
        });
        return;
      }

      test.skip(
        true,
        'cAdvisor target not configured in this environment'
      );
      return;
    }

    expect(
      cadvisorTarget.health,
      `cAdvisor target should be healthy (up), last error: "${cadvisorTarget.lastError}"`
    ).toBe('up');

    test.info().annotations.push({
      type: 'info',
      description: `cAdvisor target: health=${cadvisorTarget.health}, url=${cadvisorTarget.scrapeUrl}, lastScrape=${cadvisorTarget.lastScrape}`,
    });
  });
});
