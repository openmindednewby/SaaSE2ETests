/**
 * The two KEFI-SHAPED sweeps the shared canary teardown runs after the six
 * runId-shaped backend slices. Split out of global-teardown.canary.ts purely
 * for file size; the gate that consumes them lives there.
 */
import { KefiAdminClient } from '../helpers/kefi/kefiAdminClient.js';
import { readPendingCanaryIds, readPendingEventOpsResources } from '../helpers/kefi/kefiCanaryRegistry.js';
import { sweepPendingEventOps } from '../helpers/kefi/kefiEventOpsLeaks.js';

/**
 * Sweep every Kefi canary id this run minted but never successfully cleaned.
 *
 * WHY THIS IS HERE AND NOT IN A SPEC. Kefi is deliberately absent from the
 * `SERVICES` list above: its cleanup endpoint takes `canaryId={8-hex}`, not
 * `runId={uuid}`. The consequence was a FALSE GREEN - the `summary: N ok` line
 * tallied only the six runId-shaped slices, so it read `6 ok, 0 failed`
 * whether or not a Kefi canary tenant had been created, swept or leaked, and
 * whether or not any spec had called `cleanupKefiCanary` at all.
 * A tally that cannot observe the leaking resource is not evidence.
 *
 * Returns the ids STILL pending after the sweep. Non-empty is a hard failure:
 * the caller throws, which fails the Playwright run.
 */
export async function sweepPendingKefiCanaries(): Promise<string[]> {
  const pending = readPendingCanaryIds();
  if (pending.length === 0) {
    process.stdout.write('  [ok]   Kefi                 0 canary ids pending (none minted, or all swept in-spec)\n');
    return [];
  }

  const stillPending: string[] = [];
  for (const canaryId of pending) {
    try {
      // Constructed INSIDE the try on purpose: the ctor resolves required env
      // (KEFI_* urls + creds) and throws when they are missing. Outside the try
      // that throw escapes as an unhandled teardown error whose message names
      // an env var, not the leak — the run is still red, but the operator is
      // told the wrong thing. Here it is reported as "this id was not swept".
      const r = await new KefiAdminClient().canaryCleanup(canaryId);
      process.stdout.write(
        `  [ok]   Kefi                 canaryId=${canaryId} tenants=${r.tenantsDeleted} users=${r.usersDeleted} ingresses=${r.ingressesDeleted} certs=${r.certificatesDeleted} secrets=${r.secretsDeleted}\n`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stillPending.push(canaryId);
      process.stdout.write(`  [warn] Kefi                 canaryId=${canaryId} sweep FAILED - ${msg}\n`);
    }
  }
  return stillPending;
}

/**
 * Sweep rows the event-ops fixture created on the LIVE fixture tenant and that
 * no spec verifiably cleaned. Separate from the canary sweep because these are
 * rows on a real tenant, not a disposable canary: an abandoned attendee shifts
 * that tenant's P&L. Never throws - a failure to sweep is REPORTED as pending,
 * which is what fails the run.
 */
export async function sweepPendingEventOpsRows(): Promise<{ kind: string; id: string }[]> {
  try {
    const leaked = await sweepPendingEventOps();
    if (leaked.length === 0) {
      process.stdout.write('  [ok]   Kefi fixture rows    0 pending (all created rows verified gone)\n');
    }
    for (const r of leaked) {
      process.stdout.write(`  [warn] Kefi fixture rows    ${r.kind} ${r.id} NOT removed\n`);
    }
    return leaked;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`  [warn] Kefi fixture rows    sweep could not run - ${msg}\n`);
    // Unrunnable is NOT clean: name every row that is still owed a cleanup, so
    // the failure tells the operator WHAT leaked, not just that a sweep broke.
    const owed = readPendingEventOpsResources();
    return owed.length > 0 ? owed : [{ kind: 'unknown', id: 'sweep-failed' }];
  }
}

