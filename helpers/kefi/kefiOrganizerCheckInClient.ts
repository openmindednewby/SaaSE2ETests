/**
 * The organizer door check-in write, shaped EXACTLY as kefi-web emits it.
 *
 * kefi-web (`src/api/doorCheckInApi.ts`) sends:
 *   POST `${bffUrl('/organizer/events/{e}/attendees/{a}/check-in')}`
 *        = `/bff/api/kefi/api/v1/organizer/events/{e}/attendees/{a}/check-in`
 *   body  `buildDoorCheckInBody(checkedIn)` → `{ checkedIn }` (or `{}` when omitted)
 *   headers `Content-Type: application/json` (bff-web-client write guard),
 *           `Accept: application/json`, `X-BFF-Csrf: 1`
 * The `bff-kefi` YARP route strips `/bff/api/kefi` and injects the session bearer,
 * so kefi-api receives `/api/v1/organizer/...` + `Authorization: Bearer`. This
 * helper sends that post-proxy request. Path segments are NOT URI-encoded because
 * the client does not encode them either.
 *
 * `buildDoorCheckInBody` is MIRRORED, not imported: kefi-web is a separate repo and
 * E2ETests has no dependency on it. If the client builder changes, change this one.
 *
 * NOT observable here: the BFF hop itself (cookie → bearer, CSRF + Origin gate).
 */

import axios, { type AxiosInstance } from 'axios';

import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** Mirror of kefi-web `DoorCheckInBody`. */
export interface DoorCheckInBody {
  checkedIn?: boolean;
}

/** Mirror of kefi-web `buildDoorCheckInBody` (src/api/doorCheckInApi.ts). */
export function buildDoorCheckInBody(checkedIn?: boolean): DoorCheckInBody {
  return checkedIn === undefined ? {} : { checkedIn };
}

/** Mirror of kefi-web `doorCheckInUrl`, minus the `/bff/api/kefi` segment YARP strips. */
export function organizerCheckInPath(eventExternalId: string, attendeeExternalId: string): string {
  return `/api/v1/organizer/events/${eventExternalId}/attendees/${attendeeExternalId}/check-in`;
}

/** The subset of `LedgerAttendeeDto` the client reads back (`DoorCheckInResult`). */
export interface OrganizerCheckInResult {
  attendeeExternalId: string;
  checkedIn: boolean;
  passNumber?: string | null;
}

export class KefiOrganizerCheckInClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: getKefiUrls().apiUrl,
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /** POST the client-shaped check-in write; returns the raw status + body. */
  async setCheckedIn(input: {
    bearer: string;
    eventExternalId: string;
    attendeeExternalId: string;
    checkedIn?: boolean;
  }): Promise<{ status: number; data: OrganizerCheckInResult | unknown }> {
    const resp = await this.http.post(
      organizerCheckInPath(input.eventExternalId, input.attendeeExternalId),
      buildDoorCheckInBody(input.checkedIn),
      {
        headers: {
          Authorization: `Bearer ${input.bearer}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-BFF-Csrf': '1',
        },
      },
    );
    return { status: resp.status, data: resp.data };
  }
}
