/**
 * Per-spec teardown for the Kefi tenant-lifecycle E2E. Calls the
 * Phase-A canary-cleanup endpoint with the spec's canary id + asserts
 * the response. Designed to run in a `test.afterEach` so a flaky test
 * still cleans up the canary it created.
 *
 * Why per-spec rather than wired into `global-teardown.canary.ts`: the
 * Kefi cleanup endpoint takes `canaryId={8-hex}`, the existing 6 backend
 * slices take `runId={uuid}` — different shape. Phase E may unify them
 * into a single platform-wide sweep with multiple ids; for now keeping
 * the Kefi sweep self-contained avoids coupling to the legacy 6-service
 * teardown ordering.
 */

import { KefiAdminClient, type CanaryCleanupResult } from './kefiAdminClient.js';

export interface TeardownOptions {
  /** Re-use an existing admin client to avoid a second token mint. */
  adminClient?: KefiAdminClient;
}

/**
 * Sweep + log. Never throws — teardown must not mask test failures. The
 * orphan-cleanup sweep (Phase E) is the safety net if this returns a
 * non-zero error case.
 */
export async function cleanupKefiCanary(
  canaryId: string,
  options: TeardownOptions = {},
): Promise<CanaryCleanupResult | null> {
  const adminClient = options.adminClient ?? new KefiAdminClient();
  try {
    const result = await adminClient.canaryCleanup(canaryId);
    process.stdout.write(
      `[kefi-teardown] canaryId=${canaryId} tenants=${result.tenantsDeleted} users=${result.usersDeleted} ingresses=${result.ingressesDeleted} certs=${result.certificatesDeleted} secrets=${result.secretsDeleted}\n`,
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[kefi-teardown] WARN: canaryId=${canaryId} cleanup failed — ${msg}\n`);
    return null;
  }
}
