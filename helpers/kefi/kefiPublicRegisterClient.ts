/**
 * Server-side client for the PUBLIC self-service registration route — the very
 * first thing a real visitor touches:
 *
 *   POST /api/v1/t/{slug}/register        anonymous, per-IP rate limited
 *
 * Contract facts the specs lock in:
 *
 *  - `consentGiven` must be `true` (GDPR Art. 7). It is a plain `bool`, so an
 *    OMITTED field binds to `false` and is indistinguishable from an explicit
 *    `false` — both are 400 with `errors.consentGiven`. This was a real
 *    production incident (every registration 400'd after the field shipped), so
 *    the `@api` spec asserts the field-level error, not merely the status.
 *  - An unknown `passCode` is **400**, not 404 — the message names the code.
 *  - An unknown tenant slug is 404.
 *  - Success is **201** with a `ticketToken` (HMAC) and the tenant's payment
 *    instructions.
 *
 * ⚠️ Rate limit: the route uses the strict per-IP `Auth` policy (5 requests /
 * 60 s by default). Keep a spec's registration count comfortably under that or
 * it will flake with 429 on retry. {@link isRateLimited} exists so a spec can
 * report that cause explicitly instead of asserting a confusing 429-vs-201.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** HTTP 429 — the per-IP registration rate limiter tripped. */
export const HTTP_TOO_MANY_REQUESTS = 429;

/** The public registration body. `consentGiven` is deliberately OPTIONAL here so
 *  a spec can omit it and prove the 400. */
export interface RegisterAttendeeBody {
  name: string;
  surname: string;
  phone: string;
  email: string;
  passCode: string;
  consentGiven?: boolean;
  proVideoOptIn?: boolean;
  /** Books a specific event; absent → the tenant's latest event. */
  eventSlug?: string;
}

/** The 201 payload (`RegisterAttendeeResultDto`) — the slice the specs assert on. */
export interface RegisterAttendeeResult {
  attendeeExternalId: string;
  eventExternalId: string;
  eventName: string;
  passCode: string;
  passLabel: string;
  priceEur: number;
  /** Always `"Expected"` for a freshly self-registered visitor. */
  status: string;
  ticketToken: string;
}

/** The FastEndpoints failure envelope (`Send.ErrorsAsync`). */
export interface ValidationErrorBody {
  statusCode: number;
  message: string;
  errors: Record<string, string[]>;
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

/** True when the response is the per-IP registration rate limit, not a product failure. */
export function isRateLimited(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS;
}

/**
 * Collect every validation message across all fields of a FastEndpoints error
 * body — lets a spec assert on the message text without knowing which key the
 * server chose (`consentGiven` vs `generalErrors`).
 */
export function allValidationMessages(data: unknown): string[] {
  const errors = (data as ValidationErrorBody | undefined)?.errors;
  if (!errors || typeof errors !== 'object') return [];
  return Object.values(errors).flat();
}

export class KefiPublicRegisterClient {
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

  /** POST the public registration. 201 / 400 / 404 / 429. */
  async register(
    slug: string,
    body: RegisterAttendeeBody,
  ): Promise<StatusAnd<RegisterAttendeeResult | unknown>> {
    const resp = await this.http.post<RegisterAttendeeResult>(
      `/api/v1/t/${encodeURIComponent(slug)}/register`,
      body,
    );
    return { status: resp.status, data: resp.data };
  }
}
