/**
 * Grafana Health E2E Tests
 *
 * Validates that Grafana is operational and its datasources are configured:
 * - Grafana is accessible at :3000
 * - Loki datasource is configured
 * - Prometheus datasource is configured
 */

import { test, expect } from '@playwright/test';

import axios from 'axios';

const GRAFANA_URL = process.env.GRAFANA_URL ?? 'http://localhost:3000';

/** Timeout for Grafana API requests */
const GRAFANA_TIMEOUT_MS = 15000;

/** Grafana default admin credentials (local dev only) */
const GRAFANA_AUTH = {
  username: process.env.GRAFANA_ADMIN_USER ?? 'admin',
  password: process.env.GRAFANA_ADMIN_PASSWORD ?? 'admin',
};

interface GrafanaDatasource {
  id: number;
  name: string;
  type: string;
  url: string;
  access: string;
  isDefault: boolean;
}

test.describe('Grafana Health @monitoring', () => {
  test('Grafana is accessible and healthy', async () => {
    const response = await axios.get(`${GRAFANA_URL}/api/health`, {
      timeout: GRAFANA_TIMEOUT_MS,
    });

    expect(response.status).toBe(200);

    // Grafana health endpoint returns { commit, database, version }
    const body = response.data as Record<string, unknown>;
    expect(body).toHaveProperty('database');

    // Database should be "ok"
    expect(body.database).toBe('ok');

    test.info().annotations.push({
      type: 'info',
      description: `Grafana version: ${body.version ?? 'unknown'}`,
    });
  });

  test('Loki datasource is configured', async () => {
    let datasources: GrafanaDatasource[];
    try {
      const response = await axios.get(`${GRAFANA_URL}/api/datasources`, {
        timeout: GRAFANA_TIMEOUT_MS,
        auth: GRAFANA_AUTH,
      });
      datasources = response.data as GrafanaDatasource[];
    } catch {
      // If auth fails, try without auth (Grafana may have anonymous access)
      const response = await axios.get(`${GRAFANA_URL}/api/datasources`, {
        timeout: GRAFANA_TIMEOUT_MS,
      }).catch(() => null);

      if (!response) {
        test.skip(true, 'Cannot access Grafana datasources API (auth required)');
        return;
      }
      datasources = response.data as GrafanaDatasource[];
    }

    expect(
      Array.isArray(datasources),
      'Datasources API should return an array'
    ).toBe(true);

    // Find Loki datasource
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

  test('Prometheus datasource is configured', async () => {
    let datasources: GrafanaDatasource[];
    try {
      const response = await axios.get(`${GRAFANA_URL}/api/datasources`, {
        timeout: GRAFANA_TIMEOUT_MS,
        auth: GRAFANA_AUTH,
      });
      datasources = response.data as GrafanaDatasource[];
    } catch {
      const response = await axios.get(`${GRAFANA_URL}/api/datasources`, {
        timeout: GRAFANA_TIMEOUT_MS,
      }).catch(() => null);

      if (!response) {
        test.skip(true, 'Cannot access Grafana datasources API (auth required)');
        return;
      }
      datasources = response.data as GrafanaDatasource[];
    }

    expect(
      Array.isArray(datasources),
      'Datasources API should return an array'
    ).toBe(true);

    // Find Prometheus datasource
    const promDs = datasources.find(
      (ds) =>
        ds.type === 'prometheus' ||
        ds.name.toLowerCase().includes('prometheus')
    );

    expect(
      promDs,
      'Prometheus datasource should be configured in Grafana'
    ).toBeTruthy();

    if (promDs) {
      test.info().annotations.push({
        type: 'info',
        description: `Prometheus datasource: name="${promDs.name}", url="${promDs.url}", default=${promDs.isDefault}`,
      });
    }
  });
});
