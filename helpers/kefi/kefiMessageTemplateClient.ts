/**
 * Server-side client for the Kefi organizer MESSAGE-TEMPLATE surface — the
 * reusable per-event email / WhatsApp copy an organizer broadcasts from:
 *
 *   GET    /api/v1/organizer/events/{eventId}/message-templates              Roles(organizer, tenant-owner)
 *   POST   /api/v1/organizer/events/{eventId}/message-templates              → 201
 *   PUT    /api/v1/organizer/events/{eventId}/message-templates/{id}         → 200
 *   DELETE /api/v1/organizer/events/{eventId}/message-templates/{id}         → 204
 *   POST   /api/v1/organizer/events/{eventId}/message-templates/{id}/preview → 200
 *
 * Two contract facts the specs lock in, both of which shipped as real bugs:
 *
 *  1. **`channel` is immutable.** The update request object simply does not
 *     declare it, and FastEndpoints silently DISCARDS undeclared body fields —
 *     so a client that sends `channel` on a PUT gets a cheerful 200 back with
 *     nothing changed. {@link update} therefore takes an untyped body so a spec
 *     can send the field and assert the server ignored it.
 *  2. **An unknown `{{token}}` renders as the EMPTY STRING**, not as itself.
 *     `MessageTemplateRenderer.Resolve` returns `string.Empty` for anything it
 *     does not recognise, deliberately: a half-remembered `{{discount}}` must
 *     not reach a recipient looking like a broken mail-merge.
 *
 * `validateStatus: () => true` throughout: a 400 (missing name/body, unknown
 * channel), 401 (no bearer) or 404 (foreign event/template) is an assertion the
 * spec makes, not a transport error.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_CREATED = 201;

/** The two channel tokens the API accepts (parsed case-insensitively). */
export const MESSAGE_CHANNELS = ['Email', 'WhatsApp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** One stored template (`MessageTemplateDto`). Carries the RAW, unrendered body. */
export interface MessageTemplate {
  externalId: string;
  name: string;
  /** "Email" | "WhatsApp" — set at creation and immutable thereafter. */
  channel: string;
  /** Always null for a WhatsApp template, even if a subject was submitted. */
  subject: string | null;
  body: string;
  isDefault: boolean;
  createdDate: string;
}

/** The preview response (`RenderedMessageDto`). `subject` is null for WhatsApp. */
export interface RenderedMessage {
  subject: string | null;
  body: string;
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

/** The create body (`CreateMessageTemplateRequest`). */
export interface CreateMessageTemplateInput {
  name: string;
  /** Deliberately `string`, not the union — the specs post invalid channels too. */
  channel: string;
  subject?: string | null;
  body: string;
  isDefault?: boolean;
}

/**
 * The update body. Deliberately an open record rather than the server's
 * `UpdateMessageTemplateRequest` shape: the immutability spec has to be able to
 * send `channel`, which the server does not declare and therefore discards.
 */
export type UpdateMessageTemplateInput = Record<string, unknown>;

export class KefiMessageTemplateClient {
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

  /** List every template on the event, both channels. 200 + rows. */
  async list(
    bearer: string,
    eventExternalId: string,
  ): Promise<StatusAnd<MessageTemplate[] | unknown>> {
    const resp = await this.http.get<MessageTemplate[]>(this.collectionPath(eventExternalId), {
      headers: this.authHeaders(bearer),
    });
    return { status: resp.status, data: resp.data };
  }

  /** Create a template. 201 + the stored row; 400 on bad channel/content. */
  async create(
    bearer: string,
    eventExternalId: string,
    input: CreateMessageTemplateInput,
  ): Promise<StatusAnd<MessageTemplate | unknown>> {
    const resp = await this.http.post<MessageTemplate>(
      this.collectionPath(eventExternalId),
      input,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Replace a template's editable fields. 200 + the stored row; 404 if foreign. */
  async update(
    bearer: string,
    eventExternalId: string,
    templateExternalId: string,
    input: UpdateMessageTemplateInput,
  ): Promise<StatusAnd<MessageTemplate | unknown>> {
    const resp = await this.http.put<MessageTemplate>(
      this.itemPath(eventExternalId, templateExternalId),
      input,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /** Delete a template. 204; 404 for an unknown/foreign one. */
  async remove(
    bearer: string,
    eventExternalId: string,
    templateExternalId: string,
  ): Promise<StatusAnd<unknown>> {
    const resp = await this.http.delete(this.itemPath(eventExternalId, templateExternalId), {
      headers: this.authHeaders(bearer),
    });
    return { status: resp.status, data: resp.data };
  }

  /**
   * Render a template. Omit `attendeeExternalId` to render against the server's
   * sample person (Maria Georgiou / FULL / 25.00) plus the REAL event facts.
   */
  async preview(
    bearer: string,
    eventExternalId: string,
    templateExternalId: string,
    attendeeExternalId?: string,
  ): Promise<StatusAnd<RenderedMessage | unknown>> {
    const body = attendeeExternalId === undefined ? {} : { attendeeExternalId };
    const resp = await this.http.post<RenderedMessage>(
      `${this.itemPath(eventExternalId, templateExternalId)}/preview`,
      body,
      { headers: this.authHeaders(bearer) },
    );
    return { status: resp.status, data: resp.data };
  }

  /**
   * Create a template and hand back the stored row. Throws on a non-201 so a
   * setup failure is reported where it happened rather than as a downstream 404.
   */
  async createOrThrow(
    bearer: string,
    eventExternalId: string,
    input: CreateMessageTemplateInput,
  ): Promise<MessageTemplate> {
    const resp = await this.create(bearer, eventExternalId, input);
    if (resp.status !== HTTP_CREATED) {
      throw new Error(
        `[kefiMessageTemplateClient] create(${input.channel}) expected 201, got ` +
          `${resp.status}: ${JSON.stringify(resp.data)}`,
      );
    }
    return resp.data as MessageTemplate;
  }

  private collectionPath(eventExternalId: string): string {
    return `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}/message-templates`;
  }

  private itemPath(eventExternalId: string, templateExternalId: string): string {
    return `${this.collectionPath(eventExternalId)}/${encodeURIComponent(templateExternalId)}`;
  }

  /** Bearer header, or none at all when the token is empty (the 401 case). */
  private authHeaders(bearer: string): Record<string, string> | undefined {
    return bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` };
  }
}
