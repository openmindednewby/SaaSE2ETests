/**
 * Server-side client for the Kefi freemium-gate E2E (`kefi-pro-gates.spec.ts`,
 * KEFI-2). Wraps the two tenant-owner endpoints whose canonical helpers
 * ({@link KefiEventClient}, {@link KefiPaymentClient}) THROW on a non-2xx —
 * unusable for a spec that must assert the 403 a Free tenant gets:
 *
 *   - POST /api/v1/admin/events             (create event — 403 on a Free 2nd event)
 *   - PUT  /api/v1/admin/stripe-credentials (store/clear keys — 403 on Free store)
 *
 * Both methods return the raw `{ status, body }` so the spec can assert the
 * negative path (403) AND the positive control (2xx after a Pro grant) without
 * the helper throwing first. The custom-domain gate reuses the existing
 * {@link KefiCustomDomainClient.set} (it already returns `{ status, body }`).
 *
 * The tenant-owner ROPC bearer is borrowed from a {@link KefiAdminClient} (its
 * `getTenantOwnerBearer` cache) exactly as the sibling kefi clients do — no
 * duplicate token mint. Hits kefi-api directly (NOT the BFF) with the `/api/v1`
 * prefix, mirroring kefiEventClient + kefiCustomDomainClient.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { KefiAdminClient } from './kefiAdminClient.js';

/** A bare `{ status, body }` pair so the spec can assert on either. */
export interface StatusAnd<T> {
  status: number;
  body: T;
}

/** Owner credentials passed to every admin call (minted via the borrowed admin client). */
export interface OwnerCreds {
  ownerEmail: string;
  ownerPassword: string;
}

/** Body of PUT /admin/stripe-credentials — store (keys + enable) or clear. */
export interface UpdateStripeCredentialsBody {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePaymentsEnabled: boolean;
  /** When true, removes stored credentials — allowed on Free (downgrade path). */
  clear?: boolean;
}

export class KefiProGatesClient {
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

  /** Raw POST /admin/events — 201 (created) or 403 (Free freemium gate). */
  async createEvent(
    creds: OwnerCreds,
    input: { name: string; dateIso: string; venue?: string },
  ): Promise<StatusAnd<unknown>> {
    const bearer = await this.ownerBearer(creds);
    const resp = await this.http.post(
      '/api/v1/admin/events',
      { name: input.name, dateIso: input.dateIso, venue: input.venue },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return { status: resp.status, body: resp.data };
  }

  /** Raw PUT /admin/stripe-credentials — store (2xx/403) or clear (2xx on Free). */
  async updateStripeCredentials(
    creds: OwnerCreds,
    body: UpdateStripeCredentialsBody,
  ): Promise<StatusAnd<unknown>> {
    const bearer = await this.ownerBearer(creds);
    const resp = await this.http.put('/api/v1/admin/stripe-credentials', body, {
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
