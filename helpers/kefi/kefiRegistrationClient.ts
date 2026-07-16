/**
 * Server-side client for the Kefi registration-request submit → approve/reject
 * flow (`kefi-registration-approval.spec.ts`). Wraps the four real product
 * routes the operational "attendee requests a spot; organizer approves or
 * rejects" loop runs on:
 *
 *   - POST /api/v1/ambassador/registration-requests                        Roles(ambassador)
 *   - GET  /api/v1/organizer/registration-requests[?status=Pending|...]    Roles(organizer, tenant-owner)
 *   - POST /api/v1/organizer/registration-requests/{id}/approve            Roles(organizer, tenant-owner)
 *   - POST /api/v1/organizer/registration-requests/{id}/reject             Roles(organizer, tenant-owner)
 *
 * Every method takes an explicit bearer (the ambassador token for submit, the
 * organizer/tenant-owner token for the queue + decisions) and returns the raw
 * `{ status, data }` so the spec can assert BOTH the happy path (200/201) and
 * the rejection paths (400/401/403/404/409) without the helper throwing first.
 *
 * `validateStatus: () => true` for exactly that reason — a 409 double-approve or
 * a 403 role-wall is an expected assertion, not a transport error.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** The submit body (`SubmitRegistrationRequestBody`) an ambassador posts. */
export interface SubmitRegistrationRequestBody {
  name: string;
  surname?: string;
  phone?: string;
  email?: string;
  passCode: string;
  proVideoOptIn?: boolean;
}

/** One row of `RegistrationRequestDto` — the slice the spec asserts on. */
export interface RegistrationRequestDto {
  externalId: string;
  eventExternalId: string;
  eventName: string;
  submittedByUserId: string;
  status: string;
  attendeeName: string;
  attendeeSurname: string | null;
  attendeePhone: string | null;
  attendeeEmail: string | null;
  passCode: string;
  proVideoOptIn: boolean;
  createdAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
}

/** A raw `{ status, data }` pair so the spec can assert on either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

export class KefiRegistrationClient {
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

  /** Submit a registration request as an ambassador. Expect 201 on success. */
  async submit(
    bearer: string,
    body: SubmitRegistrationRequestBody,
  ): Promise<StatusAnd<RegistrationRequestDto | unknown>> {
    const resp = await this.http.post<RegistrationRequestDto>(
      '/api/v1/ambassador/registration-requests',
      body,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * List the tenant's registration queue as an organizer / tenant-owner.
   * `status` (Pending / Approved / Rejected) narrows the queue; omit for all.
   * Expect 200 + `{ requests: RegistrationRequestDto[] }`.
   */
  async list(
    bearer: string,
    status?: 'Pending' | 'Approved' | 'Rejected',
  ): Promise<StatusAnd<{ requests: RegistrationRequestDto[] } | unknown>> {
    const resp = await this.http.get<{ requests: RegistrationRequestDto[] }>(
      '/api/v1/organizer/registration-requests',
      {
        headers: this.authHeaders(bearer),
        params: status === undefined ? undefined : { status },
      },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Approve a pending request. Expect 200 (Approved) / 404 / 409 (already decided). */
  async approve(
    bearer: string,
    requestExternalId: string,
  ): Promise<StatusAnd<RegistrationRequestDto | unknown>> {
    const resp = await this.http.post<RegistrationRequestDto>(
      `/api/v1/organizer/registration-requests/${encodeURIComponent(requestExternalId)}/approve`,
      undefined,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Reject a pending request with a required reason. Expect 200 (Rejected) / 400 / 409. */
  async reject(
    bearer: string,
    requestExternalId: string,
    rejectReason: string,
  ): Promise<StatusAnd<RegistrationRequestDto | unknown>> {
    const resp = await this.http.post<RegistrationRequestDto>(
      `/api/v1/organizer/registration-requests/${encodeURIComponent(requestExternalId)}/reject`,
      { rejectReason },
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Bearer header, or no Authorization at all when the token is empty (the 401 case). */
  private authHeaders(bearer: string): Record<string, string> | undefined {
    return bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` };
  }
}
