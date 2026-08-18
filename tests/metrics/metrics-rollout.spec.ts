/**
 * Metrics rollout guards (@api tier).
 *
 * Two guards that keep `metrics-contract.spec.ts` honest, plus the one
 * assertion that can only be made from Prometheus' side.
 *
 *  1. COVERAGE — at least one enforced service must actually have been
 *     scraped. Without this, an empty/typo'd `METRICS_CONTRACT_SERVICES` makes
 *     the whole contract suite vacuously green.
 *  2. STALE ALLOWLIST — a service that has adopted 2.0.0 but is NOT in the
 *     allowlist is a failure, because its contract is not being enforced. This
 *     is what stops the allowlist from rotting as the rollout proceeds.
 *  3. PROMETHEUS-SIDE LABEL COLLISION — `exported_service` / `exported_endpoint`
 *     are created by PROMETHEUS at scrape time when a target's own labels
 *     collide with Prometheus' Kubernetes target labels. They can therefore
 *     never appear in a service's own exposition, and the service-side check in
 *     `metrics-contract.spec.ts` is a guard, not a proof. This is the proof —
 *     it needs `PROMETHEUS_URL`, which is only reachable in-cluster (or over
 *     WireGuard), so it skips elsewhere.
 */

import { expect, test } from '@playwright/test';

import { PrometheusClient } from '../../helpers/prometheus-client.js';
import {
  EXPORTED_LABELS,
  REQUESTS_TOTAL,
  driveUnmatchedRequest,
  enforcedServiceNames,
  labelValues,
  looksLikeV2Contract,
  resolveMetricsTargets,
  samplesOf,
  scrapeMetrics,
} from '../../helpers/metrics-contract.js';

const enforced = enforcedServiceNames();
const allTargets = resolveMetricsTargets();
const enforcedTargets = allTargets.filter((target) => enforced.includes(target.name));
const observedTargets = allTargets.filter((target) => !enforced.includes(target.name));

test.describe('Metrics rollout guards @api @metrics', () => {
  test('at least one enforced service exposes /metrics', async ({ request }) => {
    expect(
      enforcedTargets.length,
      `METRICS_CONTRACT_SERVICES ("${enforced.join(',')}") matched no target with a base URL set. ` +
        `Known targets with URLs: ${allTargets.map((t) => t.name).join(', ') || '(none)'}`,
    ).toBeGreaterThan(0);

    const reachable: string[] = [];
    for (const target of enforcedTargets) {
      const scrape = await scrapeMetrics(request, target.baseUrl);
      if (scrape && scrape.status === 200) reachable.push(target.name);
    }

    expect(
      reachable,
      'no enforced service could be scraped, so the contract suite proved nothing this run',
    ).not.toEqual([]);

    test.info().annotations.push({
      type: 'info',
      description: `Enforced + scraped: ${reachable.join(', ')}`,
    });
  });

  for (const target of observedTargets) {
    test(`${target.name} rollout state is recorded, not silently skipped`, async ({ request }) => {
      const scrape = await scrapeMetrics(request, target.baseUrl);
      if (!scrape || scrape.status !== 200) {
        test.skip(
          true,
          `${target.name} not scrapeable at ${target.baseUrl} (${target.envVar}), status ` +
            `${scrape?.status ?? 'connection error'}`,
        );
        return;
      }

      const onV2 = looksLikeV2Contract(scrape);
      test.info().annotations.push({
        type: 'info',
        description: `${target.name}: ${onV2 ? 'Metrics.Client 2.0.0' : 'legacy contract (pre-2.0.0)'}`,
      });

      expect(
        onV2,
        `${target.name} is already on the 2.0.0 contract but is NOT in METRICS_CONTRACT_SERVICES, ` +
          'so none of its contract is being enforced. Add it to the active .env.<target>.',
      ).toBe(false);
    });
  }
});

const PROMETHEUS_URL = (process.env.PROMETHEUS_URL ?? '').trim();

test.describe('Metrics label collision, Prometheus side @api @metrics', () => {
  test.skip(
    PROMETHEUS_URL.length === 0,
    'PROMETHEUS_URL unset: Prometheus has no public ingress, so a dev-PC run cannot reach it. ' +
      'The in-cluster nightly K8s Job runs this assertion.',
  );

  test('2.0.0 series carry no exported_service / exported_endpoint labels', async ({ request }) => {
    // Learn each enforced service's `app` label from its own exposition rather
    // than hardcoding it — the label value ("AgoraService") is not the target
    // name ("agora-api"), and only the service can say which it uses.
    const appLabels: string[] = [];
    for (const target of enforcedTargets) {
      await driveUnmatchedRequest(request, target.baseUrl);
      const scrape = await scrapeMetrics(request, target.baseUrl);
      if (!scrape || scrape.status !== 200) continue;
      appLabels.push(...labelValues(samplesOf(scrape.samples, REQUESTS_TOTAL), 'app'));
    }

    if (appLabels.length === 0) {
      test.skip(true, 'No enforced service exposed an `app` label to scope the Prometheus query by');
      return;
    }

    const prometheus = new PrometheusClient(PROMETHEUS_URL);
    if (!(await prometheus.isReady())) {
      test.skip(true, `Prometheus not ready at ${PROMETHEUS_URL}`);
      return;
    }

    // Scoped to the ENFORCED apps on purpose. A bare `http_requests_total`
    // query also returns every service still on the old package, whose series
    // legitimately still carry exported_* until it is rolled out — asserting
    // over the whole fleet would report the pending rollout as a regression.
    const selector = `${REQUESTS_TOTAL}{app=~"${[...new Set(appLabels)].join('|')}"}`;
    const result = await prometheus.query(selector);
    expect(result.status).toBe('success');
    expect(result.data.result.length, `Prometheus should hold series for ${selector}`).toBeGreaterThan(0);

    const collided = result.data.result
      .filter((series) => EXPORTED_LABELS.some((label) => series.metric[label] !== undefined))
      .map((series) => JSON.stringify(series.metric))
      .slice(0, 5);

    expect(
      collided,
      'Prometheus renames a target label that collides with its own to exported_* — seeing them ' +
        'means our labels are still called service/endpoint, and a dashboard grouping by "endpoint" ' +
        'is really grouping by the scrape port',
    ).toEqual([]);

    // Fleet-wide rollout visibility: how many series still carry the collision.
    const fleet = await prometheus.query(REQUESTS_TOTAL);
    const stillLegacy = fleet.data.result.filter((series) =>
      EXPORTED_LABELS.some((label) => series.metric[label] !== undefined),
    ).length;
    test.info().annotations.push({
      type: 'info',
      description:
        `Enforced apps clean: ${[...new Set(appLabels)].join(', ')}. ` +
        `Fleet-wide series still carrying exported_*: ${stillLegacy} (pending Metrics.Client 2.0.0 rollout)`,
    });
  });
});
