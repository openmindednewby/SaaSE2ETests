/**
 * Server-side client for the Kefi custom-domain E2E (#5). Wraps the four
 * tenant-owner endpoints (GET / PUT / POST verify / DELETE
 * `/api/v1/admin/custom-domain`).
 *
 * Mirrors {@link KefiEventClient}: borrows the tenant-owner ROPC bearer from a
 * {@link KefiAdminClient}, hits the kefi-api directly (NOT the BFF) with the
 * global `/api/v1` prefix, and returns the raw HTTP status alongside the parsed
 * body so the spec can assert both happy paths and rejections without the helper
 * throwing first.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { KefiAdminClient } from './kefiAdminClient.js';

/** Response of every /admin/custom-domain endpoint. */
export interface CustomDomainStatusDto {
  customDomain: string | null;
  status: 'None' | 'PendingDns' | 'Active' | 'Failed';
  /** CNAME host for a subdomain; null for an apex domain or when none is set. */
  cnameTarget: string | null;
  /** DNS record type — 'CNAME' (subdomain) or 'A' (apex, #240); null when none. */
  recordType: 'CNAME' | 'A' | null;
  /** A-record IP for an apex domain (recordType === 'A'); null otherwise. */
  apexTarget: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

/** A bare {status, body} pair so the spec can assert on either. */
export interface StatusAnd<T> {
  status: number;
  body: T;
}

/** Owner credentials passed to every admin call. */
export interface OwnerCreds {
  ownerEmail: string;
  ownerPassword: string;
}

export class KefiCustomDomainClient {
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();

  constructor(private readonly admin: KefiAdminClient) {
    this.http = axios.create({
      baseURL: this.urls.apiUrl,
      timeout: 30000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /** GET /admin/custom-domain — current status (expects 200). */
  async get(creds: OwnerCreds): Promise<StatusAnd<CustomDomainStatusDto>> {
    const bearer = await this.ownerBearer(creds);
    const resp = await this.http.get<CustomDomainStatusDto>('/api/v1/admin/custom-domain', {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    return { status: resp.status, body: resp.data };
  }

  /** PUT /admin/custom-domain — set/replace the domain. 200 / 400 / 409. */
  async set(creds: OwnerCreds, domain: string): Promise<StatusAnd<CustomDomainStatusDto>> {
    const bearer = await this.ownerBearer(creds);
    const resp = await this.http.put<CustomDomainStatusDto>(
      '/api/v1/admin/custom-domain',
      { domain },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return { status: resp.status, body: resp.data };
  }

  /** POST /admin/custom-domain/verify — 200 even on verification failure. */
  async verify(creds: OwnerCreds): Promise<StatusAnd<CustomDomainStatusDto>> {
    const bearer = await this.ownerBearer(creds);
    const resp = await this.http.post<CustomDomainStatusDto>(
      '/api/v1/admin/custom-domain/verify',
      undefined,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return { status: resp.status, body: resp.data };
  }

  /** DELETE /admin/custom-domain — clear + deprovision (expects 200). */
  async clear(creds: OwnerCreds): Promise<StatusAnd<CustomDomainStatusDto>> {
    const bearer = await this.ownerBearer(creds);
    const resp = await this.http.delete<CustomDomainStatusDto>('/api/v1/admin/custom-domain', {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    return { status: resp.status, body: resp.data };
  }

  private ownerBearer(creds: OwnerCreds): Promise<string> {
    return this.admin.getTenantOwnerBearer({
      email: creds.ownerEmail,
      password: creds.ownerPassword,
    });
  }
}
