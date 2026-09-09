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

import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_NO_CONTENT, HTTP_OK } from './kefiHttpStatus.js';
import { KefiAdminClient } from './kefiAdminClient.js';
import { recordCleaned, recordCreated } from './kefiCanaryRegistry.js';
import { assertAttendeesAbsent, resolveAttendeeIdByEmail } from './kefiEventOpsLeaks.js';
import {
  KefiAccessLinkClient,
  type CreateAccessLinkInput,
  type CreatedAccessLink,
} from './kefiAccessLinkClient.js';
import { KefiAttendeeDeleteClient } from './kefiAttendeeDeleteClient.js';
import { KefiImportClient, type ImportAttendeeRow } from './kefiImportClient.js';
import {
  KefiMessageTemplateClient,
  type CreateMessageTemplateInput,
  type MessageTemplate,
} from './kefiMessageTemplateClient.js';
import { KefiPublicRegisterClient, isRateLimited } from './kefiPublicRegisterClient.js';
import {
  fixtureAttendeeEmail,
  getKefiFixtureTenant,
  newEventOpsMarker,
  type KefiFixtureTenant,
} from './kefiFixtureTenant.js';


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
  /**
   * The full mint-time DTO. Carries the fields a spec cannot recover later —
   * `expiresAt`, `oneTime`, `status` at mint — so an expiry assertion does not
   * have to re-list the whole event to find its own link.
   */
  created: CreatedAccessLink;
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
  templates: KefiMessageTemplateClient;

  /** Self-register one attendee through the real public route. Tracked for deletion. */
  registerAttendee(discriminator: string, passCode?: string): Promise<CreatedAttendee>;
  /** Import one attendee (the only way to set `referredBy`). Tracked for deletion. */
  importAttendee(row: ImportAttendeeRow): Promise<CreatedAttendee>;
  /** Mint an access link. Tracked for revocation. */
  mintLink(input: CreateAccessLinkInput): Promise<MintedLink>;
  /** Create a message template. Tracked for deletion. */
  createTemplate(input: CreateMessageTemplateInput): Promise<MessageTemplate>;
  /** Record an id created outside the helpers so teardown still reaches it. */
  trackAttendee(externalId: string): void;
  trackLink(externalId: string): void;
  trackTemplate(externalId: string): void;
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
  const templates = new KefiMessageTemplateClient();
  const register = new KefiPublicRegisterClient();
  const imports = new KefiImportClient();
  const deletes = new KefiAttendeeDeleteClient();
  const marker = newEventOpsMarker();

  // Every id is declared to the run-scoped leak registry the moment it exists.
  // `cleanup()` returning a failures array was never enough: a spec can discard
  // the array (kefi-email-delivery.spec.ts:114) or never call cleanup at all,
  // and nothing turned red. The registry is read by the shared global teardown,
  // which sweeps what is left and FAILS the run - see kefiCanaryRegistry.ts.
  const createdAttendees: string[] = [];
  const createdLinks: string[] = [];
  const createdTemplates: string[] = [];

  function declare(kind: 'attendee' | 'link' | 'template', bucket: string[], id: string): void {
    bucket.push(id);
    recordCreated(kind, id);
  }

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
    declare('attendee', createdAttendees, data.attendeeExternalId);
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
    const externalId = await resolveAttendeeIdByEmail(bearer, tenant, row.email ?? '');
    declare('attendee', createdAttendees, externalId);
    return {
      externalId,
      name: row.name,
      surname: row.surname ?? '',
      email: row.email ?? '',
      passCode: row.passCode,
      priceEur: row.paidEur ?? 0,
    };
  }

  async function mintLink(input: CreateAccessLinkInput): Promise<MintedLink> {
    const minted = await links.mintAndCaptureToken(bearer, tenant.eventExternalId, input);
    declare('link', createdLinks, minted.externalId);
    return { ...minted, scope: input.scope };
  }

  async function createTemplate(input: CreateMessageTemplateInput): Promise<MessageTemplate> {
    const created = await templates.createOrThrow(bearer, tenant.eventExternalId, input);
    declare('template', createdTemplates, created.externalId);
    return created;
  }

  async function cleanup(): Promise<string[]> {
    const failures: string[] = [];

    for (const templateId of createdTemplates) {
      try {
        const resp = await templates.remove(bearer, tenant.eventExternalId, templateId);
        // 204 = deleted, 404 = the spec already deleted it. Anything else is real.
        if (resp.status !== HTTP_NO_CONTENT && resp.status !== HTTP_NOT_FOUND) {
          failures.push(`delete message-template ${templateId} → ${resp.status}`);
        } else {
          recordCleaned('template', templateId);
        }
      } catch (error) {
        failures.push(`delete message-template ${templateId} threw: ${String(error)}`);
      }
    }

    for (const linkId of createdLinks) {
      try {
        const resp = await links.revoke(bearer, tenant.eventExternalId, linkId);
        // 204 = revoked, 404 = already gone. Anything else is a real failure.
        if (resp.status !== HTTP_NO_CONTENT && resp.status !== HTTP_NOT_FOUND) {
          failures.push(`revoke access-link ${linkId} → ${resp.status}`);
        } else {
          recordCleaned('link', linkId);
        }
      } catch (error) {
        failures.push(`revoke access-link ${linkId} threw: ${String(error)}`);
      }
    }

    const deleteAccepted: string[] = [];
    for (const attendeeId of createdAttendees) {
      try {
        const resp = await deletes.deleteAttendee({
          bearer,
          eventExternalId: tenant.eventExternalId,
          attendeeExternalId: attendeeId,
        });
        if (resp.status !== HTTP_NO_CONTENT && resp.status !== HTTP_NOT_FOUND) {
          failures.push(`delete attendee ${attendeeId} → ${resp.status}`);
        } else {
          deleteAccepted.push(attendeeId);
        }
      } catch (error) {
        failures.push(`delete attendee ${attendeeId} threw: ${String(error)}`);
      }
    }

    // VERIFY ABSENCE, do not trust the 204. One extra ledger read proves the
    // row is gone from the live roster; only then is the id marked cleaned. A
    // 204 over a row that is still there would read as a clean teardown.
    failures.push(...(await assertAttendeesAbsent(bearer, tenant, deleteAccepted)).messages);

    createdTemplates.length = 0;
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
    templates,
    registerAttendee,
    importAttendee,
    mintLink,
    createTemplate,
    trackAttendee: (externalId: string) => void createdAttendees.push(externalId),
    trackLink: (externalId: string) => void createdLinks.push(externalId),
    trackTemplate: (externalId: string) => void createdTemplates.push(externalId),
    cleanup,
  };
}
