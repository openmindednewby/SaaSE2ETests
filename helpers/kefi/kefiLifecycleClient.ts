/**
 * Server-side client for the Phase 13 lifecycle-email E2E (#185). Wraps the
 * canary-scoped seeding/read endpoints + the reminder/thank-you trigger sweeps +
 * the public attendee-register + one-click unsubscribe. Split out of
 * kefiAdminClient so each file stays under the 300-line lint threshold.
 *
 * The platform-admin bearer is borrowed from a {@link KefiAdminClient} so we
 * don't duplicate the ROPC mint. The public register + the List-Unsubscribe POST
 * are anonymous (no bearer) — exactly as a real attendee hits them.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';
import type { KefiAdminClient } from './kefiAdminClient.js';

export interface SeedCanaryEventResult {
  canaryId: string;
  found: boolean;
  slug: string;
  eventExternalId: string;
  status: string;
  eventDate: string;
  passCode: string;
}

export interface SeedCanaryAttendeeResult {
  canaryId: string;
  found: boolean;
  attendeeExternalId: string;
  email: string;
  status: string;
}

export interface CanaryAttendeeState {
  externalId: string;
  email: string | null;
  status: string;
  consentGivenAtUtc: string | null;
  unsubscribedAtUtc: string | null;
  reminderD7SentAtUtc: string | null;
  reminderD1SentAtUtc: string | null;
  thankYouSentAtUtc: string | null;
}

export interface CanaryAttendeesResult {
  canaryId: string;
  found: boolean;
  slug: string;
  attendees: CanaryAttendeeState[];
}

export interface SweepCounts {
  eventsProcessed: number;
  attendeeRemindersSent?: number;
  attendeeThankYousSent?: number;
  organizerSummariesSent: number;
}

export interface RegisterAttendeeInput {
  slug: string;
  name: string;
  surname: string;
  phone: string;
  email: string;
  passCode: string;
  consentGiven: boolean;
  /**
   * Optional per-event slug (#4). When supplied, books THAT event; when absent,
   * the tenant's latest event (backward-compatible). Omitted entirely from the
   * request body when undefined so legacy callers send the exact same payload.
   */
  eventSlug?: string;
}

/**
 * Full public register response. #177 needs the attendee id + the advertised
 * provider kind; #4 needs the booked event so the spec can assert WHICH event a
 * registration landed on (`eventName` / `eventExternalId`).
 */
export interface RegisterAttendeeResult {
  status: number;
  attendeeExternalId: string | null;
  paymentProviderKind: string | null;
  eventExternalId: string | null;
  eventName: string | null;
  /**
   * The HMAC-signed ticket token minted at registration (P4.3). Drives the QR /
   * check-in spec, which fetches the public ticket page with it. Null when the
   * register call did not return one (e.g. a non-201 response).
   */
  ticketToken: string | null;
  /** The relative ticket path — `/ticket/{token}` — returned alongside the token. */
  ticketPath: string | null;
}

export class KefiLifecycleClient {
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

  /** Public, anonymous attendee registration. Returns the HTTP status (201 / 400 / 404). */
  async registerAttendee(input: RegisterAttendeeInput): Promise<number> {
    const resp = await this.http.post(
      `/api/v1/t/${encodeURIComponent(input.slug)}/register`,
      this.registerBody(input),
    );
    return resp.status;
  }

  /**
   * Public, anonymous register that returns the parsed body too (#177 + #4).
   * Lets the payment spec capture the attendee externalId + the advertised
   * `payment.providerKind`, and the per-event spec assert WHICH event was booked
   * (`eventName` / `eventExternalId`). Mirrors {@link registerAttendee}'s shape.
   */
  async registerAttendeeFull(input: RegisterAttendeeInput): Promise<RegisterAttendeeResult> {
    const resp = await this.http.post(
      `/api/v1/t/${encodeURIComponent(input.slug)}/register`,
      this.registerBody(input),
    );
    const data = (resp.data ?? {}) as {
      attendeeExternalId?: string;
      eventExternalId?: string;
      eventName?: string;
      payment?: { providerKind?: string | null } | null;
      ticketToken?: string;
      ticketPath?: string;
    };
    return {
      status: resp.status,
      attendeeExternalId: data.attendeeExternalId ?? null,
      paymentProviderKind: data.payment?.providerKind ?? null,
      eventExternalId: data.eventExternalId ?? null,
      eventName: data.eventName ?? null,
      ticketToken: data.ticketToken ?? null,
      ticketPath: data.ticketPath ?? null,
    };
  }

  /**
   * Build the public register request body. `eventSlug` is included ONLY when
   * supplied so legacy callers send the identical pre-#4 payload.
   */
  private registerBody(input: RegisterAttendeeInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      name: input.name,
      surname: input.surname,
      phone: input.phone,
      email: input.email,
      passCode: input.passCode,
      proVideoOptIn: false,
      consentGiven: input.consentGiven,
    };
    if (input.eventSlug !== undefined) {
      body.eventSlug = input.eventSlug;
    }
    return body;
  }

  /** Move the canary tenant's event into a sweep window + ensure a pass. */
  async seedCanaryEvent(input: {
    canaryId: string;
    eventDateOffsetDays: number;
    status: string;
    passCode: string;
    passLabel: string;
    priceEur: number;
  }): Promise<SeedCanaryEventResult> {
    return this.postAdmin<SeedCanaryEventResult>(
      '/api/v1/admin/lifecycle/seed-canary-event', input);
  }

  /** Upsert a canary attendee (by email) on the canary event. */
  async seedCanaryAttendee(input: {
    canaryId: string;
    email: string;
    passCode: string;
    status: string;
    consentGiven: boolean;
  }): Promise<SeedCanaryAttendeeResult> {
    return this.postAdmin<SeedCanaryAttendeeResult>(
      '/api/v1/admin/lifecycle/seed-canary-attendee', input);
  }

  /** Read the attendee opt-out + per-mail dedup snapshot. */
  async getCanaryAttendees(canaryId: string): Promise<CanaryAttendeesResult> {
    const bearer = await this.admin.getBearer();
    const resp = await this.http.get<CanaryAttendeesResult>(
      '/api/v1/internal/canary-attendees',
      { params: { canaryId }, headers: { Authorization: `Bearer ${bearer}` } },
    );
    this.assert2xx(resp.status, 'canary-attendees', resp.data);
    return resp.data;
  }

  /** Fire one event-reminder (T-7d / T-1d) sweep. */
  async triggerEventReminderSweep(): Promise<SweepCounts> {
    return this.postSweep('/api/v1/admin/lifecycle/trigger-event-reminder-sweep');
  }

  /** Fire one post-event thank-you sweep. */
  async triggerThankYouSweep(): Promise<SweepCounts> {
    return this.postSweep('/api/v1/admin/lifecycle/trigger-thank-you-sweep');
  }

  /**
   * POST the one-click List-Unsubscribe URL (anonymous). The token is HMAC-signed
   * with the target cluster's key, so the POST must land on the SAME cluster that
   * minted it — we re-base the path onto the configured apiUrl. (Staging kefi-api
   * currently emits prod-host unsubscribe links because PublicSite:ApiBaseUrl has
   * no per-cluster override; harmless — staging emails aren't user-facing — and on
   * prod the link host already equals apiUrl so this is a no-op.)
   */
  async unsubscribe(absoluteUrl: string): Promise<number> {
    const path = new URL(absoluteUrl).pathname;
    const resp = await this.http.post(path, undefined);
    return resp.status;
  }

  private async postAdmin<T>(path: string, body: unknown): Promise<T> {
    const bearer = await this.admin.getBearer();
    const resp = await this.http.post<T>(path, body, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    this.assert2xx(resp.status, path, resp.data);
    return resp.data;
  }

  private async postSweep(path: string): Promise<SweepCounts> {
    const bearer = await this.admin.getBearer();
    const resp = await this.http.post<SweepCounts>(path, undefined, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (resp.status !== 202) {
      throw new Error(
        `[kefiLifecycleClient] ${path} expected 202, got ${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data;
  }

  private assert2xx(status: number, path: string, data: unknown): void {
    if (status < 200 || status >= 300) {
      throw new Error(
        `[kefiLifecycleClient] ${path} expected 2xx, got ${status}: ${JSON.stringify(data)}`,
      );
    }
  }
}
