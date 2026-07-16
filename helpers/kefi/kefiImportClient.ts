/**
 * Server-side client for the Kefi organizer attendee bulk-import (#265) — the
 * "migrating from a spreadsheet" path (`kefi-attendee-import.spec.ts`). Wraps the
 * ONE real product route, which accepts BOTH intake modes keyed off Content-Type:
 *
 *   POST /api/v1/organizer/events/{eventExternalId}/attendees/import
 *     Roles(organizer, tenant-owner)
 *     - application/json    → { attendees: [...], options: { skipDuplicates } }
 *     - multipart/form-data → a `file` field (CSV, header row required) + optional
 *                             `skipDuplicates` form field
 *   → 200 AttendeeImportResult { created, updated, skipped, errorCount, errors[] }
 *
 * Both modes return the SAME summary DTO, so the spec can assert created / skipped
 * / errorCount identically whichever intake it used. `validateStatus: () => true`
 * so a 400 (empty body / over-limit) or 404 (event not in tenant) is an assertion,
 * not a throw.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** One import row (`BulkImportAttendeeRow`). A row is "paid" when paidEur>0 or paymentMethod is set. */
export interface ImportAttendeeRow {
  name: string;
  surname?: string;
  email?: string;
  phone?: string;
  passCode: string;
  paidEur?: number;
  paymentMethod?: string;
  paidOn?: string;
  proVideo?: boolean;
  level?: string;
  danceRole?: string;
  gender?: string;
  note?: string;
  expected?: boolean;
}

/** The import summary (`AttendeeImportResult`), camelCased on the wire. */
export interface AttendeeImportResult {
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  errors: { row: number; field: string | null; message: string }[];
}

/** A raw `{ status, data }` pair so the spec can assert both 200 and 400/404. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

export class KefiImportClient {
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

  /** JSON-body import of an attendee array. Expect 200 + the summary DTO. */
  async importJson(input: {
    bearer: string;
    eventExternalId: string;
    attendees: ImportAttendeeRow[];
    skipDuplicates?: boolean;
  }): Promise<StatusAnd<AttendeeImportResult | unknown>> {
    const body = {
      attendees: input.attendees,
      options: { skipDuplicates: input.skipDuplicates ?? true },
    };
    const resp = await this.http.post<AttendeeImportResult>(
      this.importPath(input.eventExternalId),
      body,
      { headers: { Authorization: `Bearer ${input.bearer}`, 'Content-Type': 'application/json' } },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Multipart CSV import (header row required). Expect 200 + the summary DTO. */
  async importCsv(input: {
    bearer: string;
    eventExternalId: string;
    csv: string;
    skipDuplicates?: boolean;
    filename?: string;
  }): Promise<StatusAnd<AttendeeImportResult | unknown>> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([input.csv], { type: 'text/csv' }),
      input.filename ?? 'attendees.csv',
    );
    form.append('skipDuplicates', String(input.skipDuplicates ?? true));
    // axios (1.4+) serialises a spec FormData to a multipart stream in Node and
    // sets the boundary Content-Type itself — we only add the bearer.
    const resp = await this.http.post<AttendeeImportResult>(
      this.importPath(input.eventExternalId),
      form,
      { headers: { Authorization: `Bearer ${input.bearer}` } },
    );
    return { status: resp.status, data: resp.data };
  }

  private importPath(eventExternalId: string): string {
    return `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}/attendees/import`;
  }
}
