/**
 * Organizer pass-edit surface used by kefi-attendee-pass-edit.spec.ts:
 *
 *   POST /api/v1/organizer/events/{ev}/passes                          create a pass
 *   POST /api/v1/organizer/events/{ev}/attendees                       add an attendee
 *   PUT  /api/v1/organizer/events/{ev}/attendees/{id}                  edit (pass change)
 *   PUT  /api/v1/organizer/events/{ev}/attendees/{id}/price-lock       lock a price + tier label
 *   POST /api/v1/organizer/events/{ev}/guests/convert-to-comps         Guest rows -> comp attendees
 *   GET  /api/v1/organizer/events/{ev}/export-json                     full event graph
 *   POST /api/v1/platform/events/import                                rebuild a graph (platform-admin)
 *
 * Every request is hand-built here, so these calls exercise the server contract
 * only; the kefi-web client's own write shape is not observed.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

export interface StatusAnd<T> {
  status: number;
  data: T;
}

export interface PassEditAttendee {
  externalId: string;
  name: string;
  surname: string | null;
  passCode: string;
  amountDueEur: number;
  priceLocked: boolean;
  lockedPriceEur: number | null;
  priceTierLabel: string | null;
  paymentReference: string | null;
  ticketToken: string | null;
}

export interface NewAttendeeInput {
  name: string;
  surname: string;
  passCode: string;
}

export interface GuestCompConversion {
  converted: number;
  skipped: number;
}

export interface ExportedGuest {
  name: string;
  instagramHandle: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
}

export type ExportedEventGraph = Record<string, unknown> & { guests: ExportedGuest[] };

function eventPath(eventExternalId: string): string {
  return `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}`;
}

export class KefiPassEditClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: getKefiUrls().apiUrl,
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  private auth(bearer: string): { headers: Record<string, string> } {
    return { headers: { Authorization: `Bearer ${bearer}` } };
  }

  async createPass(
    bearer: string,
    eventExternalId: string,
    pass: { code: string; label: string; priceEur: number },
  ): Promise<StatusAnd<unknown>> {
    const resp = await this.http.post(`${eventPath(eventExternalId)}/passes`, pass, this.auth(bearer));
    return { status: resp.status, data: resp.data };
  }

  async createAttendee(
    bearer: string,
    eventExternalId: string,
    input: NewAttendeeInput,
  ): Promise<StatusAnd<PassEditAttendee>> {
    const resp = await this.http.post<PassEditAttendee>(
      `${eventPath(eventExternalId)}/attendees`,
      input,
      this.auth(bearer),
    );
    return { status: resp.status, data: resp.data };
  }

  async changePass(
    bearer: string,
    eventExternalId: string,
    attendee: PassEditAttendee,
    passCode: string,
  ): Promise<StatusAnd<unknown>> {
    const body = { name: attendee.name, surname: attendee.surname, passCode };
    const resp = await this.http.put(
      `${eventPath(eventExternalId)}/attendees/${encodeURIComponent(attendee.externalId)}`,
      body,
      this.auth(bearer),
    );
    return { status: resp.status, data: resp.data };
  }

  async lockPrice(
    bearer: string,
    eventExternalId: string,
    attendeeExternalId: string,
    body: { lockedPriceEur: number | null; tierLabel?: string | null },
  ): Promise<StatusAnd<unknown>> {
    const resp = await this.http.put(
      `${eventPath(eventExternalId)}/attendees/${encodeURIComponent(attendeeExternalId)}/price-lock`,
      body,
      this.auth(bearer),
    );
    return { status: resp.status, data: resp.data };
  }

  async convertGuestsToComps(
    bearer: string,
    eventExternalId: string,
  ): Promise<StatusAnd<GuestCompConversion>> {
    const resp = await this.http.post<GuestCompConversion>(
      `${eventPath(eventExternalId)}/guests/convert-to-comps`,
      {},
      this.auth(bearer),
    );
    return { status: resp.status, data: resp.data };
  }

  async listAttendees(bearer: string, eventExternalId: string): Promise<PassEditAttendee[]> {
    const resp = await this.http.get<{ attendees: PassEditAttendee[] }>(
      eventPath(eventExternalId),
      this.auth(bearer),
    );
    if (resp.status !== 200) {
      throw new Error(`[kefiPassEditClient] GET organizer event ${eventExternalId} -> ${resp.status}`);
    }
    return resp.data.attendees;
  }

  async exportEventGraph(bearer: string, eventExternalId: string): Promise<ExportedEventGraph> {
    const resp = await this.http.get<ExportedEventGraph>(
      `${eventPath(eventExternalId)}/export-json`,
      { ...this.auth(bearer), responseType: 'json' },
    );
    if (resp.status !== 200) {
      throw new Error(`[kefiPassEditClient] export-json ${eventExternalId} -> ${resp.status}`);
    }
    return typeof resp.data === 'string' ? (JSON.parse(resp.data) as ExportedEventGraph) : resp.data;
  }

  async importEventGraph(
    platformBearer: string,
    tenantExternalId: string,
    graph: ExportedEventGraph,
  ): Promise<StatusAnd<{ eventExternalId: string }>> {
    const resp = await this.http.post<{ eventExternalId: string }>(
      '/api/v1/platform/events/import',
      { tenantExternalId, event: graph },
      this.auth(platformBearer),
    );
    return { status: resp.status, data: resp.data };
  }
}
