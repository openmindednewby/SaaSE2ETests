/**
 * The PROD-SAFETY spine of the Kefi event-ops E2E suite.
 *
 * These specs run against a real, published, production tenant (see
 * `kefiFixtureTenant.ts` for why a canary cannot be used). That makes cleanup a
 * correctness requirement, not housekeeping — an abandoned attendee row shifts
 * the tenant's live P&L and an abandoned access link is a real credential left
 * lying around.
 *
 * The rules this module enforces:
 *
 *  1. **Only ever touch what we created.** Every attendee id and access-link id
 *     is recorded at creation time; teardown deletes/revokes exactly that set and
 *     nothing else. No "delete rows matching a pattern" sweep ever runs, so a
 *     pre-existing row can never be caught by it.
 *  2. **Teardown never throws.** A failing cleanup must not mask the assertion
 *     failure that caused it, and one failed delete must not abandon the rest.
 *     Failures are collected and reported as an annotation.
 *  3. **Nothing deliverable.** Attendee emails are `@example.invalid` (RFC 2606),
 *     which can never resolve, so no lifecycle sweep can mail a row we created.
 *
 * Usage:
 *
 *   const ops = await openEventOps();
 *   try {
 *     const attendee = await ops.registerAttendee('checkin');
 *     ...
 *   } finally {
 *     await ops.cleanup();
 *   }
 */

import { KefiAdminClient } from './kefiAdminClient.js';
import { KefiAccessLinkClient, type CreateAccessLinkInput } from './kefiAccessLinkClient.js';
import { KefiAttendeeDeleteClient } from './kefiAttendeeDeleteClient.js';
import { KefiDoorLedgerClient } from './kefiDoorLedgerClient.js';
import { KefiImportClient, type ImportAttendeeRow } from './kefiImportClient.js';
import { KefiPublicRegisterClient, isRateLimited } from './kefiPublicRegisterClient.js';
import {
  fixtureAttendeeEmail,
  getKefiFixtureTenant,
  newEventOpsMarker,
  type KefiFixtureTenant,
} from './kefiFixtureTenant.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/** One attendee this suite created, and everything a spec needs about it. */
export interface CreatedAttendee {
  externalId: string;
  name: string;
  surname: string;
  email: string;
  passCode: string;
  priceEur: number;
}

/** One access link this suite minted. */
export interface MintedLink {
  externalId: string;
  scope: string;
  token: string;
  url: string;
}

/**
 * A live event-ops session bound to the fixture tenant: an organizer bearer, the
 * creation helpers, and the tracked cleanup.
 */
export interface EventOpsSession {
  tenant: KefiFixtureTenant;
  /** Organizer / tenant-owner bearer for the authed tier. */
  bearer: string;
  /** Unique per-run marker embedded in every name/email this session creates. */
  marker: string;
  admin: KefiAdminClient;
  links: KefiAccessLinkClient;

  /** Self-register one attendee through the real public route. Tracked for deletion. */
  registerAttendee(discriminator: string, passCode?: string): Promise<CreatedAttendee>;
  /** Import one attendee (the only way to set `referredBy`). Tracked for deletion. */
  importAttendee(row: ImportAttendeeRow): Promise<CreatedAttendee>;
  /** Mint an access link. Tracked for revocation. */
  mintLink(input: CreateAccessLinkInput): Promise<MintedLink>;
  /** Record an id created outside the helpers so teardown still reaches it. */
  trackAttendee(externalId: string): void;
  trackLink(externalId: string): void;
  /** Revoke + delete everything this session created. Never throws. */
  cleanup(): Promise<string[]>;
}

/** Open a session: resolve the fixture tenant and mint the organizer bearer. */
export async function openEventOps(): Promise<EventOpsSession> {
  const tenant = getKefiFixtureTenant();
  const admin = new KefiAdminClient();
  const bearer = await admin.getTenantOwnerBearer({
    email: tenant.organizerEmail,
    password: tenant.organizerPassword,
  });

  const links = new KefiAccessLinkClient();
  const register = new KefiPublicRegisterClient();
  const imports = new KefiImportClient();
  const deletes = new KefiAttendeeDeleteClient();
  const marker = newEventOpsMarker();

  const createdAttendees: string[] = [];
  const createdLinks: string[] = [];

  async function registerAttendee(
    discriminator: string,
    passCode = 'FULL',
  ): Promise<CreatedAttendee> {
    const surname = `${marker}-${discriminator}`;
    const email = fixtureAttendeeEmail(marker, discriminator);
    const resp = await register.registerWithBackoff(tenant.slug, {
      name: 'E2E',
      surname,
      phone: '+35799000000',
      email,
      passCode,
      consentGiven: true,
    });

    if (resp.status !== HTTP_CREATED) {
      const hint = isRateLimited(resp.status)
        ? ' — the per-IP registration rate limiter (5/60s) tripped; the spec is registering too fast'
        : '';
      throw new Error(
        `[kefiEventOpsFixture] register(${discriminator}) expected 201, got ${resp.status}${hint}: ` +
          JSON.stringify(resp.data),
      );
    }

    const data = resp.data as { attendeeExternalId: string; passCode: string; priceEur: number };
    createdAttendees.push(data.attendeeExternalId);
    return {
      externalId: data.attendeeExternalId,
      name: 'E2E',
      surname,
      email,
      passCode: data.passCode,
      priceEur: data.priceEur,
    };
  }

  async function importAttendee(row: ImportAttendeeRow): Promise<CreatedAttendee> {
    const resp = await imports.importJson({
      bearer,
      eventExternalId: tenant.eventExternalId,
      attendees: [row],
      skipDuplicates: false,
    });
    if (resp.status !== HTTP_OK) {
      throw new Error(
        `[kefiEventOpsFixture] import expected 200, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }

    // The import summary carries counts, not ids — resolve the new row's id from
    // the organizer ledger by the unique email we just imported.
    const externalId = await resolveAttendeeIdByEmail(row.email ?? '');
    createdAttendees.push(externalId);
    return {
      externalId,
      name: row.name,
      surname: row.surname ?? '',
      email: row.email ?? '',
      passCode: row.passCode,
      priceEur: row.paidEur ?? 0,
    };
  }

  /** Look up an attendee id by its (unique, suite-generated) email. */
  async function resolveAttendeeIdByEmail(email: string): Promise<string> {
    const ledger = new KefiDoorLedgerClient();
    const resp = await ledger.getLedgerByBearer(
      tenant.slug,
      bearer,
      tenant.eventExternalId,
    );
    if (resp.status !== HTTP_OK) {
      throw new Error(
        `[kefiEventOpsFixture] could not read the ledger to resolve the imported ` +
          `attendee id (status ${resp.status})`,
      );
    }
    const view = resp.data as { attendees: { email: string | null; attendeeExternalId: string }[] };
    const match = view.attendees.find((a) => a.email === email);
    if (match === undefined) {
      throw new Error(
        `[kefiEventOpsFixture] imported attendee ${email} is not in the ledger — the ` +
          'import reported success but created no row.',
      );
    }
    return match.attendeeExternalId;
  }

  async function mintLink(input: CreateAccessLinkInput): Promise<MintedLink> {
    const minted = await links.mintAndCaptureToken(bearer, tenant.eventExternalId, input);
    createdLinks.push(minted.externalId);
    return { ...minted, scope: input.scope };
  }

  async function cleanup(): Promise<string[]> {
    const failures: string[] = [];

    for (const linkId of createdLinks) {
      try {
        const resp = await links.revoke(bearer, tenant.eventExternalId, linkId);
        // 204 = revoked, 404 = already gone. Anything else is a real failure.
        if (resp.status !== 204 && resp.status !== 404) {
          failures.push(`revoke access-link ${linkId} → ${resp.status}`);
        }
      } catch (error) {
        failures.push(`revoke access-link ${linkId} threw: ${String(error)}`);
      }
    }

    for (const attendeeId of createdAttendees) {
      try {
        const resp = await deletes.deleteAttendee({
          bearer,
          eventExternalId: tenant.eventExternalId,
          attendeeExternalId: attendeeId,
        });
        if (resp.status !== 204 && resp.status !== 404) {
          failures.push(`delete attendee ${attendeeId} → ${resp.status}`);
        }
      } catch (error) {
        failures.push(`delete attendee ${attendeeId} threw: ${String(error)}`);
      }
    }

    createdLinks.length = 0;
    createdAttendees.length = 0;
    return failures;
  }

  return {
    tenant,
    bearer,
    marker,
    admin,
    links,
    registerAttendee,
    importAttendee,
    mintLink,
    trackAttendee: (externalId: string) => void createdAttendees.push(externalId),
    trackLink: (externalId: string) => void createdLinks.push(externalId),
    cleanup,
  };
}
