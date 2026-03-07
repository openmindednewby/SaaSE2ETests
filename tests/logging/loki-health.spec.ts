/**
 * Loki Health E2E Tests
 *
 * Basic health checks for the Grafana Loki logging infrastructure:
 * - Loki is reachable and ready
 * - Loki has expected labels (ServiceName, Level, TenantId)
 * - Grafana Loki datasource is configured and reachable
 */

import { test, expect } from '@playwright/test';

import axios from 'axios';

import { LokiClient } from '../../helpers/loki-client.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const GRAFANA_URL = process.env.GRAFANA_URL ?? 'http://localhost:3000';

/** Grafana default admin credentials (local dev only) */
const GRAFANA_AUTH = {
  username: process.env.GRAFANA_ADMIN_USER ?? 'admin',
  password: process.env.GRAFANA_ADMIN_PASSWORD ?? 'admin',
};

/** Timeout for Grafana API requests */
const GRAFANA_TIMEOUT_MS = 15000;

/** Expected labels that should exist in the observability stack */
const EXPECTED_LABELS = ['ServiceName', 'Level'];

interface GrafanaDatasource {
  id: number;
  name: string;
  type: string;
  url: string;
  access: string;
  isDefault: boolean;
}

test.describe('Loki Health @logging', () => {
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

  test('Grafana Loki datasource is configured', async () => {
    let datasources: GrafanaDatasource[];
    try {
      const response = await axios.get(`${GRAFANA_URL}/api/datasources`, {
        timeout: GRAFANA_TIMEOUT_MS,
        auth: GRAFANA_AUTH,
      });
      datasources = response.data as GrafanaDatasource[];
    } catch {
      // If auth fails, try without auth (Grafana may have anonymous access)
      const response = await axios
        .get(`${GRAFANA_URL}/api/datasources`, {
          timeout: GRAFANA_TIMEOUT_MS,
        })
        .catch(() => null);

      if (!response) {
        test.skip(
          true,
          'Cannot access Grafana datasources API (auth required or Grafana not running)'
        );
        return;
      }
      datasources = response.data as GrafanaDatasource[];
    }

    expect(
      Array.isArray(datasources),
      'Datasources API should return an array'
    ).toBe(true);

    const lokiDs = datasources.find(
      (ds) => ds.type === 'loki' || ds.name.toLowerCase().includes('loki')
    );

    expect(
      lokiDs,
      'Loki datasource should be configured in Grafana'
    ).toBeTruthy();

    if (lokiDs) {
      test.info().annotations.push({
        type: 'info',
        description: `Loki datasource: name="${lokiDs.name}", url="${lokiDs.url}", default=${lokiDs.isDefault}`,
      });
    }
  });
});
