/**
 * E2E target helpers — a thin, well-named wrapper over the `E2E_TARGET`
 * environment variable so specs can guard environment-specific behaviour
 * without sprinkling `process.env.E2E_TARGET === 'staging'` string literals
 * everywhere.
 *
 * `E2E_TARGET` is set by the invocation (`E2E_TARGET=staging npx playwright
 * test ...`) and defaults to `'local'`. See `fixtures/env-loader.ts` for the
 * full loading semantics.
 *
 * Typical use in a spec:
 *
 *   import { isStagingTarget } from '../../helpers/target.js';
 *
 *   test.describe('Login Flow', () => {
 *     test.skip(
 *       isStagingTarget() && firefox,
 *       'Firefox cannot resolve staging hostnames without a hosts-file edit',
 *     );
 *   });
 */

export type E2ETarget = 'local' | 'staging' | 'prod';

/** Returns the active E2E target. Defaults to `'local'` when unset. */
export function e2eTarget(): E2ETarget {
  const raw = (process.env.E2E_TARGET ?? 'local').trim();
  return raw === 'staging' || raw === 'prod' ? raw : 'local';
}

/** True when running against the staging K3s cluster (`E2E_TARGET=staging`). */
export function isStagingTarget(): boolean {
  return e2eTarget() === 'staging';
}

/** True when running against the production cluster (`E2E_TARGET=prod`). */
export function isProdTarget(): boolean {
  return e2eTarget() === 'prod';
}

/**
 * True for any remote (non-`local`) target. Useful for guards that apply
 * equally to staging and prod — e.g. self-signed-cert / no-Mailpit caveats
 * that only exist outside the local docker-compose stack.
 */
export function isRemoteTarget(): boolean {
  return e2eTarget() !== 'local';
}

/**
 * Predicate for `test.skip(...)` in browser specs that can't run on Firefox
 * against `E2E_TARGET=staging`.
 *
 * Why: Firefox can't consume Chromium's `--host-resolver-rules` launch flag,
 * so its UI traffic falls back to the OS resolver — which does not resolve the
 * `staging.*.dloizides.com` hostnames (public DNS points them at PROD). Any
 * spec that does a fresh `page.goto()` to the staging frontend never reaches
 * the app. This is a documented environmental constraint (E2ETests/README.md
 * "Targeting staging" — Firefox needs a hosts-file edit for full staging
 * coverage), NOT a product bug. Firefox staging coverage returns once the
 * hosts-file workaround is applied.
 *
 * Usage:
 *   test.skip(({ browserName }) => firefoxCannotReachStaging(browserName), FIREFOX_STAGING_SKIP_REASON);
 */
export function firefoxCannotReachStaging(browserName: string): boolean {
  return isStagingTarget() && browserName === 'firefox';
}

export const FIREFOX_STAGING_SKIP_REASON =
  'Firefox cannot resolve staging hostnames without a hosts-file edit (see E2ETests/README.md "Targeting staging")';
