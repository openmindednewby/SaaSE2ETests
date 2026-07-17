/**
 * Server-side client for the Kefi organizer hard-delete-attendee route (#278) —
 * the "undo a mistaken import" removal (`kefi-attendee-delete.spec.ts`). Wraps the
 * one real product route:
 *
 *   DELETE /api/v1/organizer/events/{eventExternalId}/attendees/{attendeeExternalId}
 *     Roles(organizer, tenant-owner)
 *   → 204 No Content on success; 404 when the event or attendee is not in the
 *     caller's tenant.
 *
 * `validateStatus: () => true` so a 404 (unknown attendee / cross-tenant event) is
 * an assertion, not a throw. Pairs with {@link KefiImportClient} which seeds the
 * attendee this client then removes.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** A raw `{ status }` so the spec can assert both 204 and 404. */
export interface DeleteStatus {
  status: number;
}

export class KefiAttendeeDeleteClient {
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

  /** Hard-delete one attendee. Expect 204 on success, 404 when not in tenant. */
  async deleteAttendee(input: {
    bearer: string;
    eventExternalId: string;
    attendeeExternalId: string;
  }): Promise<DeleteStatus> {
    const resp = await this.http.delete(
      this.deletePath(input.eventExternalId, input.attendeeExternalId),
      { headers: { Authorization: `Bearer ${input.bearer}` } },
    );
    return { status: resp.status };
  }

  private deletePath(eventExternalId: string, attendeeExternalId: string): string {
    return (
      `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}` +
      `/attendees/${encodeURIComponent(attendeeExternalId)}`
    );
  }
}
