/**
 * Canary-prefix helpers — the E2E side of the Phase 2 canary infrastructure
 * (see `BaseClient/docs/Tasks/IN_PROGRESS/phase-2-canary-infrastructure.md`).
 *
 * When running against staging/prod, the canary `global-setup.canary.ts` sets
 * the following env vars at process start:
 *
 *   E2E_CANARY_RUN_ID         — full UUID (e.g. "a1b2c3d4-e5f6-...")
 *   E2E_CANARY_PREFIX         — `e2ec-${runId.slice(0,8)}-` (e.g. "e2ec-a1b2c3d4-")
 *   E2E_CANARY_ACCESS_TOKEN   — superUser JWT (consumed by the auth fixture)
 *   E2E_CANARY_REFRESH_TOKEN  — refresh token for token-rotation mid-run
 *
 * These functions are the public surface every test / helper / page object
 * should use when creating data that the canary cleanup endpoints will sweep
 * by name prefix. In local mode (no canary), `canaryName()` returns the
 * passed-in name unchanged — existing tests are unaffected.
 *
 * The shape mirrors the parent design's "Identification scheme" section:
 *   Tenant: `e2ec-a1b2c3d4-TenantA`
 *   Menu:   `e2ec-a1b2c3d4-My Test Menu`
 *   etc.
 */

/**
 * Returns the configured canary prefix string, or empty when canary mode is
 * disabled. Prefix shape: `e2ec-{runId8}-` where `runId8` is the first 8 hex
 * chars of the full run UUID.
 */
export function getCanaryPrefix(): string {
  return process.env.E2E_CANARY_PREFIX ?? '';
}

/**
 * Returns the full canary run UUID, or `undefined` when canary mode is
 * disabled. Used by the global-teardown to address the per-service
 * `?runId={uuid}` cleanup endpoints.
 */
export function getCanaryRunId(): string | undefined {
  const raw = process.env.E2E_CANARY_RUN_ID;
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * Returns the 8-char short form of the run UUID, or `undefined` when canary
 * mode is disabled. The short form is what services persist (e.g.
 * `NotificationEntity.CanaryRunIdShort`, `Subscription.Description` suffix).
 */
export function getCanaryRunIdShort(): string | undefined {
  const full = getCanaryRunId();
  return full ? full.slice(0, 8) : undefined;
}

/**
 * Returns true when `global-setup.canary.ts` has populated the run-ID env vars,
 * false otherwise (e.g. `E2E_TARGET=local` where canary mode is a no-op).
 */
export function isCanaryMode(): boolean {
  return Boolean(getCanaryRunId());
}

/**
 * Prefix the given name with the canary prefix when canary mode is active.
 * Returns the name unchanged when canary mode is off (local target).
 *
 * Use this for tenant names, user usernames, menu names, template names —
 * anything that goes into a backend `Name` column and that the cleanup
 * endpoint sweeps by `StartsWith("e2ec-{runId8}-")`.
 *
 *   canaryName('TenantA')        // → 'e2ec-a1b2c3d4-TenantA' (canary mode)
 *   canaryName('TenantA')        // → 'TenantA' (local mode)
 */
export function canaryName(baseName: string): string {
  return `${getCanaryPrefix()}${baseName}`;
}

/**
 * Returns the superUser access token minted ONCE by `global-setup.canary.ts`,
 * or `undefined` when canary mode is off (no setup ran) or the mint failed.
 *
 * KI-2 fix (see `phase-1-staging-e2e-retriage.md`): identity-api rate-limits
 * `/auth/*` (~5 req/window, no `Retry-After`). A `--workers=1` suite that does
 * its own `/auth/login` per spec/worker trips the limiter. Helpers that need a
 * superUser-scoped token (e.g. `realm-token-helper.ts`'s legacy-realm path)
 * should call THIS first and only fall back to a fresh `/auth/login` when it
 * returns `undefined` — so in canary mode `/auth/login` is hit exactly once,
 * in `global-setup.canary.ts`.
 *
 * The token is the `onlinemenu`/`OnlineMenu`-realm superUser (from
 * `SUPERUSER_*` or `TEST_USER_*`). Only reuse it for call-sites that need a
 * superUser identity — NOT for tenant-isolation / per-tenant-claim specs that
 * deliberately need distinct tenant identities.
 */
export function getCanarySuperUserToken(): string | undefined {
  const token = process.env.E2E_CANARY_ACCESS_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

/**
 * Returns the canary HTTP headers — `X-Canary-Run-Id` + `Authorization` —
 * to be merged into outbound API requests, or an empty object when canary
 * mode is off. Designed to spread into axios / fetch / APIRequestContext
 * header objects:
 *
 *   axios.create({ headers: { ...canaryHeaders(), 'X-Realm': 'OnlineMenu' } })
 *
 * The auth header is included ONLY when both the run-id and access token are
 * populated; this keeps the helper safe to call from places that already do
 * their own auth (the access token, when present, takes precedence — but
 * callers can override by setting `Authorization` after the spread).
 */
export function canaryHeaders(): Record<string, string> {
  const runId = getCanaryRunId();
  if (!runId) return {};
  const headers: Record<string, string> = { 'X-Canary-Run-Id': runId };
  const token = process.env.E2E_CANARY_ACCESS_TOKEN;
  if (token && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
