/**
 * Metrics contract E2E — `Metrics.Client` 2.0.0 (@api tier).
 *
 * Asserts the exposition contract of the shared metrics package against a
 * DEPLOYED service's `/metrics`. No browser, no auth (`/metrics` is
 * AllowAnonymous), seconds to run.
 *
 * Which services are asserted is driven by `METRICS_CONTRACT_SERVICES` in the
 * active `.env.<target>` — see `helpers/metrics-contract.ts` for why the
 * allowlist is env-driven rather than sniffed, and `metrics-rollout.spec.ts`
 * for the guard that keeps the allowlist from going stale.
 *
 * Metric families with labels emit NOTHING until the first matching request, so
 * every test drives its own traffic before scraping, and RE-drives on each poll
 * iteration - see `metrics-poll-helpers.ts` for why a single drive-then-scrape
 * is not sound against a multi-replica service mid-rollout.
 */

import { expect, test } from '@playwright/test';

import {
  DUPLICATE_FAMILIES,
  EXPORTED_LABELS,
  PROBE_PREFIX,
  REQUESTS_TOTAL,
  REQUIRED_REQUEST_LABELS,
  RETIRED_LABELS,
  UNMATCHED_ROUTE,
  UNMATCHED_TOTAL,
  driveUnmatchedRequest,
  enforcedServiceNames,
  hasFamily,
  labelValues,
  resolveMetricsTargets,
  samplesOf,
} from '../../helpers/metrics-contract.js';
import {
  EXPANDED_VALUE_PATTERNS,
  UNMATCHED_ALLOWED_LABELS,
  isReachable,
  pollForSeries,
  unreachableReason,
} from './metrics-poll-helpers.js';

const enforced = enforcedServiceNames();
const targets = resolveMetricsTargets().filter((target) => enforced.includes(target.name));

for (const target of targets) {
  test.describe(`Metrics contract: ${target.name} @api @metrics`, () => {
    test(`${REQUESTS_TOTAL} carries the app + http_route labels`, async ({ request }) => {
      if (!(await isReachable(request, target))) {
        test.skip(true, unreachableReason(target));
        return;
      }

      const scrape = await pollForSeries(
        request,
        target,
        (s) => samplesOf(s.samples, REQUESTS_TOTAL).length,
        `${REQUESTS_TOTAL} should expose at least one series`,
      );
      const requests = samplesOf(scrape.samples, REQUESTS_TOTAL);

      for (const label of REQUIRED_REQUEST_LABELS) {
        const missing = requests.filter((sample) => sample.labels[label] === undefined);
        expect(missing.length, `every ${REQUESTS_TOTAL} series must carry "${label}"`).toBe(0);
      }

      for (const retired of RETIRED_LABELS) {
        const stragglers = requests.filter((sample) => sample.labels[retired] !== undefined);
        expect(
          stragglers.length,
          `"${retired}" was renamed in 2.0.0 (it collides with a Prometheus target label) ` +
            `and must not appear on ${REQUESTS_TOTAL}`,
        ).toBe(0);
      }

      test.info().annotations.push({
        type: 'info',
        description: `app=${labelValues(requests, 'app').join(',')} · ${requests.length} series`,
      });
    });

    test('no Prometheus-colliding exported_* labels are emitted', async ({ request }) => {
      if (!(await isReachable(request, target))) {
        test.skip(true, unreachableReason(target));
        return;
      }

      const scrape = await pollForSeries(
        request,
        target,
        (s) => samplesOf(s.samples, REQUESTS_TOTAL).length,
        `${REQUESTS_TOTAL} should expose at least one series`,
      );

      for (const label of EXPORTED_LABELS) {
        const offenders = scrape.body
          .split('\n')
          .filter((line) => line.includes(label))
          .slice(0, 5);
        expect(offenders, `no metric line may contain "${label}"`).toEqual([]);
      }
    });

    test('prometheus-net built-in duplicate instrumentation is absent', async ({ request }) => {
      if (!(await isReachable(request, target))) {
        test.skip(true, unreachableReason(target));
        return;
      }

      const scrape = await pollForSeries(
        request,
        target,
        (s) => samplesOf(s.samples, REQUESTS_TOTAL).length,
        `${REQUESTS_TOTAL} should expose at least one series`,
      );

      for (const family of DUPLICATE_FAMILIES) {
        expect(
          hasFamily(scrape.samples, scrape.body, family),
          `"${family}" comes from prometheus-net's UseHttpMetrics(), removed in 2.0.0 — ` +
            'its presence means the duplicate instrumentation is back',
        ).toBe(false);
      }
    });

    test('an unmatched route records http_route="unmatched", never the raw path @critical', async ({
      request,
    }) => {
      if (!(await isReachable(request, target))) {
        test.skip(true, unreachableReason(target));
        return;
      }

      const scrape = await pollForSeries(
        request,
        target,
        (s) =>
          samplesOf(s.samples, REQUESTS_TOTAL).filter(
            (sample) => sample.labels.http_route === UNMATCHED_ROUTE,
          ).length,
        `a ${REQUESTS_TOTAL} series with http_route="${UNMATCHED_ROUTE}" should appear after a ` +
          'request that matched no route',
      );

      // The cardinality-leak regression: before 2.0.0 the raw path became the
      // label value, so each of those probes would mint ~14 permanent series.
      // Matching the shared PREFIX catches every probe this suite has sent to
      // the instance, not just the last one.
      const leaked = scrape.body
        .split('\n')
        .filter((line) => line.includes(PROBE_PREFIX))
        .slice(0, 5);
      expect(
        leaked,
        'no raw probe path may appear anywhere in the exposition — every distinct 404 URL would ' +
          'otherwise mint a permanent time series',
      ).toEqual([]);
    });

    test(`${UNMATCHED_TOTAL} exists and carries no route label`, async ({ request }) => {
      if (!(await isReachable(request, target))) {
        test.skip(true, unreachableReason(target));
        return;
      }

      const scrape = await pollForSeries(
        request,
        target,
        (s) => samplesOf(s.samples, UNMATCHED_TOTAL).length,
        `${UNMATCHED_TOTAL} is where the 404 RATE lives now that the route label is bounded`,
      );

      for (const sample of samplesOf(scrape.samples, UNMATCHED_TOTAL)) {
        const extraLabels = Object.keys(sample.labels).filter(
          (key) => !UNMATCHED_ALLOWED_LABELS.includes(key),
        );
        expect(
          extraLabels,
          `${UNMATCHED_TOTAL} must stay low-cardinality: only ${UNMATCHED_ALLOWED_LABELS.join('/')} ` +
            'are allowed, a route/path label here would reintroduce the leak',
        ).toEqual([]);
      }
    });

    test('http_route values are route templates, not expanded values', async ({ request }) => {
      if (!(await isReachable(request, target))) {
        test.skip(true, unreachableReason(target));
        return;
      }

      // Counting series that actually CARRY http_route, not just any series:
      // on a pre-2.0.0 service there is no http_route label at all, so the
      // filters below would be empty and this test would pass vacuously.
      const scrape = await pollForSeries(
        request,
        target,
        (s) =>
          samplesOf(s.samples, REQUESTS_TOTAL).filter(
            (sample) => sample.labels.http_route !== undefined,
          ).length,
        `${REQUESTS_TOTAL} should expose at least one series carrying http_route`,
      );
      const routes = labelValues(samplesOf(scrape.samples, REQUESTS_TOTAL), 'http_route');

      const expanded = routes.filter((route) =>
        EXPANDED_VALUE_PATTERNS.some((pattern) => pattern.test(route)),
      );
      expect(
        expanded,
        'http_route must record the TEMPLATE (e.g. /api/v1/storefront/{shopSlug}), never the ' +
          'expanded value — an id in the label is an unbounded series',
      ).toEqual([]);

      // Health probes and /metrics are deliberately excluded from the
      // middleware; they scrape constantly and would drown real traffic.
      const excludedLeaks = routes.filter(
        (route) => route.startsWith('/health') || route === '/metrics',
      );
      expect(
        excludedLeaks,
        'health paths and /metrics are excluded from the metrics middleware',
      ).toEqual([]);

      test.info().annotations.push({
        type: 'info',
        description: `${routes.length} distinct http_route values: ${routes.slice(0, 12).join(', ')}`,
      });
    });

    test('requests rejected before the endpoint (401) are counted @critical', async ({ request }) => {
      // The auth-ordering regression: the metrics middleware used to sit BELOW
      // auth, so 401/403/429 were never counted at all.
      const probe = await driveUnmatchedRequest(request, target.baseUrl);
      if (probe.status === null) {
        test.skip(true, unreachableReason(target));
        return;
      }

      const observed = [probe.status];
      if (probe.status !== 401) {
        const withBadToken = await request
          .get(`${target.baseUrl}/api/v1/${probe.token}`, {
            headers: { Authorization: 'Bearer e2e-invalid-token' },
            timeout: 20_000,
          })
          .catch(() => null);
        if (withBadToken) observed.push(withBadToken.status());
      }

      if (!observed.includes(401)) {
        test.skip(
          true,
          `${target.name} produced no 401 for the probe requests (statuses: ${observed.join(', ')}), ` +
            'so the auth-ordering assertion has nothing to verify here',
        );
        return;
      }

      await pollForSeries(
        request,
        target,
        (s) =>
          samplesOf(s.samples, REQUESTS_TOTAL).filter((sample) => sample.labels.status_code === '401')
            .length,
        'a request rejected with 401 must still be counted — the metrics middleware now sits ABOVE ' +
          'auth, so 401/403/429 are recorded instead of silently dropped',
      );
    });
  });
}
