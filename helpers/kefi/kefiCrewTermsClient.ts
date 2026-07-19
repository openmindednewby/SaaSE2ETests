/**
 * Server-side client for the per-event CREW TERMS — the deal a promoter sees on
 * their own payout page:
 *
 *   GET /api/v1/organizer/events/{eventId}/crew-terms   Roles(organizer, tenant-owner)
 *   PUT /api/v1/organizer/events/{eventId}/crew-terms   Roles(organizer, tenant-owner)
 *
 * ⚠️ This is EVENT CONFIG, not a row — writing it overwrites whatever the real
 * organizer saved, and there is no "create a second one" escape hatch. On a
 * production fixture tenant that makes {@link withTemporaryTerms} the only safe
 * way to use it: read the current value, write the test value, and restore the
 * original in a `finally` even when the body throws.
 *
 * `termsHtml` is organizer-authored and therefore untrusted — the crew page runs
 * it through an allowlist sanitiser before it touches `innerHTML`. Any spec that
 * writes terms here should keep the markup inside that allowlist (`p`, `strong`,
 * `ul`/`li`, …) unless it is deliberately testing the sanitiser.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_OK = 200;

/** The crew-terms payload (`CrewTermsDto`). */
export interface CrewTerms {
  crewTermsHtml: string | null;
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

export class KefiCrewTermsClient {
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

  /** Read the event's crew terms. 200 + `{ crewTermsHtml }`; 404 if foreign. */
  async get(bearer: string, eventExternalId: string): Promise<StatusAnd<CrewTerms | unknown>> {
    const resp = await this.http.get<CrewTerms>(this.path(eventExternalId), {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    return { status: resp.status, data: resp.data };
  }

  /** Write the event's crew terms. Null or blank clears them. */
  async set(
    bearer: string,
    eventExternalId: string,
    crewTermsHtml: string | null,
  ): Promise<StatusAnd<CrewTerms | unknown>> {
    const resp = await this.http.put<CrewTerms>(
      this.path(eventExternalId),
      { crewTermsHtml },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * Run `body` with `html` installed as the event's crew terms, then put the
   * ORIGINAL value back — whatever happened in between.
   *
   * This is the only sanctioned way for a spec to touch crew terms on the
   * production fixture tenant: the terms are the organizer's own copy, and a
   * spec that failed halfway through a naive write would leave the real event
   * displaying test markup to real promoters.
   */
  async withTemporaryTerms<T>(
    bearer: string,
    eventExternalId: string,
    html: string,
    body: () => Promise<T>,
  ): Promise<T> {
    const before = await this.get(bearer, eventExternalId);
    if (before.status !== HTTP_OK) {
      throw new Error(
        `[kefiCrewTermsClient] could not read the crew terms to restore later ` +
          `(status ${before.status}) — refusing to overwrite them blind.`,
      );
    }
    const original = (before.data as CrewTerms).crewTermsHtml;

    const written = await this.set(bearer, eventExternalId, html);
    if (written.status !== HTTP_OK) {
      throw new Error(
        `[kefiCrewTermsClient] set crew terms expected 200, got ${written.status}: ` +
          JSON.stringify(written.data),
      );
    }

    try {
      return await body();
    } finally {
      await this.set(bearer, eventExternalId, original);
    }
  }

  private path(eventExternalId: string): string {
    return `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}/crew-terms`;
  }
}
