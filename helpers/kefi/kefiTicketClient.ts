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
  /** Human-readable pass number (`UBB-0163`) — what the buyer quotes at the door. */
  passNumber: string | null;
  /** Whether the attendee has actually paid. Drives "not valid until paid". */
  paid: boolean | null;
  /**
   * The tenant's payment instructions block.
   *
   * MUST be `null` when the tenant has configured no payment provider — NOT an
   * object of empty strings. A hollow object renders as a payment panel with
   * blank fields, which reads to a buyer as "pay here" with nowhere to pay.
   * `undefined` (key absent) is distinguished from `null` by {@link paymentKeyPresent}.
   */
  payment: unknown;
  /** True when the response body actually carried a `payment` key. */
  paymentKeyPresent: boolean;
  /** The raw serialized body — so a spec can scan it for secret-bearing fields. */
  raw: string;
}

/** The slice of the GDPR export (`TicketDataExportDto.Attendee`) the GDPR spec asserts on. */
export interface TicketExportResponse {
  status: number;
  attendeeExternalId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  isErased: boolean | null;
}

/** The GDPR erasure result (`TicketErasureResultDto`) — `attendeeErased` is the idempotency signal. */
export interface TicketErasureResponse {
  status: number;
  attendeeErased: boolean | null;
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
      passNumber?: string;
      paid?: boolean;
      payment?: unknown;
      event?: { externalId?: string } | null;
    };
    return {
      status: resp.status,
      attendeeExternalId: data.attendeeExternalId ?? null,
      statusLabel: data.status ?? null,
      eventExternalId: data.event?.externalId ?? null,
      passCode: data.passCode ?? null,
      passNumber: data.passNumber ?? null,
      paid: data.paid ?? null,
      payment: data.payment,
      paymentKeyPresent: Object.prototype.hasOwnProperty.call(data, 'payment'),
      raw: JSON.stringify(resp.data ?? null),
    };
  }

  /** GET the public `/mediaTicket` alias — same payload, returns the HTTP status. */
  async getMediaTicketStatus(token: string): Promise<number> {
    const resp = await this.http.get(`/api/v1/mediaTicket/${encodeURIComponent(token)}`);
    return resp.status;
  }

  /**
   * GET the anonymous GDPR data-subject export (`/ticket/{token}/export`). 200 +
   * the token-holder's own attendee PII on a valid token; 404 otherwise. After an
   * erasure, `isErased` is true and the contact PII is cleared.
   */
  async exportTicketData(token: string): Promise<TicketExportResponse> {
    const resp = await this.http.get(`/api/v1/ticket/${encodeURIComponent(token)}/export`);
    const attendee = ((resp.data ?? {}) as { attendee?: {
      externalId?: string; name?: string; email?: string | null; phone?: string | null; isErased?: boolean;
    } }).attendee ?? {};
    return {
      status: resp.status,
      attendeeExternalId: attendee.externalId ?? null,
      name: attendee.name ?? null,
      email: attendee.email ?? null,
      phone: attendee.phone ?? null,
      isErased: attendee.isErased ?? null,
    };
  }

  /**
   * POST the anonymous GDPR right-to-erasure (`/ticket/{token}/erasure`). 200 +
   * `{ attendeeErased }` on a valid token (true the first time, false as an
   * idempotent no-op thereafter); 404 for a bogus token.
   */
  async eraseTicketData(token: string): Promise<TicketErasureResponse> {
    // Empty JSON body so FastEndpoints gets an application/json Content-Type
    // (a bodyless POST to a typed-request endpoint 415s).
    const resp = await this.http.post(`/api/v1/ticket/${encodeURIComponent(token)}/erasure`, {});
    const data = (resp.data ?? {}) as { attendeeErased?: boolean };
    return { status: resp.status, attendeeErased: data.attendeeErased ?? null };
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
