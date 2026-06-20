/**
 * Loki Health E2E Tests
 *
 * Basic health checks for the Grafana Loki logging infrastructure:
 * - Loki is reachable and ready
 * - Loki has expected labels (ServiceName, Level, TenantId)
 */

import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';
import { lokiConfigured, LOKI_SKIP_REASON } from '../../helpers/feature-gates.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';

/**
 * Expected labels that should exist in the observability stack.
 *
 * NOTE: Loki normalises label names to lowercase when ingested via the
 * Serilog.Sinks.Grafana.Loki sink. Even though the sink is configured with
 * `propertiesAsLabels: new[] { "TenantId", "Level" }` in Logging.Client, the
 * stored label name is `level` (lowercase), not `Level`. `ServiceName` keeps
 * its mixed case because it is declared as an explicit static label
 * (`new LokiLabel { Key = "ServiceName", ... }`) rather than a promoted
 * Serilog property — Loki preserves the casing of explicit push labels.
 */
const EXPECTED_LABELS = ['ServiceName', 'level'];

test.describe('Loki Health @logging', () => {
  // Observability stack is in-cluster only — skip on dev-PC staging/prod runs.
  test.skip(!lokiConfigured(), LOKI_SKIP_REASON);

  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);
  });

  test('Loki is reachable and ready', async () => {
    const ready = await loki.isReady();
    expect(ready, 'Loki should respond to /ready with 200').toBe(true);
  });

  test('Loki query API is operational', async () => {
    const ready = await loki.isReady();
    if (!ready) {
      test.skip(true, 'Loki not running');
      return;
    }

    // Verify the query API responds successfully
    const result = await loki.queryRange('{ServiceName=~".+"}', {
      limit: 1,
    });

    expect(result.status, 'Loki query should return success status').toBe(
      'success'
    );
    expect(
      result.data.resultType,
      'Loki range query should return streams'
    ).toBe('streams');
  });

  test('Loki has expected labels (ServiceName, Level)', async () => {
    const ready = await loki.isReady();
    if (!ready) {
      test.skip(true, 'Loki not running');
      return;
    }

    const labels = await loki.labels();

    expect(
      Array.isArray(labels),
      'Labels API should return an array'
    ).toBe(true);

    test.info().annotations.push({
      type: 'info',
      description: `Loki labels found: ${labels.join(', ')}`,
    });

    for (const expectedLabel of EXPECTED_LABELS) {
      expect(
        labels,
        `Loki should have the "${expectedLabel}" label`
      ).toContain(expectedLabel);
    }
  });

  test('Loki ServiceName label has values for known services', async () => {
    const ready = await loki.isReady();
    if (!ready) {
      test.skip(true, 'Loki not running');
      return;
    }

    const serviceNames = await loki.labelValues('ServiceName');

    expect(
      Array.isArray(serviceNames),
      'Label values API should return an array'
    ).toBe(true);

    expect(
      serviceNames.length,
      'ServiceName label should have at least one value'
    ).toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'info',
      description: `ServiceName values: ${serviceNames.join(', ')}`,
    });
  });
});
