/**
 * Metrics contract helpers — `Metrics.Client` 2.0.0 exposition parsing.
 *
 * The shared `Metrics.Client` NuGet package instruments ~11 backend services.
 * 2.0.0 changed the exposed CONTRACT, and each change is a regression worth
 * asserting from the outside:
 *
 *  1. BOUNDED ROUTE LABEL. `http_route` records the route TEMPLATE
 *     (`/api/v1/storefront/{shopSlug}`), and the literal `"unmatched"` for any
 *     request that matched no route. Previously the raw request path was used,
 *     so every 404 URL minted a permanent time series (~14 series each). The
 *     404 RATE moved to a separate low-cardinality counter,
 *     `http_unmatched_requests_total{app,method}`.
 *  2. LABEL RENAME. `service` -> `app`, `endpoint` -> `http_route`. The old
 *     names collide with Prometheus' own Kubernetes target labels, so
 *     Prometheus silently renamed ours to `exported_service` /
 *     `exported_endpoint` — a dashboard grouping by `endpoint` was really
 *     grouping by the port number "8080".
 *  3. NO DUPLICATE INSTRUMENTATION. prometheus-net's built-in
 *     `UseHttpMetrics()` was removed, so `http_requests_received_total` and
 *     `http_requests_in_progress` must not be emitted.
 *
 * Health paths (`/health*`) and `/metrics` itself are deliberately EXCLUDED
 * from the metrics middleware, so they must NOT appear as `http_route` values.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Metric family names owned by the shared package. */
export const REQUESTS_TOTAL = 'http_requests_total';
export const UNMATCHED_TOTAL = 'http_unmatched_requests_total';

/** The literal `http_route` value recorded for any request that matched no route. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Prefix shared by every probe path this suite issues. Asserting that the
 * PREFIX appears nowhere in an exposition is strictly stronger than checking a
 * single token: it catches every probe the suite has ever sent to that
 * instance, including retries from an earlier poll iteration.
 */
export const PROBE_PREFIX = 'e2e-metrics-probe-';

/** Label names the 2.0.0 contract requires on `http_requests_total`. */
export const REQUIRED_REQUEST_LABELS = ['app', 'http_route', 'method', 'status_code'] as const;

/**
 * Label names retired in 2.0.0. They collide with Prometheus' own target
 * labels, so their presence means the service is still on the old package.
 */
export const RETIRED_LABELS = ['service', 'endpoint'] as const;

/**
 * Metric families emitted by prometheus-net's built-in `UseHttpMetrics()`.
 * Their presence means the duplicate instrumentation is back.
 *
 * NOTE: `http_requests_in_flight` is OURS and is expected — the built-in gauge
 * is `http_requests_in_progress`. The two differ by one word; matching loosely
 * here would flag the correct gauge as a defect.
 */
export const DUPLICATE_FAMILIES = ['http_requests_received_total', 'http_requests_in_progress'] as const;

/** Prometheus' collision-rename prefix applied to labels that clash with target labels. */
export const EXPORTED_LABELS = ['exported_service', 'exported_endpoint'] as const;

/** A single parsed sample line from the Prometheus text exposition format. */
export interface MetricSample {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: string;
}

/** A service under test, resolved from the environment. */
export interface MetricsTarget {
  /** Short, stable id used by `METRICS_CONTRACT_SERVICES` (e.g. `agora-api`). */
  readonly name: string;
  /** The env var the base URL came from, quoted in skip reasons. */
  readonly envVar: string;
  readonly baseUrl: string;
}

/**
 * Every backend whose base URL the E2E env files already declare. A target is
 * only tested when its env var is set, so a partial `.env.<target>` narrows the
 * run instead of failing it.
 */
const KNOWN_TARGET_ENV_VARS: ReadonlyArray<readonly [string, string]> = [
  ['agora-api', 'AGORA_API_URL'],
  ['ichnos-api', 'ICHNOS_API_URL'],
  ['identity-api', 'IDENTITY_API_URL'],
  ['questioner-api', 'QUESTIONER_API_URL'],
  ['onlinemenu-api', 'ONLINEMENU_API_URL'],
  ['content-api', 'CONTENT_API_URL'],
  ['payment-api', 'PAYMENT_API_URL'],
  ['kefi-api', 'KEFI_API_URL'],
  ['digitalkin-api', 'DIGITALKIN_API_URL'],
];

/**
 * Services whose 2.0.0 contract is ENFORCED (hard assertions), as a
 * comma-separated list of target names in `METRICS_CONTRACT_SERVICES`.
 *
 * The allowlist is deliberately env-driven rather than detected: if the suite
 * decided what to enforce by sniffing the exposition, a service that ROLLED
 * BACK to the old package would silently downgrade itself to "skipped" instead
 * of failing. Detection reports; the allowlist decides.
 */
export function enforcedServiceNames(): string[] {
  const raw = (process.env.METRICS_CONTRACT_SERVICES ?? 'agora-api').trim();
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normaliseBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function parseTargetOverride(override: string): MetricsTarget[] {
  return override
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes('='))
    .map((entry) => {
      const separator = entry.indexOf('=');
      return {
        name: entry.slice(0, separator).trim(),
        envVar: 'METRICS_E2E_TARGETS',
        baseUrl: normaliseBaseUrl(entry.slice(separator + 1)),
      };
    })
    .filter((target) => target.name.length > 0 && target.baseUrl.length > 0);
}

/**
 * Resolve every metrics target from the environment.
 *
 * `METRICS_E2E_TARGETS` overrides the derived list entirely, as a comma-
 * separated list of `name=url` pairs — for pointing the suite at a service the
 * env files do not know about. Nothing is hardcoded to a single host.
 */
export function resolveMetricsTargets(): MetricsTarget[] {
  const override = (process.env.METRICS_E2E_TARGETS ?? '').trim();
  if (override) return parseTargetOverride(override);

  return KNOWN_TARGET_ENV_VARS.flatMap(([name, envVar]) => {
    const value = process.env[envVar];
    if (!value || !value.trim()) return [];
    return [{ name, envVar, baseUrl: normaliseBaseUrl(value) }];
  });
}

/** Parse one label block. Handles `\"` and `\\` escapes in label values. */
function parseLabels(block: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match = pattern.exec(block);
  while (match !== null) {
    labels[match[1]] = match[2].replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char));
    match = pattern.exec(block);
  }
  return labels;
}

/** Parse a Prometheus text exposition body into samples (comment lines dropped). */
export function parseExposition(body: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withLabels = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\{(.*)\}\s+(.+)$/.exec(line);
    if (withLabels) {
      samples.push({
        name: withLabels[1],
        labels: parseLabels(withLabels[2]),
        value: withLabels[3].trim(),
      });
      continue;
    }

    const bare = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(.+)$/.exec(line);
    if (bare) samples.push({ name: bare[1], labels: {}, value: bare[2].trim() });
  }
  return samples;
}

/** All samples belonging to one metric family. */
export function samplesOf(samples: readonly MetricSample[], family: string): MetricSample[] {
  return samples.filter((sample) => sample.name === family);
}

/** Every distinct value of a label across a set of samples. */
export function labelValues(samples: readonly MetricSample[], label: string): string[] {
  return [
    ...new Set(
      samples.map((sample) => sample.labels[label]).filter((value): value is string => value !== undefined),
    ),
  ];
}

/** True when a family appears in the exposition, whether or not it has samples yet. */
export function hasFamily(samples: readonly MetricSample[], body: string, family: string): boolean {
  return samplesOf(samples, family).length > 0 || body.includes(`# TYPE ${family} `);
}

export interface MetricsScrape {
  readonly body: string;
  readonly samples: MetricSample[];
  readonly status: number;
}

/**
 * Scrape a service's `/metrics`. It is AllowAnonymous, so no auth is needed.
 * Returns null on a connection error so a caller can `test.skip` with an
 * honest "unreachable" reason instead of reporting a contract failure.
 */
export async function scrapeMetrics(
  request: APIRequestContext,
  baseUrl: string,
): Promise<MetricsScrape | null> {
  let response: APIResponse;
  try {
    response = await request.get(`${baseUrl}/metrics`, { timeout: 20_000 });
  } catch {
    return null;
  }
  if (!response.ok()) return { body: '', samples: [], status: response.status() };

  const body = await response.text();
  return { body, samples: parseExposition(body), status: response.status() };
}

/**
 * True when a scrape shows the 2.0.0 contract (new label names present, old
 * ones gone). Used to REPORT rollout state — never to decide pass/fail.
 */
export function looksLikeV2Contract(scrape: MetricsScrape): boolean {
  const requests = samplesOf(scrape.samples, REQUESTS_TOTAL);
  if (requests.length === 0) return false;
  const hasNewLabels = requests.every(
    (sample) => sample.labels.app !== undefined && sample.labels.http_route !== undefined,
  );
  const hasOldLabels = requests.some((sample) =>
    RETIRED_LABELS.some((label) => sample.labels[label] !== undefined),
  );
  return hasNewLabels && !hasOldLabels;
}

/**
 * Drive one request at a path that matches no route, with a token unique to
 * this call. Metric families with labels emit NOTHING until the first matching
 * request, so traffic must be generated in the same test that scrapes.
 *
 * The token is what the cardinality-leak assertion searches the exposition for
 * — if it appears anywhere, the raw path leaked back into a label.
 */
export async function driveUnmatchedRequest(
  request: APIRequestContext,
  baseUrl: string,
): Promise<{ token: string; path: string; status: number | null }> {
  const token = `${PROBE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `/${token}/leak-check`;
  try {
    const response = await request.get(`${baseUrl}${path}`, { timeout: 20_000 });
    return { token, path, status: response.status() };
  } catch {
    return { token, path, status: null };
  }
}
