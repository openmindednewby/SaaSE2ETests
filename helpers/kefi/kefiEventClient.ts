/**
 * Server-side client for the Kefi per-event publish E2E (#4). Wraps the
 * tenant-owner event endpoints (create / list / rename-slug / per-event
 * landing-config) and the public, anonymous per-event read endpoints
 * (events list + per-event landing).
 *
 * Split out of {@link KefiAdminClient} so each file stays under the 300-line
 * lint threshold. The tenant-owner ROPC bearer is borrowed from a
 * {@link KefiAdminClient} (its `getTenantOwnerBearer` cache) so we don't
 * duplicate the token mint. The public reads are anonymous (no bearer) —
 * exactly as kefi-landings + a real visitor hit them.
 *
 * Every admin method returns the raw HTTP status alongside the parsed body so
 * the spec can assert BOTH the happy path (200/201) and the rejection paths
 * (400 on a duplicate/invalid slug) without the helper throwing first.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { KefiAdminClient } from './kefiAdminClient.js';
import type { SavedLandingDto } from './kefiKucyShapedConfig.types.js';

/** One event row from POST /admin/events or GET /admin/events. */
export interface MyEventSummary {
  externalId: string;
  name: string;
  slug: string | null;
  dateIso: string;
  venue: string | null;
  status: string;
}

/** Response of GET /api/v1/admin/events. */
export interface MyEventsList {
  tenantSlug: string;
  tenantName: string;
  events: MyEventSummary[];
}

/** One event row in the public GET /t/{slug}/events list. */
export interface PublicEventSummary {
  slug: string;
  name: string;
  date: string;
  status: string;
}

/** Response of the public GET /api/v1/t/{slug}/events. */
export interface PublicTenantEvents {
  tenantSlug: string;
  events: PublicEventSummary[];
}

/** The public event block on GET /t/{slug} or /t/{slug}/{eventSlug}. */
export interface PublicLandingEvent {
  externalId: string;
  slug: string | null;
  name: string;
  date: string;
  venue: string | null;
  status: string;
}

/** Response of GET /api/v1/t/{slug} and /api/v1/t/{slug}/{eventSlug}. */
export interface PublicTenantLanding {
  tenantExternalId: string;
  tenantName: string;
  slug: string;
  template: string;
  event: PublicLandingEvent | null;
}

/** A bare {status, body} pair so the spec can assert on either. */
export interface StatusAnd<T> {
  status: number;
  body: T;
}

/** Owner credentials passed to every admin call (minted via the borrowed admin client). */
export interface OwnerCreds {
  ownerEmail: string;
  ownerPassword: string;
}

export class KefiEventClient {
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

  /** POST /admin/events — create a new event for the calling tenant (expects 201). */
  async createMyEvent(input: OwnerCreds & {
    name: string;
    dateIso: string;
    venue?: string;
  }): Promise<MyEventSummary> {
    const bearer = await this.ownerBearer(input);
    const resp = await this.http.post<MyEventSummary>(
      '/api/v1/admin/events',
      { name: input.name, dateIso: input.dateIso, venue: input.venue },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    this.assertStatus(resp.status, 201, 'POST /admin/events', resp.data);
    return resp.data;
  }

  /** GET /admin/events — list the calling tenant's events (expects 200). */
  async listMyEvents(input: OwnerCreds): Promise<MyEventsList> {
    const bearer = await this.ownerBearer(input);
    const resp = await this.http.get<MyEventsList>('/api/v1/admin/events', {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    this.assertStatus(resp.status, 200, 'GET /admin/events', resp.data);
    return resp.data;
  }

  /**
   * PUT /admin/events/{externalId}/slug — rename an event's per-event slug.
   * Returns the raw status + body so the spec can assert 200 (rename) OR 400
   * (duplicate / invalid slug) without the helper throwing.
   */
  async updateMyEventSlug(input: OwnerCreds & {
    externalId: string;
    slug: string;
  }): Promise<StatusAnd<MyEventSummary | unknown>> {
    const bearer = await this.ownerBearer(input);
    const resp = await this.http.put<MyEventSummary>(
      `/api/v1/admin/events/${encodeURIComponent(input.externalId)}/slug`,
      { slug: input.slug },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return { status: resp.status, body: resp.data };
  }

  /**
   * PUT /admin/events/{externalId}/landing-config — set a specific event's
   * landing config. An event needs a non-empty landing config to appear in the
   * public published-events list (expects 200).
   */
  async putEventLandingConfig(input: OwnerCreds & {
    externalId: string;
    dto: SavedLandingDto;
  }): Promise<void> {
    const bearer = await this.ownerBearer(input);
    const resp = await this.http.put(
      `/api/v1/admin/events/${encodeURIComponent(input.externalId)}/landing-config`,
      input.dto,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    this.assertStatus(resp.status, 200, 'PUT /admin/events/{id}/landing-config', resp.data);
  }

  /** Public, anonymous GET /t/{slug}/events — the published-events list. */
  async getPublicEvents(slug: string): Promise<StatusAnd<PublicTenantEvents>> {
    const resp = await this.http.get<PublicTenantEvents>(
      `/api/v1/t/${encodeURIComponent(slug)}/events`,
    );
    return { status: resp.status, body: resp.data };
  }

  /** Public, anonymous GET /t/{slug}/{eventSlug} — the per-event landing. */
  async getPublicEventLanding(
    slug: string,
    eventSlug: string,
  ): Promise<StatusAnd<PublicTenantLanding>> {
    const resp = await this.http.get<PublicTenantLanding>(
      `/api/v1/t/${encodeURIComponent(slug)}/${encodeURIComponent(eventSlug)}`,
    );
    return { status: resp.status, body: resp.data };
  }

  /** Public, anonymous GET /t/{slug} — the tenant's LATEST event (backward-compat). */
  async getPublicTenantLanding(slug: string): Promise<StatusAnd<PublicTenantLanding>> {
    const resp = await this.http.get<PublicTenantLanding>(`/api/v1/t/${encodeURIComponent(slug)}`);
    return { status: resp.status, body: resp.data };
  }

  private ownerBearer(creds: OwnerCreds): Promise<string> {
    return this.admin.getTenantOwnerBearer({
      email: creds.ownerEmail,
      password: creds.ownerPassword,
    });
  }

  private assertStatus(actual: number, expected: number, path: string, data: unknown): void {
    if (actual !== expected) {
      throw new Error(
        `[kefiEventClient] ${path} expected ${String(expected)}, got ${String(actual)}: ${JSON.stringify(data)}`,
      );
    }
  }
}
