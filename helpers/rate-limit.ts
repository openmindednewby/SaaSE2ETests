/**
 * Rate-limit-aware retry helpers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Against `E2E_TARGET=staging` (and prod), the IdentityService `/auth/*`
 * endpoints are fronted by Keycloak's brute-force / rate-limiting protection.
 * A sequential `--workers=1` identity suite fires 50+ logins in a few minutes
 * from a single source IP, so the limiter intermittently returns HTTP 429
 * mid-run. That is an environment artifact of running a dense suite against a
 * shared cluster — NOT a product bug.
 *
 * The honest mitigation is a bounded retry that respects the `Retry-After`
 * header. A request that is *still* 429 after all retries is surfaced as a
 * real failure, so a genuinely broken limiter is never masked.
 *
 * TWO SHAPES OF 429
 * -----------------
 * 1. Axios with default `validateStatus` THROWS an `AxiosError` on 429.
 *    → use {@link withRateLimitRetry}.
 * 2. Axios with `validateStatus: () => true` (and Playwright's
 *    `APIRequestContext`) returns 429 as a normal response object.
 *    → use {@link retryWhileRateLimited}, which inspects a status accessor.
 *
 * Follow-up (not this pickup): the proper root-cause fix is tuning the staging
 * Keycloak brute-force / per-client rate-limit thresholds, or having the suite
 * mint one token and reuse it, rather than logging in per-spec. Tracked as a
 * known issue in the Phase 1 follow-up task doc.
 */
import { setTimeout as delay } from 'timers/promises';

/** Max retry attempts after the initial try (so 1 + N total requests). */
export const RATE_LIMIT_MAX_RETRIES = 4;

const RATE_LIMIT_DEFAULT_BACKOFF_MS = 2000;
const RATE_LIMIT_MAX_BACKOFF_MS = 30_000;

/**
 * Resolves the wait before the next retry. Honours a `Retry-After` value
 * (seconds) when present; otherwise falls back to capped exponential backoff
 * (2s, 4s, 8s, 16s, capped at 30s).
 */
export function rateLimitBackoffMs(retryAfterRaw: unknown, attempt: number): number {
  const retryAfter = Number(retryAfterRaw);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, RATE_LIMIT_MAX_BACKOFF_MS);
  }
  return Math.min(RATE_LIMIT_DEFAULT_BACKOFF_MS * 2 ** attempt, RATE_LIMIT_MAX_BACKOFF_MS);
}

/** True when the value looks like an error carrying an HTTP 429 response. */
function isRateLimitError(error: unknown): error is { response: { status: number; headers?: Record<string, unknown> } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { status?: unknown } }).response?.status === 'number' &&
    (error as { response: { status: number } }).response.status === 429
  );
}

/**
 * Runs `fn`, retrying ONLY when it throws an error whose `.response.status`
 * is 429. Any other error propagates immediately. Use for axios calls that
 * rely on the default `validateStatus` (i.e. that throw on non-2xx).
 */
export async function withRateLimitRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!isRateLimitError(error) || attempt >= RATE_LIMIT_MAX_RETRIES) throw error;
      const retryAfter = error.response.headers?.['retry-after'];
      const backoff = rateLimitBackoffMs(retryAfter, attempt);
      process.stdout.write(
        `[rate-limit] ${label} got 429, retry ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES} after ${backoff}ms\n`,
      );
      await delay(backoff);
    }
  }
}

/**
 * Runs `fn` (which returns a response object), retrying while the response's
 * status — read via `getStatus` — is 429. Use for axios calls with
 * `validateStatus: () => true` and for Playwright `APIRequestContext`
 * responses, where a 429 comes back as a normal response rather than a throw.
 *
 * `getRetryAfter` optionally extracts the `Retry-After` header from the
 * response for `Retry-After`-aware backoff; when omitted, exponential backoff
 * is used. The final (possibly still-429) response is returned so the caller's
 * own assertion surfaces a persistent limiter as a real failure.
 */
export async function retryWhileRateLimited<R>(
  label: string,
  fn: () => Promise<R>,
  getStatus: (response: R) => number,
  getRetryAfter?: (response: R) => unknown,
): Promise<R> {
  let response = await fn();
  for (let attempt = 0; getStatus(response) === 429 && attempt < RATE_LIMIT_MAX_RETRIES; attempt++) {
    const backoff = rateLimitBackoffMs(getRetryAfter?.(response), attempt);
    process.stdout.write(
      `[rate-limit] ${label} got 429, retry ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES} after ${backoff}ms\n`,
    );
    await delay(backoff);
    response = await fn();
  }
  return response;
}
