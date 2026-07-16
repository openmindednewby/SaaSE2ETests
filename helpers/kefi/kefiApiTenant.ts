/**
 * Shared @api provisioning for the Kefi specs that need a verified tenant WITH an
 * event + pass but WITHOUT the slow signup→IMAP→wizard browser path — the
 * registration-approval, attendee-import, organizer-P&L and critical-path specs.
 *
 * It mints, entirely server-side (master-admin, staging only):
 *   1. a canary tenant (platform-admin createTenant, `e2c-{canaryId}-` slug),
 *   2. a Pro subscription on it (so event-create + the freemium gates are open),
 *   3. a fully-set-up tenant-owner user (KC master-admin) the spec ROPCs as,
 *   4. an event (owner POST /admin/events — a backoffice tenant has none), and
 *   5. a pass on that event (seed-canary-event ensures code/label/price on the
 *      tenant's CURRENT event — it requires an existing event, hence step 4).
 *
 * Master-admin-only: `createTenantOwnerUser` needs `KEYCLOAK_MASTER_ADMIN_*`,
 * which only staging carries. Callers guard with `masterAdminAvailable()` and
 * skip on prod. Teardown deletes the owner KC user (the canary sweep keys off the
 * tenant slug, not this independently-provisioned user) then sweeps the tenant.
 */

import type { KefiAdminClient } from './kefiAdminClient.js';
import { KefiBackofficeClient } from './kefiBackofficeClient.js';
import { KefiEventClient } from './kefiEventClient.js';
import { KefiLifecycleClient } from './kefiLifecycleClient.js';
import { createTenantOwnerUser, deleteEphemeralUser } from './kefiKeycloakAdmin.js';
import { newCanaryContext, type KefiCanaryContext } from './kefiCanaryIds.js';
import { cleanupKefiCanary } from './kefiTeardown.js';
import type { OwnerCreds } from './kefiProGatesClient.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GRANTED_PERIOD_END_UTC = '2027-12-31T00:00:00Z';

/** Everything a spec needs about a freshly provisioned @api tenant. */
export interface ApiTenantHandle {
  ctx: KefiCanaryContext;
  tenantId: string;
  slug: string;
  ownerUserId: string;
  ownerCreds: OwnerCreds;
  eventExternalId: string;
  passCode: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Provision a Pro tenant + owner + one event carrying a single pass, all via
 * server-side admin APIs. Returns the handle the spec drives; call
 * {@link teardownApiTenant} in `finally`.
 */
export async function provisionApiTenantWithEvent(input: {
  admin: KefiAdminClient;
  eventDaysAhead: number;
  eventStatus: 'Draft' | 'Published';
  passCode: string;
  passLabel: string;
  priceEur: number;
}): Promise<ApiTenantHandle> {
  const { admin } = input;
  const backoffice = new KefiBackofficeClient(admin);
  const events = new KefiEventClient(admin);
  const lifecycle = new KefiLifecycleClient(admin);
  const ctx = newCanaryContext();
  const slug = `${ctx.slugPrefix}api`;

  const created = await backoffice.createTenant({ name: `${ctx.slugPrefix}Api Canary`, slug });
  // Pro so the (freemium-gated) event-create + admin surfaces are open.
  await backoffice.setSubscription(created.tenantId, {
    planCode: 'pro',
    status: 'Active',
    currentPeriodEndUtc: GRANTED_PERIOD_END_UTC,
  });

  const owner = await createTenantOwnerUser({
    email: ctx.email,
    password: ctx.password,
    tenantId: created.tenantId,
  });
  const ownerCreds: OwnerCreds = { ownerEmail: ctx.email, ownerPassword: ctx.password };

  // A backoffice tenant has no wizard-created event — create one so
  // seed-canary-event (which needs the tenant's CURRENT event) can ensure a pass.
  const eventDateIso = toIsoDate(new Date(Date.now() + input.eventDaysAhead * MS_PER_DAY));
  await events.createMyEvent({
    ...ownerCreds,
    name: `${ctx.slugPrefix}Canary Event`,
    dateIso: eventDateIso,
    venue: `${ctx.slugPrefix}Venue`,
  });

  const seeded = await lifecycle.seedCanaryEvent({
    canaryId: ctx.canaryId,
    eventDateOffsetDays: input.eventDaysAhead,
    status: input.eventStatus,
    passCode: input.passCode,
    passLabel: input.passLabel,
    priceEur: input.priceEur,
  });
  if (!seeded.found) {
    throw new Error(`[kefiApiTenant] seed-canary-event did not find tenant ${slug}`);
  }

  return {
    ctx,
    tenantId: created.tenantId,
    slug: seeded.slug,
    ownerUserId: owner.userId,
    ownerCreds,
    eventExternalId: seeded.eventExternalId,
    passCode: seeded.passCode,
  };
}

/** Delete the owner KC user then sweep the canary tenant. Never throws. */
export async function teardownApiTenant(
  handle: ApiTenantHandle,
  admin: KefiAdminClient,
): Promise<void> {
  await deleteEphemeralUser(handle.ownerUserId);
  await cleanupKefiCanary(handle.ctx.canaryId, { adminClient: admin });
}
