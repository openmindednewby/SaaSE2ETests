/**
 * Server-side client for the Kefi public-ticket + door endpoints — the surfaces
 * the QR-ticket / door-check-in E2E (`kefi-qr-checkin.spec.ts`) drives directly.
 *
 * All three are real product routes:
 *   - GET /api/v1/ticket/{token}            anonymous HMAC ticket render/verify
 *   - GET /api/v1/mediaTicket/{token}       anonymous alias (Pro-Video framing)
 *   - GET /api/v1/door/events/{eventId}     door-staff role-gated door list
 *   - GET  /api/v1/admit/{token}            anonymous ADMISSION confirm (READ-ONLY)
 *   - POST /api/v1/admit/{token}/check-in   anonymous ADMISSION write (200/409/422)
 *
 * The admit pair (R12) is what a phone camera reaches: the ticket QR encodes
 * `admitUrl`, not the ticket URL. The GET deliberately MUTATES NOTHING (a link
 * preview fetched by WhatsApp must not admit anybody), and a REPEAT scan is a
 * normal outcome — HTTP 409 with `outcome:"AlreadyCheckedIn"` and the earlier
 * stamp on `previousCheckIn` — NOT an error.
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
   * Absolute URL the ticket's scannable symbol encodes — `/admit/{admitToken}`.
   *
   * The admit token is an HMAC over a SEPARATE purpose label, so it is NOT
   * derivable from the read token already in the page URL. That separation is
   * what stops a forwarded ticket link from doubling as a check-in button, so a
   * spec must take the admit token from HERE and never re-use `token`.
   */
  admitUrl: string | null;
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


/** One check-in stamp (`AdmitCheckInStampDto`) — "21:04 · QrScan · Door A". */
export interface AdmitStamp {
  atUtc: string | null;
  via: string | null;
  actorLabel: string | null;
  deviceLabel: string | null;
}

/** The read-only admission projection (`AdmitTicketDto`) from `GET /admit/{token}`. */
export interface AdmitTicketResponse {
  status: number;
  attendeeExternalId: string | null;
  name: string | null;
  passNumber: string | null;
  passCode: string | null;
  paid: boolean | null;
  eventName: string | null;
  /** False for a cancelled / refunded row — the door must not admit it. */
  admissible: boolean | null;
  /** The stamp already on the row, or null when the pass has not been used. */
  existingCheckIn: AdmitStamp | null;
}

/** The admission write result (`AdmitResultDto`) from `POST /admit/{token}/check-in`. */
export interface AdmitResultResponse {
  status: number;
  /** `CheckedIn` (200) · `AlreadyCheckedIn` (409) · `Refused` (422). */
  outcome: string | null;
  attendeeExternalId: string | null;
  passNumber: string | null;
  paid: boolean | null;
  /** The stamp THIS scan wrote. Null when refused. */
  checkIn: AdmitStamp | null;
  /** The stamp that was ALREADY there. Populated only on `AlreadyCheckedIn`. */
  previousCheckIn: AdmitStamp | null;
}

/**
 * Pull the admit token out of an absolute `admitUrl`
 * (`https://app.kefi.dloizides.com/admit/{admitToken}`).
 *
 * Parsed rather than string-split so a trailing slash or a query string cannot
 * silently yield a token that then 404s and gets misread as "the endpoint is
 * broken".
 */
export function admitTokenFromUrl(admitUrl: string): string {
  const segments = new URL(admitUrl).pathname.split('/').filter((part) => part.length > 0);
  return segments[segments.length - 1] ?? '';
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
      admitUrl?: string;
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
      admitUrl: data.admitUrl ?? null,
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
   * GET the anonymous admission projection. 200 + the holder's own row for a
   * genuine admit token; 404 for anything else.
   *
   * READ-ONLY by contract: calling this must never change attendance, which is
   * why the spec asserts the row is still un-stamped afterwards.
   */
  async getAdmit(admitToken: string): Promise<AdmitTicketResponse> {
    const resp = await this.http.get(`/api/v1/admit/${encodeURIComponent(admitToken)}`);
    const data = (resp.data ?? {}) as Record<string, unknown>;
    return {
      status: resp.status,
      attendeeExternalId: (data.attendeeExternalId as string) ?? null,
      name: (data.name as string) ?? null,
      passNumber: (data.passNumber as string) ?? null,
      passCode: (data.passCode as string) ?? null,
      paid: (data.paid as boolean) ?? null,
      eventName: (data.eventName as string) ?? null,
      admissible: (data.admissible as boolean) ?? null,
      existingCheckIn: (data.existingCheckIn as AdmitStamp) ?? null,
    };
  }

  /**
   * POST the anonymous admission write. 200 `CheckedIn` · 409 `AlreadyCheckedIn`
   * (with `previousCheckIn`) · 422 `Refused` · 404 unknown token.
   *
   * A 409 is a NORMAL outcome of a second scan, not a transport failure — hence
   * `validateStatus: () => true` on the shared instance.
   */
  async admitCheckIn(admitToken: string, deviceLabel?: string): Promise<AdmitResultResponse> {
    const resp = await this.http.post(
      `/api/v1/admit/${encodeURIComponent(admitToken)}/check-in`,
      deviceLabel === undefined ? {} : { deviceLabel },
    );
    const data = (resp.data ?? {}) as Record<string, unknown>;
    return {
      status: resp.status,
      outcome: (data.outcome as string) ?? null,
      attendeeExternalId: (data.attendeeExternalId as string) ?? null,
      passNumber: (data.passNumber as string) ?? null,
      paid: (data.paid as boolean) ?? null,
      checkIn: (data.checkIn as AdmitStamp) ?? null,
      previousCheckIn: (data.previousCheckIn as AdmitStamp) ?? null,
    };
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
