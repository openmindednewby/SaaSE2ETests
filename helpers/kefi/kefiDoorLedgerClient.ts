/**
 * Server-side client for the two TOKEN-GATED public event-ops routes — the ones
 * a door person or an accountant reaches from a pasted link, with no login:
 *
 *   GET  /api/v1/t/{slug}/ledger?token=…            anonymous (token IS the credential)
 *   POST /api/v1/t/{slug}/checkin?token=…           anonymous (token IS the credential)
 *
 * Contract facts the specs lock in:
 *
 *  - The ledger route is DUAL-auth: a `token` wins when present, otherwise an
 *    `organizer` / `tenant-owner` bearer whose tenant matches the slug gets full
 *    Ledger scope. A caller with neither is 403.
 *  - Scope drives the payload, not the route. `pnl` is populated ONLY for Ledger
 *    scope — it is `null` for both Door and Promoter. Promoter scope additionally
 *    filters `attendees` to that promoter's referrals and `promoters` to one row.
 *  - Check-in requires Door scope OR HIGHER on the capability ladder
 *    (Promoter=1 < Door=2 < Ledger=3), so a Promoter token is 403 while a Ledger
 *    token may check in.
 *  - An unknown, blank or REVOKED token is **404**, not 401 — there is no
 *    "unauthorized" status anywhere on these routes.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** One attendee row of the ledger payload (`LedgerAttendeeDto`). */
export interface LedgerAttendee {
  name: string;
  surname: string | null;
  email: string | null;
  phone: string | null;
  pass: string;
  paidEur: number;
  /** Lower-case token; empty string when unspecified. */
  paymentMethod: string;
  paidOn: string | null;
  paid: boolean;
  expected: boolean;
  referredBy: string | null;
  checkedIn: boolean;
  attendeeExternalId: string;
}

/** One per-pass P&L line. */
export interface LedgerPnlPassLine {
  passCode: string;
  label: string;
  paidCount: number;
  grossRevenueEur: number;
}

/** The P&L block — present only for Ledger scope. */
export interface LedgerPnl {
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
  passLines: LedgerPnlPassLine[];
}

/** A promoter row with payout state. */
export interface LedgerPromoter {
  externalId: string;
  name: string;
  role: string;
  paidReferralCount: number;
  payoutEur: number;
  paid: boolean;
}

/** One person a promoter referred, as the promoter sees them. */
export interface LedgerCrewReferral {
  name: string;
  surname: string | null;
  pass: string;
  paidEur: number;
  paid: boolean;
  paidOn: string | null;
}

/**
 * The viewer's OWN crew deal (`LedgerCrewDto`) — terms, expected payout and the
 * people they brought.
 *
 * Present on the PROMOTER-scope branch only; null for door, ledger and organizer
 * callers. `expectedPayoutEur` is copied from the P&L promoter line and never
 * recomputed here, so the promoter's view and the organizer's books cannot
 * disagree.
 */
export interface LedgerCrew {
  promoterName: string;
  role: string;
  termsHtml: string | null;
  paidReferralCount: number;
  expectedPayoutEur: number;
  settled: boolean;
  referrals: LedgerCrewReferral[];
}

/** The scope-filtered ledger payload (`LedgerViewDto`). */
export interface LedgerView {
  scope: string;
  event: { externalId: string; name: string; date: string; venue: string | null; status: string };
  passes: { code: string; label: string; priceEur: number }[];
  compRules: { passCode: string; venueShareEur: number; organizerShareEur: number; promoterShareEur: number }[];
  promoters: LedgerPromoter[];
  attendees: LedgerAttendee[];
  pnl: LedgerPnl | null;
  /** The viewer's own crew deal. Promoter scope only; null everywhere else. */
  crew: LedgerCrew | null;
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

export class KefiDoorLedgerClient {
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
   * Read the ledger with an access-link token (the anonymous path). Pass a blank
   * or revoked token to assert the 404 wall.
   */
  async getLedgerByToken(slug: string, token: string): Promise<StatusAnd<LedgerView | unknown>> {
    const resp = await this.http.get<LedgerView>(this.ledgerPath(slug), { params: { token } });
    return { status: resp.status, data: resp.data };
  }

  /**
   * Read the ledger as a logged-in organizer / tenant-owner (the bearer path).
   * Always resolves to Ledger scope when the caller's tenant matches the slug.
   */
  async getLedgerByBearer(
    slug: string,
    bearer: string,
    eventExternalId?: string,
  ): Promise<StatusAnd<LedgerView | unknown>> {
    const resp = await this.http.get<LedgerView>(this.ledgerPath(slug), {
      headers: bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` },
      params: eventExternalId === undefined ? undefined : { eventExternalId },
    });
    return { status: resp.status, data: resp.data };
  }

  /**
   * Toggle an attendee's check-in with a Door-or-higher token. 200 + the updated
   * ledger row; 403 for a Promoter token; 404 for an unknown token or attendee.
   */
  async checkIn(input: {
    slug: string;
    token: string;
    attendeeExternalId: string;
    checkedIn: boolean;
    markPaid?: boolean;
  }): Promise<StatusAnd<LedgerAttendee | unknown>> {
    const resp = await this.http.post<LedgerAttendee>(
      `/api/v1/t/${encodeURIComponent(input.slug)}/checkin`,
      {
        attendeeExternalId: input.attendeeExternalId,
        checkedIn: input.checkedIn,
        markPaid: input.markPaid ?? false,
      },
      { params: { token: input.token } },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * Re-read one attendee row straight from the server — the PERSISTENCE proof a
   * check-in spec needs. Returns null when the row is not in the payload.
   */
  async readAttendeeRow(
    slug: string,
    token: string,
    attendeeExternalId: string,
  ): Promise<LedgerAttendee | null> {
    const resp = await this.getLedgerByToken(slug, token);
    if (resp.status !== 200) return null;
    const view = resp.data as LedgerView;
    return view.attendees.find((a) => a.attendeeExternalId === attendeeExternalId) ?? null;
  }

  private ledgerPath(slug: string): string {
    return `/api/v1/t/${encodeURIComponent(slug)}/ledger`;
  }
}
