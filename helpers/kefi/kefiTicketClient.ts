/**
 * Server-side client for the Kefi public-ticket + door endpoints — the surfaces
 * the QR-ticket / door-check-in E2E (`kefi-qr-checkin.spec.ts`) drives directly.
 *
 * All three are real product routes:
 *   - GET /api/v1/ticket/{token}            anonymous HMAC ticket render/verify
 *   - GET /api/v1/mediaTicket/{token}       anonymous alias (Pro-Video framing)
 *   - GET /api/v1/door/events/{eventId}     door-staff role-gated door list
 *
 * The ticket routes are anonymous (the HMAC token IS the credential), so they
 * carry no bearer — exactly as a real attendee hits them. The door route takes
 * an optional bearer so the spec can assert the role gate (no bearer → 401,
 * wrong-role bearer → 403).
 *
 * `validateStatus: () => true` so the caller asserts on the status itself (a 404
 * for a tampered token is an expected outcome, not a transport error).
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

/** The narrow slice of the public `TicketDto` the QR/check-in spec asserts on. */
export interface TicketResponse {
  status: number;
  attendeeExternalId: string | null;
  /** Lifecycle status string — "Expected" / "Paid" / "CheckedIn" / "Cancelled". */
  statusLabel: string | null;
  eventExternalId: string | null;
  passCode: string | null;
}

export class KefiTicketClient {
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();

  constructor() {
    this.http = axios.create({
      baseURL: this.urls.apiUrl,
      timeout: 30_000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /** GET the public HMAC ticket page. 200 + projection on a valid token, 404 otherwise. */
  async getTicket(token: string): Promise<TicketResponse> {
    const resp = await this.http.get(`/api/v1/ticket/${encodeURIComponent(token)}`);
    const data = (resp.data ?? {}) as {
      attendeeExternalId?: string;
      status?: string;
      passCode?: string;
      event?: { externalId?: string } | null;
    };
    return {
      status: resp.status,
      attendeeExternalId: data.attendeeExternalId ?? null,
      statusLabel: data.status ?? null,
      eventExternalId: data.event?.externalId ?? null,
      passCode: data.passCode ?? null,
    };
  }

  /** GET the public `/mediaTicket` alias — same payload, returns the HTTP status. */
  async getMediaTicketStatus(token: string): Promise<number> {
    const resp = await this.http.get(`/api/v1/mediaTicket/${encodeURIComponent(token)}`);
    return resp.status;
  }

  /**
   * GET the door-staff door list for an event. Returns the HTTP status only —
   * the spec uses this purely to assert the `door-staff` role gate (no bearer →
   * 401, wrong-role bearer → 403). A genuine door-staff PIN token is not mintable
   * from an E2E ROPC flow (it comes from the Keycloak pin-authenticator JAR).
   */
  async getDoorListStatus(eventExternalId: string, bearer?: string): Promise<number> {
    const headers = bearer === undefined ? undefined : { Authorization: `Bearer ${bearer}` };
    const resp = await this.http.get(
      `/api/v1/door/events/${encodeURIComponent(eventExternalId)}`,
      headers === undefined ? undefined : { headers },
    );
    return resp.status;
  }
}
