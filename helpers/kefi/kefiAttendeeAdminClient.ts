/**
 * Server-side client for the two organizer ATTENDEE-ADMIN routes the ledger UI
 * runs on — marking money received, and taking the whole roster away as a file:
 *
 *   PATCH /api/v1/admin/attendees/{externalId}/payment   Roles(organizer, tenant-owner)
 *   GET   /api/v1/admin/attendees/export                 Roles(organizer, tenant-owner)
 *
 * Contract facts the specs lock in:
 *
 *  - Mark-paid is a TOGGLE in both directions. `paid: true` records the payment
 *    (filling omitted fields from the row, defaulting the date to today UTC);
 *    `paid: false` calls `MarkUnpaid()`, which flips the row back to `Expected`
 *    AND zeroes `paidEur`. The response echoes `paymentMethod` in **PascalCase**
 *    (`"Cash"`) — note this differs from the ledger payload, which lower-cases it.
 *  - The export is `text/csv` with a **UTF-8 BOM** prefix (so Excel detects the
 *    encoding) and CRLF line endings. The BOM must be stripped before comparing
 *    the header row. `eventExternalId` is optional but REQUIRED for a tenant that
 *    owns more than one event, else 400.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** The mark-payment body. Only `paid` is required. */
export interface MarkPaymentBody {
  paid: boolean;
  paidEur?: number;
  /** cash | card | revolut | bank | other | unspecified (case-insensitive). */
  paymentMethod?: string;
  /** ISO `yyyy-MM-dd`. */
  paidOn?: string;
}

/** The updated attendee (`OrganizerAttendeeDto`) — the slice the specs assert on. */
export interface OrganizerAttendee {
  externalId: string;
  name: string;
  surname: string | null;
  email: string | null;
  passCode: string;
  paidEur: number;
  /** PascalCase enum name, e.g. `"Cash"` / `"Unspecified"`. */
  paymentMethod: string;
  paid: boolean;
  expected: boolean;
  status: string;
}

/** The raw CSV response plus the headers the spec asserts on. */
export interface CsvExportResponse {
  status: number;
  contentType: string;
  contentDisposition: string;
  /** Body with any UTF-8 BOM already stripped. */
  body: string;
  /** True when the raw body began with a UTF-8 BOM (asserted — Excel needs it). */
  hadBom: boolean;
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

/**
 * The decoded UTF-8 byte-order mark (bytes `EF BB BF` → `U+FEFF`).
 *
 * Written as an escape, never as a literal character: a raw BOM in a source
 * file is invisible in every editor and diff, and tooling may normalise or
 * strip it — which silently turns the "the export has a BOM" assertion into a
 * test that can never pass.
 */
const UTF8_BOM = '\uFEFF';

export class KefiAttendeeAdminClient {
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

  /** PATCH one attendee's payment state. 200 / 400 / 403 / 404. */
  async markPayment(
    bearer: string,
    attendeeExternalId: string,
    body: MarkPaymentBody,
  ): Promise<StatusAnd<OrganizerAttendee | unknown>> {
    const resp = await this.http.patch<OrganizerAttendee>(
      `/api/v1/admin/attendees/${encodeURIComponent(attendeeExternalId)}/payment`,
      body,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * GET the attendee CSV export.
   *
   * Requested as an ARRAYBUFFER and decoded here by hand, deliberately: this
   * endpoint's contract is byte-level (UTF-8 BOM, CRLF terminators, RFC-4180
   * quoting), and axios's `responseType: 'text'` path SILENTLY STRIPS the
   * leading BOM while decoding. Asserting "the export has a BOM" against that
   * decoded string is a test that can never pass no matter how correct the
   * server is. Reading the raw bytes is the only way to assert what was
   * actually sent.
   */
  async exportCsv(bearer: string, eventExternalId?: string): Promise<CsvExportResponse> {
    const resp = await this.http.get('/api/v1/admin/attendees/export', {
      headers: this.authHeaders(bearer),
      params: eventExternalId === undefined ? undefined : { eventExternalId },
      responseType: 'arraybuffer',
    });

    // A non-2xx (401/404) carries a JSON/empty body, not CSV — decode either way.
    const raw = Buffer.isBuffer(resp.data)
      ? resp.data.toString('utf8')
      : Buffer.from((resp.data ?? []) as ArrayBuffer).toString('utf8');
    const hadBom = raw.startsWith(UTF8_BOM);
    return {
      status: resp.status,
      contentType: String(resp.headers['content-type'] ?? ''),
      contentDisposition: String(resp.headers['content-disposition'] ?? ''),
      body: hadBom ? raw.slice(UTF8_BOM.length) : raw,
      hadBom,
    };
  }

  /** Bearer header, or none at all when the token is empty (the 401 case). */
  private authHeaders(bearer: string): Record<string, string> | undefined {
    return bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` };
  }
}
