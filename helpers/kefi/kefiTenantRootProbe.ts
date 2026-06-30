/**
 * Tenant-ROOT probe + sibling-root regression sweep (#160 / 429-storm fix).
 *
 * The publish Job rebuilds the WHOLE kefi-landings image: getStaticPaths fans
 * out one fetch per published tenant for the landing AND the events list. Done
 * naively that fan-out tripped kefi-api's rate limiter (HTTP 429); both fetches
 * then fell back to null and the tenant's `/t/<slug>/index.html` was never
 * emitted → its ROOT 403'd (while a per-event page still 200'd).
 *
 * Why the old kefi-free-publish assertion gave false confidence: it only ever
 * checked the CANARY's own root, and request ordering meant the canary (whose
 * publish triggered the build) usually still won its fetch even while OTHER
 * tenants 429'd — so the bug was systemic but invisible to a single-slug check.
 *
 * Two assertions here close that gap:
 *   - `expectTenantRootServes200`  — explicit, retried 200 check of one root.
 *   - `sweepSiblingTenantRoots`    — after the rebuild, assert EVERY sampled
 *     config-only sibling root still serves 200. A settled 403/404 = the build
 *     dropped that tenant's index.html = the exact regression.
 */

import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR_FLOOR = 500;
const DEFAULT_ROOT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const SIBLING_SAMPLE_LIMIT = 8;
const SIBLING_SETTLE_ATTEMPTS = 4;
const SIBLING_SETTLE_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Canary tenant slugs are namespaced `e2c-…`; excluded from the sibling sweep. */
const CANARY_SLUG_PREFIX = 'e2c-';

export interface RootProbe {
  slug: string;
  status: number;
  url: string;
}

function rootUrl(webUrl: string, slug: string): string {
  return `${webUrl.replace(/\/+$/, '')}/t/${slug}/`;
}

/** GETs `url` and returns the HTTP status, or 0 on a network/timeout blip. */
async function statusOf(url: string): Promise<number> {
  try {
    const resp = await axios.get<string>(url, {
      httpsAgent: sharedHttpsAgent,
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: () => true,
    });
    return resp.status;
  } catch {
    return 0;
  }
}

/** True while a status is still "in flight" (network blip / mid-rollout 5xx). */
function isTransient(status: number): boolean {
  return status === 0 || status >= HTTP_SERVER_ERROR_FLOOR;
}

/**
 * Polls one tenant ROOT (`/t/<slug>/`) until it serves 200, retrying through
 * the kefi-landings rollout (which can briefly 502 / serve a stale image).
 * Throws on timeout — a lingering 403 means the build dropped the root.
 */
export async function expectTenantRootServes200(
  slug: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<RootProbe> {
  const { webUrl } = getKefiUrls();
  const url = rootUrl(webUrl, slug);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ROOT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = await statusOf(url);
    if (last === HTTP_OK) {
      return { slug, status: last, url };
    }
    await delay(pollIntervalMs);
  }
  const hint =
    last === HTTP_FORBIDDEN
      ? ` (403 ⇒ /t/${slug}/index.html missing — the build-time 429 storm dropped the root)`
      : '';
  throw new Error(
    `[kefiTenantRootProbe] root ${url} never served 200 within ${String(timeoutMs)}ms — last status ${String(last)}${hint}`,
  );
}

/**
 * Fetches the config-only published-tenant slugs from the discovery list
 * (GET /api/v1/t), minus the canary orphans (`e2c-…`) and any explicit
 * exclusions. Returns [] on any non-200 / malformed response (never throws) so
 * the sweep degrades to a no-op rather than failing the spec spuriously.
 */
export async function fetchConfigTenantSlugs(exclude: readonly string[] = []): Promise<string[]> {
  const { apiUrl } = getKefiUrls();
  const url = `${apiUrl.replace(/\/+$/, '')}/api/v1/t`;
  try {
    const resp = await axios.get<{ slug?: unknown }[]>(url, {
      httpsAgent: sharedHttpsAgent,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (resp.status !== HTTP_OK || !Array.isArray(resp.data)) {
      return [];
    }
    const exclusions = new Set(exclude);
    return resp.data
      .map((t) => (typeof t?.slug === 'string' ? t.slug : ''))
      .filter(
        (slug) => slug.length > 0 && !slug.startsWith(CANARY_SLUG_PREFIX) && !exclusions.has(slug),
      );
  } catch {
    return [];
  }
}

/** Polls one sibling root through transient states until it settles, then returns it. */
async function settleRoot(webUrl: string, slug: string): Promise<RootProbe> {
  const url = rootUrl(webUrl, slug);
  let status = 0;
  for (let attempt = 0; attempt < SIBLING_SETTLE_ATTEMPTS; attempt += 1) {
    status = await statusOf(url);
    if (!isTransient(status)) {
      return { slug, status, url };
    }
    await delay(SIBLING_SETTLE_INTERVAL_MS);
  }
  return { slug, status, url };
}

/**
 * Regression sweep — after the canary's publish rebuilt the whole kefi-landings
 * image, probe a sample of config-only SIBLING tenant roots. Any that settle on
 * 403/404 had their `index.html` dropped by the build (the 429 storm). Returns
 * the full probe list plus the offenders so the spec can assert `forbidden` is
 * empty. Never throws; a degraded discovery list simply yields an empty sweep.
 */
export async function sweepSiblingTenantRoots(input: {
  excludeSlugs: readonly string[];
  sampleLimit?: number;
}): Promise<{ probed: RootProbe[]; forbidden: RootProbe[] }> {
  const { webUrl } = getKefiUrls();
  const slugs = (await fetchConfigTenantSlugs(input.excludeSlugs)).slice(
    0,
    input.sampleLimit ?? SIBLING_SAMPLE_LIMIT,
  );
  const probed: RootProbe[] = [];
  for (const slug of slugs) {
    probed.push(await settleRoot(webUrl, slug));
  }
  const forbidden = probed.filter(
    (p) => p.status === HTTP_FORBIDDEN || p.status === HTTP_NOT_FOUND,
  );
  return { probed, forbidden };
}
