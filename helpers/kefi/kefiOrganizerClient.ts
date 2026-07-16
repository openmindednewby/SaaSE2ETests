/**
 * Server-side client for the Kefi organizer dashboard / P&L endpoint
 * (`kefi-organizer-pnl.spec.ts` + the critical-path spec's P&L leg). Wraps the
 * one real route that returns the server-computed profit-and-loss picture:
 *
 *   GET /api/v1/organizer/events/{eventExternalId}   Roles(organizer, tenant-owner)
 *   → 200 OrganizerEventDto { ..., pnl: OrganizerPnlDto }  |  404 (no such event)
 *
 * The P&L math keys off the attendee's `Paid`/`Expected` BOOLEANS (set by
 * RecordPayment / MarkExpected), NOT the Status enum — so only genuinely paid
 * attendees (bulk-import with paidEur>0, or a reconciled Stripe payment) move
 * gross/net. A canary-seeded "Paid" status attendee stays financially invisible.
 *
 * `validateStatus: () => true` so the 404 / 401 / 403 negatives are assertions.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** One per-pass P&L line (`OrganizerPnlPassLineDto`). */
export interface OrganizerPnlPassLine {
  passCode: string;
  label: string;
  paidCount: number;
  grossRevenueEur: number;
}

/** The P&L block (`OrganizerPnlDto`) — the numbers the spec asserts on. */
export interface OrganizerPnl {
  grossPassRevenueEur: number;
  expectedOutstandingEur: number;
  venueShareEur: number;
  promoterPayoutTotalEur: number;
  organizerShareEur: number;
  fixedCostTotalEur: number;
  crewCostTotalEur: number;
  netProfitEur: number;
  paidAttendeeCount: number;
  expectedAttendeeCount: number;
  passLines: OrganizerPnlPassLine[];
}

/** The slice of `OrganizerEventDto` the spec reads. */
export interface OrganizerEventDto {
  eventExternalId: string;
  eventName: string;
  status: string;
  pnl: OrganizerPnl;
  attendees: { externalId: string; email: string | null; status: string }[];
}

/** A raw `{ status, data }` pair so the spec can assert 200 and 404/401/403. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

export class KefiOrganizerClient {
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

  /**
   * GET the organizer event + P&L. Pass an empty bearer for the 401 auth-wall
   * assertion; a valid non-crew bearer for the 403 role-wall assertion.
   */
  async getOrganizerEvent(
    bearer: string,
    eventExternalId: string,
  ): Promise<StatusAnd<OrganizerEventDto | unknown>> {
    const headers = bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` };
    const resp = await this.http.get<OrganizerEventDto>(
      `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}`,
      headers === undefined ? undefined : { headers },
    );
    return { status: resp.status, data: resp.data };
  }
}
