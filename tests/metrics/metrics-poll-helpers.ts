/**
 * Polling helpers for the metrics contract suite.
 *
 * WHY POLL AT ALL
 * ---------------
 * Metric families with labels emit NOTHING until the first matching request,
 * so traffic must be generated before scraping. But a single drive-then-scrape
 * is not sound against a real cluster: a service may run several replicas, and
 * during a rolling deploy the probe and the scrape can land on DIFFERENT pods —
 * the probe is counted somewhere the scrape never looks. Observed on
 * identity-api mid-rollout: three assertions failed, then the same counters
 * reconciled minutes later with every probe accounted for.
 *
 * So each assertion re-drives AND re-scrapes until the series appears, rather
 * than assuming one instance and an instant flush. This is `expect.poll` — an
 * auto-retrying assertion — not an arbitrary wait.
 */

import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { driveUnmatchedRequest, scrapeMetrics } from '../../helpers/metrics-contract.js';
import type { MetricsScrape, MetricsTarget } from '../../helpers/metrics-contract.js';

/** Label keys `http_unmatched_requests_total` is allowed to carry. */
export const UNMATCHED_ALLOWED_LABELS = ['app', 'method'];

/** Route-label shapes that would mean an expanded value leaked in as a template. */
export const EXPANDED_VALUE_PATTERNS = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /\d{6,}/,
];

const POLL_TIMEOUT_MS = 45_000;
const POLL_INTERVALS_MS = [500, 1000, 2000, 3000, 5000];

/**
 * Drive traffic and scrape until `count` reports a non-zero number of matching
 * series, returning the scrape that satisfied it. Every iteration issues a
 * FRESH request, so a probe lost to another replica is simply retried.
 */
export async function pollForSeries(
  request: APIRequestContext,
  target: MetricsTarget,
  count: (scrape: MetricsScrape) => number,
  what: string,
): Promise<MetricsScrape> {
  let latest: MetricsScrape | null = null;

  await expect
    .poll(
      async () => {
        await driveUnmatchedRequest(request, target.baseUrl);
        const scrape = await scrapeMetrics(request, target.baseUrl);
        if (!scrape || scrape.status !== 200) return 0;
        latest = scrape;
        return count(scrape);
      },
      {
        message: `${target.name}: ${what} (scraping ${target.baseUrl}/metrics)`,
        timeout: POLL_TIMEOUT_MS,
        intervals: POLL_INTERVALS_MS,
      },
    )
    .toBeGreaterThan(0);

  if (!latest) throw new Error(`${target.name}: poll succeeded but no scrape was captured`);
  return latest;
}

/** True when the service answered at all — distinguishes "unreachable" from "contract broken". */
export async function isReachable(
  request: APIRequestContext,
  target: MetricsTarget,
): Promise<boolean> {
  const probe = await driveUnmatchedRequest(request, target.baseUrl);
  return probe.status !== null;
}

export function unreachableReason(target: MetricsTarget): string {
  return `${target.name} unreachable at ${target.baseUrl} (${target.envVar})`;
}
