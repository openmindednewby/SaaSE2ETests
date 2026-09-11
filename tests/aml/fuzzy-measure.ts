// AM-READY-5 §3.2 — the measurement leg: transport, retry/backoff, and the summary print.
//
// 🔴 WHY THIS DOES NOT GO THROUGH `screen()` FROM aml-helpers. That helper returns `null` for BOTH a
// transport failure and a rejected call, so "the service is down", "I was throttled" and "my key was
// refused" collapse into one outcome. This estate has a named precedent for exactly that conflation:
// a fetcher returning null for both 404 and 429 turned throttling into silent data loss. Here the
// STATUS CODE is read and recorded, so a 429 names itself and is never reported as "unreachable".
//
// 🔴 WHY BACKOFF AND CONCURRENCY 1. Traefik SNATs every client to one source IP, so a per-IP limit is
// ONE GLOBAL BUCKET shared with every other caller — the GDELT seed included. ~80 sequential screens
// can trip a limit that three curls never will, and other traffic counts against this run.
import type { APIRequestContext } from '@playwright/test';
import { AML_API_KEY, AML_API_URL } from './aml-helpers.js';

const SCREEN_PATH = '/v1/screenings/check';
const CREATED = 201;
// 🔴 409 IS *NOT* "duplicate subject". Two agents in a row read it that way; the controller says
// otherwise. PROOViD/AMLService/AMLService/API/Controllers/ScreeningController.cs:182-183 — FR-3
// (#381): a well-formed but INSUFFICIENT_DATA applicant identity (a lone mononym with no DoB or
// nationality), deliberately distinct from the 400 malformed-request path. So a persistent 409 is a
// statement about the QUERY SHAPE, never about throttling and never about a duplicate. It stays
// retryable because a retry costs one request and the ledger records the code either way; when it
// persists the row is UNOBSERVED — not a hit, not a miss. Ledger from the settling run: 201x77,
// 409x5, 429x0, zero transport errors.
const RETRYABLE = new Set([409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1_500;
const INTER_REQUEST_MS = 150;
const REQUEST_TIMEOUT_MS = 30_000;
const MS_PER_S = 1000;
const P50 = 0.5;
const P95 = 0.95;

export interface Screened {
  readonly query: string;
  readonly matchedNames: string[];
  readonly matchCount: number;
  readonly latencyMs: number;
  /** The SERVED adverse-media status. Asking for the stage is not evidence that it ran. */
  readonly adverseMediaStatus: string | null;
  /** COV-12: names the scorer FOUND and policy then withheld from `matchedEntities`. Never summed in. */
  readonly suppressedNames: string[];
  /** COV-12 `suppressedDeceasedCount`, verbatim — the REASON a found row is not in the visible list. */
  readonly suppressedDeceasedCount: number;
}

/** Every non-201 outcome seen across the whole run, so throttling is REPORTED, not inferred. */
export interface TransportLedger {
  /** status -> how many times it came back. A 429 here is the throttle observation. */
  readonly statuses: Map<number, number>;
  /** Transport failures (no response at all), with the error text. */
  readonly transportErrors: string[];
  /** `Retry-After` values observed on a 429, verbatim. */
  readonly retryAfter: string[];
  /** Queries that never produced a screening. Named, never silently dropped from a denominator. */
  readonly unobserved: string[];
}

export const ledger: TransportLedger = {
  statuses: new Map<number, number>(),
  transportErrors: [],
  retryAfter: [],
  unobserved: [],
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

interface Attempt {
  readonly status: number | null;
  readonly body: {
    matchedEntities?: { matchedName?: string | null }[];
    suppressedMatches?: { matchedName?: string | null }[];
    suppressedDeceasedCount?: number;
    adverseMediaStatus?: string | null;
  } | null;
  readonly error: string | null;
  readonly retryAfter: string | null;
}

async function attempt(
  ctx: APIRequestContext,
  query: string,
  extra: Record<string, unknown>,
): Promise<Attempt> {
  try {
    const res = await ctx.post(`${AML_API_URL}${SCREEN_PATH}`, {
      data: { fullName: query, ...extra },
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': AML_API_KEY ?? '',
        Authorization: `Bearer ${AML_API_KEY ?? ''}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const status = res.status();
    const retryAfter = res.headers()['retry-after'] ?? null;
    const body = status === CREATED ? await res.json() : null;
    return { status, body, error: null, retryAfter };
  } catch (error) {
    return { status: null, body: null, error: (error as Error).message, retryAfter: null };
  }
}

/**
 * One screening, with exponential backoff on a retryable status or a transport error. Throws only
 * after MAX_ATTEMPTS, and the message NAMES the last status — never a bare "unreachable".
 */
export async function screenOne(
  ctx: APIRequestContext,
  query: string,
  extra: Record<string, unknown> = {},
): Promise<Screened | null> {
  const started = Date.now();
  let last = '';
  for (let tries = 0; tries < MAX_ATTEMPTS; tries += 1) {
    const result = await attempt(ctx, query, extra);
    if (result.status !== null) {
      ledger.statuses.set(result.status, (ledger.statuses.get(result.status) ?? 0) + 1);
      if (result.retryAfter) ledger.retryAfter.push(result.retryAfter);
    } else if (result.error) {
      ledger.transportErrors.push(`${query}: ${result.error}`);
    }

    if (result.status === CREATED && result.body) {
      const entities = result.body.matchedEntities ?? [];
      const withheld = result.body.suppressedMatches ?? [];
      await sleep(INTER_REQUEST_MS);
      return {
        query,
        matchedNames: entities.map(entity => String(entity.matchedName ?? '')),
        matchCount: entities.length,
        latencyMs: Date.now() - started,
        adverseMediaStatus: result.body.adverseMediaStatus ?? null,
        suppressedNames: withheld.map(entity => String(entity.matchedName ?? '')),
        suppressedDeceasedCount: result.body.suppressedDeceasedCount ?? 0,
      };
    }

    last =
      result.status === null
        ? `transport error (${result.error})`
        : `HTTP ${result.status}${result.retryAfter ? ` retry-after=${result.retryAfter}` : ''}`;
    if (result.status !== null && !RETRYABLE.has(result.status)) break;
    await sleep(BACKOFF_BASE_MS * Math.pow(2, tries));
  }
  // A row that could not be screened is UNOBSERVED: not a hit, not a miss. It is recorded by name so
  // a shrinking denominator cannot quietly make a recall floor easier to clear.
  ledger.unobserved.push(query + ' (' + last + ')');
  return null;
}

/** Strictly sequential — the target is shared staging behind one SNAT bucket, not a load rig. */
export async function screenAll(ctx: APIRequestContext, queries: string[]): Promise<(Screened | null)[]> {
  const out: (Screened | null)[] = [];
  for (const query of queries) out.push(await screenOne(ctx, query));
  return out;
}

export function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/**
 * Print the ledger and the latency distribution to the run log. A number that only lives inside an
 * assertion message is invisible when the assertion passes.
 */
export function reportTransport(rows: Screened[], label = 'adverse media OFF'): void {
  const statuses = [...ledger.statuses.entries()].map(([code, count]) => `${code}x${count}`).join(' ');
  const latencies = rows.map(row => row.latencyMs).sort((a, b) => a - b);
  const p50 = quantile(latencies, P50) / MS_PER_S;
  const p95 = quantile(latencies, P95) / MS_PER_S;
  console.log(`[fuzzy] transport ledger: ${statuses || '(none)'}`);
  console.log(`[fuzzy] retry-after seen: ${ledger.retryAfter.join(', ') || '(none)'}`);
  console.log('[fuzzy] transport errors: ' + ledger.transportErrors.length);
  const withheld = rows.filter(row => row.suppressedNames.length > 0);
  console.log(
    `[fuzzy] rows carrying SUPPRESSED matches: ${withheld.length} — ` +
      (withheld.map(row => `'${row.query}'x${row.suppressedDeceasedCount}`).join(' ') || '(none)'),
  );
  console.log('[fuzzy] UNOBSERVED (no screening created): ' + (ledger.unobserved.join(' | ') || '(none)'));
  console.log(
    `[fuzzy] screen latency over ${latencies.length} SEQUENTIAL requests, ${label}: ` +
      `p50 ${p50.toFixed(2)}s p95 ${p95.toFixed(2)}s`,
  );
}
