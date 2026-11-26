/**
 * Server-side client for the organizer PROMOTER routes (#281) — needed by the
 * event-ops suite purely to obtain a promoter to scope a `Promoter` access link
 * to, and to give that promoter exactly one referred attendee so the scope
 * filtering assertion is meaningful rather than "an empty list stayed empty".
 *
 *   GET  /api/v1/organizer/events/{eventId}/promoters   Roles(organizer, tenant-owner)
 *   POST /api/v1/organizer/events/{eventId}/promoters   Roles(organizer, tenant-owner)
 *
 * ⚠️ There is NO delete-promoter endpoint. On a production fixture tenant that
 * makes promoter creation the one genuinely non-reversible thing this suite can
 * do — so {@link ensurePromoter} is IDEMPOTENT by name: it reuses the suite's
 * existing promoter when one is already there and only creates on the very first
 * run. Over any number of runs the fixture tenant gains exactly ONE extra row.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_REDIRECT_MIN = 300;
const STAFF_PASS_CODE = 'STAFF';

export interface DoorCompSeed {
  eventExternalId: string;
  teacherExternalId: string;
  staffAttendeeExternalId: string;
  guestAttendeeExternalId: string;
}

/** A promoter row (`OrganizerPromoterDto`). */
export interface OrganizerPromoter {
  externalId: string;
  name: string;
  role: string;
  paidReferralCount: number;
  payoutEur: number;
  paid: boolean;
}

/**
 * The stable display name of the suite's own promoter. Deliberately constant
 * (not per-run) so {@link ensurePromoter} converges on ONE row forever, and
 * obviously synthetic so a human reading the organizer dashboard knows what it
 * is and that it is safe to delete.
 */
export const EVENT_OPS_PROMOTER_NAME = 'E2E Event-Ops Promoter (do not use)';

export class KefiPromoterClient {
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();

  constructor() {
    this.http = axios.create({
      baseURL: this.urls.apiUrl,
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /** List the event's promoters. Throws on a non-200 (this is setup, not an assertion). */
  async list(bearer: string, eventExternalId: string): Promise<OrganizerPromoter[]> {
    const resp = await this.http.get<OrganizerPromoter[]>(this.promotersPath(eventExternalId), {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (resp.status !== HTTP_OK) {
      throw new Error(
        `[kefiPromoterClient] list promoters expected 200, got ${resp.status}: ` +
          JSON.stringify(resp.data),
      );
    }
    return Array.isArray(resp.data) ? resp.data : [];
  }

  /**
   * Return the suite's own promoter, creating it only if it does not yet exist.
   * Idempotent across runs — see the file header on why that matters here.
   */
  async ensurePromoter(bearer: string, eventExternalId: string): Promise<OrganizerPromoter> {
    const existing = (await this.list(bearer, eventExternalId)).find(
      (p) => p.name === EVENT_OPS_PROMOTER_NAME,
    );
    if (existing !== undefined) return existing;

    const resp = await this.http.post<OrganizerPromoter>(
      this.promotersPath(eventExternalId),
      { name: EVENT_OPS_PROMOTER_NAME, role: 'ambassador', headcount: 1 },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (resp.status !== HTTP_CREATED) {
      throw new Error(
        `[kefiPromoterClient] create promoter expected 201, got ${resp.status}: ` +
          JSON.stringify(resp.data),
      );
    }
    return resp.data;
  }

  /** Seed one teacher staff comp and one STAFF-pass EUR 0 guest comp on the event; throws on a non-2xx. */
  async seedDoorComps(bearer: string, eventExternalId: string, tag: string): Promise<DoorCompSeed> {
    const teacher = await this.post<{ externalId: string }>(bearer, this.promotersPath(eventExternalId), {
      name: `E2E door teacher ${tag}`, role: 'teacher', headcount: 1,
    }, 'create teacher');
    const provision = await this.post<{ tickets: Array<{ promoterExternalId: string; attendeeExternalId: string }> }>(
      bearer, `${this.eventPath(eventExternalId)}/staff-tickets/provision`,
      { promoterExternalIds: [teacher.externalId] }, 'provision staff ticket',
    );
    const ticket = provision.tickets.find((t) => t.promoterExternalId === teacher.externalId);
    if (ticket === undefined) throw new Error(`[kefiPromoterClient] provision minted no ticket for ${teacher.externalId}`);
    const guest = await this.post<{ externalId: string }>(bearer, `${this.eventPath(eventExternalId)}/attendees`, {
      name: 'E2E door guest', surname: tag, passCode: STAFF_PASS_CODE, paid: true, paidEur: 0, comp: true,
    }, 'create STAFF guest');
    return {
      eventExternalId,
      teacherExternalId: teacher.externalId,
      staffAttendeeExternalId: ticket.attendeeExternalId,
      guestAttendeeExternalId: guest.externalId,
    };
  }

  /** Delete the seeded door comps and return each failed delete as a `path status` line. */
  async removeDoorComps(bearer: string, seed: DoorCompSeed): Promise<string[]> {
    const event = this.eventPath(seed.eventExternalId);
    const paths = [
      `${event}/attendees/${seed.guestAttendeeExternalId}`,
      `${event}/attendees/${seed.staffAttendeeExternalId}`,
      `${event}/promoters/${seed.teacherExternalId}`,
    ];
    const failed: string[] = [];
    for (const path of paths) {
      const resp = await this.http.delete(path, { headers: { Authorization: `Bearer ${bearer}` } });
      if (resp.status >= HTTP_REDIRECT_MIN) failed.push(`${path} ${resp.status}`);
    }
    return failed;
  }

  private async post<T>(bearer: string, path: string, body: unknown, what: string): Promise<T> {
    const resp = await this.http.post<T>(path, body, { headers: { Authorization: `Bearer ${bearer}` } });
    if (resp.status >= HTTP_REDIRECT_MIN) {
      throw new Error(`[kefiPromoterClient] ${what} expected 2xx, got ${resp.status}: ${JSON.stringify(resp.data)}`);
    }
    return resp.data;
  }

  private eventPath(eventExternalId: string): string {
    return `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}`;
  }

  private promotersPath(eventExternalId: string): string {
    return `${this.eventPath(eventExternalId)}/promoters`;
  }
}
