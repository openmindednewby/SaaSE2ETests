/**
 * KEFI-PEOPLE-1 "Organizer people editor" — the shared @api rig for
 * `kefi-landing-people.spec.ts` and `kefi-landing-upload.spec.ts`.
 *
 * Provisions, entirely server-side (master-admin, staging only):
 *   - tenant A: a disposable canary tenant (`e2c-…` slug, never csdf) with its owner,
 *     plus an ORGANIZER user and a NON-ORGANIZER (ambassador) user in the same tenant;
 *   - tenant B: a second disposable canary tenant with its own ORGANIZER, for the
 *     cross-tenant clause of AC-09.
 *
 * Callers guard with `isRemoteTarget()` + `masterAdminAvailable()` (prod carries no
 * master-admin creds) and call {@link teardownLandingPeopleFixture} in `afterAll`.
 */

import type { KefiAdminClient } from './kefiAdminClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
  type ApiTenantHandle,
} from './kefiApiTenant.js';
import {
  createTenantUserWithRole,
  deleteEphemeralUser,
  type EphemeralKefiUser,
} from './kefiKeycloakAdmin.js';

const EVENT_DAYS_AHEAD = 90;
const PASS = { passCode: 'FULL', passLabel: 'Full Pass', priceEur: 0 } as const;

/** Upload endpoint KEFI-PEOPLE-1 T1 adds. NOT BUILT YET (2026-09-27) — the path is the planned one. */
export const KEFI_LANDING_UPLOAD_PATH = '/api/v1/admin/landing-config/images';
/** Organizer write surface (full replace; `UpdateLandingConfig.cs`). */
export const KEFI_LANDING_CONFIG_PATH = '/api/v1/admin/landing-config';

/** Anonymous public read of a tenant's landing config. */
export function publicTenantPath(slug: string): string {
  return `/api/v1/t/${encodeURIComponent(slug)}`;
}

export interface LandingPeopleFixture {
  tenantA: ApiTenantHandle;
  tenantB: ApiTenantHandle;
  /** Role `organizer`, tenant A. */
  organizerA: EphemeralKefiUser;
  /** Role `ambassador` (not organizer, not tenant-owner), tenant A. */
  nonOrganizerA: EphemeralKefiUser;
  /** Role `organizer`, tenant B. */
  organizerB: EphemeralKefiUser;
}

async function addUser(
  tenant: ApiTenantHandle,
  role: 'organizer' | 'ambassador',
  lastName: string,
): Promise<EphemeralKefiUser> {
  return createTenantUserWithRole({
    email: tenant.ctx.email.replace('@', `-${role}@`),
    password: tenant.ctx.password,
    tenantId: tenant.tenantId,
    role,
    firstName: 'People',
    lastName,
  });
}

export async function provisionLandingPeopleFixture(
  admin: KefiAdminClient,
): Promise<LandingPeopleFixture> {
  const tenantInput = { admin, eventDaysAhead: EVENT_DAYS_AHEAD, eventStatus: 'Published', ...PASS } as const;
  const tenantA = await provisionApiTenantWithEvent(tenantInput);
  const tenantB = await provisionApiTenantWithEvent(tenantInput);
  // Runs against PROD (owner decision, KEFI-PEOPLE-1): refuse anything but a throwaway canary.
  for (const t of [tenantA, tenantB]) {
    if (!t.slug.startsWith('e2c-')) throw new Error(`[kefiLandingPeopleFixture] refusing non-canary tenant '${t.slug}'`);
  }
  const organizerA = await addUser(tenantA, 'organizer', 'Organizer');
  const nonOrganizerA = await addUser(tenantA, 'ambassador', 'Ambassador');
  const organizerB = await addUser(tenantB, 'organizer', 'OrganizerB');
  return { tenantA, tenantB, organizerA, nonOrganizerA, organizerB };
}

/** Deletes the three role users, then sweeps both canary tenants. Never throws. */
export async function teardownLandingPeopleFixture(
  fx: LandingPeopleFixture | undefined,
  admin: KefiAdminClient,
): Promise<void> {
  if (!fx) return;
  await Promise.all([fx.organizerA, fx.nonOrganizerA, fx.organizerB].map((u) => deleteEphemeralUser(u.userId)));
  await teardownApiTenant(fx.tenantA, admin);
  await teardownApiTenant(fx.tenantB, admin);
}
