/**
 * Server-side client for the Kefi organizer ACCESS-LINK surface (Phase 2.5) —
 * the mint / list / revoke trio that hands a door person, an accountant or a
 * promoter a scoped, login-free URL:
 *
 *   POST   /api/v1/organizer/events/{eventId}/access-links            Roles(organizer, tenant-owner)
 *   GET    /api/v1/organizer/events/{eventId}/access-links            Roles(organizer, tenant-owner)
 *   DELETE /api/v1/organizer/events/{eventId}/access-links/{linkId}   Roles(organizer, tenant-owner)
 *
 * Two contract facts the specs lock in, both easy to get wrong:
 *
 *  1. The raw token is returned EXACTLY ONCE, and never as its own field — it
 *     lives inside `url` (`https://{slug}.kefi…/{door|ledger}?token=…`). Only its
 *     hash is persisted, so a token not captured at mint time is unrecoverable.
 *     {@link tokenFromAccessLinkUrl} is the single place that parses it out.
 *  2. Revocation is a BOOLEAN (`revoked`) on the list DTO — there is no
 *     `revokedAt` timestamp anywhere in the contract.
 *
 * `validateStatus: () => true` throughout: a 400 (bad scope), 403 (role wall) or
 * 404 (foreign event) is an assertion the spec makes, not a transport error.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** The three scope tokens the API accepts (parsed case-insensitively). */
export const ACCESS_LINK_SCOPES = ['Door', 'Ledger', 'Promoter'] as const;
export type AccessLinkScope = (typeof ACCESS_LINK_SCOPES)[number];

/** The mint-time response (`CreatedAccessLinkDto`) — the only carrier of the token. */
export interface CreatedAccessLink {
  externalId: string;
  recipientName: string;
  scope: string;
  /** The one-time recipient URL; the raw token is its `token` query param. */
  url: string;
  createdDate: string;
}

/** One row of the list response (`AccessLinkDto`). Carries no token and no url. */
export interface AccessLinkRow {
  externalId: string;
  recipientName: string;
  scope: string;
  promoterExternalId: string | null;
  promoterName: string | null;
  revoked: boolean;
  createdDate: string;
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

/** The mint body (`CreateAccessLinkRequest`). */
export interface CreateAccessLinkInput {
  recipientName: string;
  /** Deliberately `string`, not the union — the specs mint invalid scopes too. */
  scope: string;
  /** Required for (and only meaningful on) a `Promoter` link. */
  promoterExternalId?: string;
}

/**
 * Extract the raw token from a minted access-link URL.
 *
 * Throws rather than returning null: a missing token means the mint contract
 * changed, and every downstream door/ledger assertion would fail with a
 * confusing 404 instead of naming the real cause.
 */
export function tokenFromAccessLinkUrl(url: string): string {
  const token = new URL(url).searchParams.get('token');
  if (token === null || token.trim().length === 0) {
    throw new Error(
      `[kefiAccessLinkClient] minted access-link URL carries no ?token= — got: ${url}`,
    );
  }
  return token;
}

export class KefiAccessLinkClient {
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

  /** Mint a link. 201 + {@link CreatedAccessLink}; 400 bad scope; 404 foreign event. */
  async mint(
    bearer: string,
    eventExternalId: string,
    input: CreateAccessLinkInput,
  ): Promise<StatusAnd<CreatedAccessLink | unknown>> {
    const resp = await this.http.post<CreatedAccessLink>(
      this.linksPath(eventExternalId),
      input,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /** List the event's links. 200 + {@link AccessLinkRow}[]; 401/403/404 otherwise. */
  async list(
    bearer: string,
    eventExternalId: string,
  ): Promise<StatusAnd<AccessLinkRow[] | unknown>> {
    const resp = await this.http.get<AccessLinkRow[]>(this.linksPath(eventExternalId), {
      headers: this.authHeaders(bearer),
    });
    return { status: resp.status, data: resp.data };
  }

  /** Revoke a link. 204 (idempotent); 404 for a foreign/unknown event or link. */
  async revoke(
    bearer: string,
    eventExternalId: string,
    accessLinkExternalId: string,
  ): Promise<StatusAnd<unknown>> {
    const resp = await this.http.delete(
      `${this.linksPath(eventExternalId)}/${encodeURIComponent(accessLinkExternalId)}`,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * Mint a link and hand back both its id and its raw token in one step — the
   * shape almost every caller wants. Throws on a non-201 so a setup failure is
   * reported where it happened rather than as a downstream 404.
   */
  async mintAndCaptureToken(
    bearer: string,
    eventExternalId: string,
    input: CreateAccessLinkInput,
  ): Promise<{ externalId: string; token: string; url: string }> {
    const resp = await this.mint(bearer, eventExternalId, input);
    if (resp.status !== 201) {
      throw new Error(
        `[kefiAccessLinkClient] mint(${input.scope}) expected 201, got ${resp.status}: ` +
          JSON.stringify(resp.data),
      );
    }
    const created = resp.data as CreatedAccessLink;
    return {
      externalId: created.externalId,
      token: tokenFromAccessLinkUrl(created.url),
      url: created.url,
    };
  }

  private linksPath(eventExternalId: string): string {
    return `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}/access-links`;
  }

  /** Bearer header, or none at all when the token is empty (the 401 case). */
  private authHeaders(bearer: string): Record<string, string> | undefined {
    return bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` };
  }
}
