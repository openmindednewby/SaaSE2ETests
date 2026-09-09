/**
 * Leak detection for rows created on the REAL Kefi fixture tenant `e2e`.
 *
 * WHY THIS EXISTS. `kefiEventOpsFixture.cleanup()` returns a failures array and
 * never throws - by design, so a failing teardown cannot mask the assertion
 * that caused it. The cost of that design was that the array is only as good as
 * the caller: `tests/kefi/kefi-email-delivery.spec.ts:114` does
 * `await ops.cleanup().catch(() => undefined)` and discards it, and a spec that
 * never reaches its `finally` never calls cleanup at all. Either way an
 * attendee row survives on a live tenant and the suite is green.
 *
 * Two mechanisms here close that:
 *   1. `assertAttendeesAbsent` VERIFIES the roster after a delete instead of
 *      trusting the 204, and only then marks the id cleaned in the registry.
 *   2. `sweepPendingEventOps` is called by the shared global teardown: it
 *      deletes whatever is still registered at the end of the run and returns
 *      what it could not remove, which fails the run.
 */
import { HTTP_NO_CONTENT, HTTP_NOT_FOUND, HTTP_OK } from './kefiHttpStatus.js';
import { KefiAdminClient } from './kefiAdminClient.js';
import { KefiAccessLinkClient } from './kefiAccessLinkClient.js';
import { KefiAttendeeDeleteClient } from './kefiAttendeeDeleteClient.js';
import { KefiDoorLedgerClient } from './kefiDoorLedgerClient.js';
import { KefiMessageTemplateClient } from './kefiMessageTemplateClient.js';
import {
  readPendingEventOpsResources,
  recordCleaned,
  type PendingResource,
} from './kefiCanaryRegistry.js';
import { getKefiFixtureTenant, type KefiFixtureTenant } from './kefiFixtureTenant.js';

interface LedgerRow {
  attendeeExternalId: string;
}

/** What an absence check concluded. Structured so callers do not string-match. */
export interface AbsenceResult {
  /** Human-readable failures for the spec-facing failures array. */
  messages: string[];
  /** Ids that are NOT proven gone. These stay pending in the registry. */
  unresolved: string[];
}

/**
 * Read the roster ids, with a POSITIVE CONTROL on the response.
 *
 * A 200 carrying `attendees: []` is not evidence of absence — a wrong or stale
 * eventExternalId, a scope change, or future pagination all produce it, and
 * every id would then be marked cleaned. So the event identity in the payload
 * is checked against the tenant we asked about, and an empty roster is treated
 * as unverifiable by the caller when ids were expected to be resolvable.
 */
async function readRosterIds(bearer: string, tenant: KefiFixtureTenant): Promise<string[]> {
  const resp = await new KefiDoorLedgerClient().getLedgerByBearer(
    tenant.slug,
    bearer,
    tenant.eventExternalId,
  );
  if (resp.status !== HTTP_OK) {
    throw new Error(`[kefiEventOpsLeaks] ledger read for absence-verification returned ${resp.status}`);
  }
  const view = resp.data as { event?: { externalId?: string }; attendees?: LedgerRow[] };
  const answeredFor = view.event?.externalId;
  if (answeredFor !== tenant.eventExternalId) {
    throw new Error(
      `[kefiEventOpsLeaks] ledger answered for event ${String(answeredFor)} but absence was ` +
        `asked about ${tenant.eventExternalId} - an empty roster here would be a false clean`,
    );
  }
  if (!Array.isArray(view.attendees)) {
    throw new Error('[kefiEventOpsLeaks] ledger response has no attendees array');
  }
  return view.attendees.map((a) => a.attendeeExternalId);
}

/**
 * Look up an attendee id by its (unique, suite-generated) email. Lives here
 * rather than in the fixture because it is the same ledger read the absence
 * verification does, and the fixture is at its file-size limit.
 */
export async function resolveAttendeeIdByEmail(
  bearer: string,
  tenant: KefiFixtureTenant,
  email: string,
): Promise<string> {
  const resp = await new KefiDoorLedgerClient().getLedgerByBearer(
    tenant.slug,
    bearer,
    tenant.eventExternalId,
  );
  if (resp.status !== HTTP_OK) {
    throw new Error(
      '[kefiEventOpsLeaks] could not read the ledger to resolve the imported attendee id ' +
        `(status ${resp.status})`,
    );
  }
  const view = resp.data as { attendees: { email: string | null; attendeeExternalId: string }[] };
  const match = view.attendees.find((a) => a.email === email);
  if (match === undefined) {
    throw new Error(
      `[kefiEventOpsLeaks] imported attendee ${email} is not in the ledger - the import ` +
        'reported success but created no row.',
    );
  }
  return match.attendeeExternalId;
}

/**
 * Confirm each id is GONE from the live roster. Ids proven absent are marked
 * cleaned; ids still present (or unverifiable) are returned as failure strings
 * and stay pending, so the global teardown re-sweeps and then fails the run.
 */
export async function assertAttendeesAbsent(
  bearer: string,
  tenant: KefiFixtureTenant,
  attendeeIds: string[],
): Promise<AbsenceResult> {
  if (attendeeIds.length === 0) return { messages: [], unresolved: [] };
  let roster: string[];
  try {
    roster = await readRosterIds(bearer, tenant);
  } catch (error) {
    // Unverifiable is NOT clean. Leave every id pending.
    return {
      messages: [`could not verify attendee absence (${attendeeIds.length} id(s) stay pending): ${String(error)}`],
      unresolved: [...attendeeIds],
    };
  }

  const result: AbsenceResult = { messages: [], unresolved: [] };
  for (const id of attendeeIds) {
    if (roster.includes(id)) {
      result.messages.push(`attendee ${id} accepted the delete but is STILL on the roster`);
      result.unresolved.push(id);
      continue;
    }
    recordCleaned('attendee', id);
  }
  return result;
}

/**
 * Final sweep of everything the fixture created and nobody cleaned. Returns the
 * resources still outstanding - a non-empty return fails the Playwright run.
 */
export async function sweepPendingEventOps(): Promise<PendingResource[]> {
  const pending = readPendingEventOpsResources();
  if (pending.length === 0) return [];

  const tenant = getKefiFixtureTenant();
  const bearer = await new KefiAdminClient().getTenantOwnerBearer({
    email: tenant.organizerEmail,
    password: tenant.organizerPassword,
  });
  const deletes = new KefiAttendeeDeleteClient();
  const links = new KefiAccessLinkClient();
  const templates = new KefiMessageTemplateClient();

  const attendeeIds: string[] = [];
  const stillPending: PendingResource[] = [];
  for (const resource of pending) {
    try {
      const status = await removeOne(resource, {
        bearer,
        eventExternalId: tenant.eventExternalId,
        deletes,
        links,
        templates,
      });
      if (status !== HTTP_NO_CONTENT && status !== HTTP_NOT_FOUND) {
        stillPending.push(resource);
        continue;
      }
      if (resource.kind === 'attendee') attendeeIds.push(resource.id);
      else recordCleaned(resource.kind, resource.id);
    } catch {
      stillPending.push(resource);
    }
  }

  // Attendees are the ones that shift a live P&L, so prove they are gone.
  const absence = await assertAttendeesAbsent(bearer, tenant, attendeeIds);
  for (const id of absence.unresolved) stillPending.push({ kind: 'attendee', id });
  return stillPending;
}

interface RemovalClients {
  bearer: string;
  eventExternalId: string;
  deletes: KefiAttendeeDeleteClient;
  links: KefiAccessLinkClient;
  templates: KefiMessageTemplateClient;
}

async function removeOne(resource: PendingResource, c: RemovalClients): Promise<number> {
  if (resource.kind === 'attendee') {
    const resp = await c.deletes.deleteAttendee({
      bearer: c.bearer,
      eventExternalId: c.eventExternalId,
      attendeeExternalId: resource.id,
    });
    return resp.status;
  }
  if (resource.kind === 'link') {
    const resp = await c.links.revoke(c.bearer, c.eventExternalId, resource.id);
    return resp.status;
  }
  const resp = await c.templates.remove(c.bearer, c.eventExternalId, resource.id);
  return resp.status;
}
