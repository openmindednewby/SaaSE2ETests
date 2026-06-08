/**
 * Server-side client for the Kefi attendee Stripe-Checkout payment E2E (#177).
 * Wraps the four #177 HTTP surfaces:
 *
 *   - PUT  /api/v1/admin/stripe-credentials   (tenant-owner — store/clear keys)
 *   - GET  /api/v1/admin/payment-config       (tenant-owner — read Stripe status)
 *   - PUT  /api/v1/admin/payment-config       (tenant-owner — advertise providerKind)
 *   - POST /api/v1/t/{slug}/checkout-session  (public — mint a hosted Checkout URL)
 *   - POST /api/v1/webhooks/stripe-payments/{tenantId} (public, RAW body — reconcile)
 *
 * Split out of kefiLifecycleClient (which is at its file-size cap) so each file
 * stays under the 300-line lint threshold. The admin endpoints take a
 * tenant-owner bearer (minted by KefiAdminClient.getTenantOwnerBearer, exactly as
 * forceOnboardingPlan + putLandingConfig do); the public register / checkout /
 * webhook are anonymous — as a real attendee + Stripe hit them.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

/** #177 — non-secret Stripe status echoed by PUT /admin/stripe-credentials + GET /admin/payment-config. */
export interface StripeCredentialsStatus {
  stripeConfigured: boolean;
  stripeKeyLast4: string | null;
  stripePaymentsEnabled: boolean;
  stripeWebhookUrl: string;
}

export interface UpdateStripeCredentialsInput {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePaymentsEnabled: boolean;
  clear?: boolean;
}

export class KefiPaymentClient {
  private readonly http: AxiosInstance;
  private readonly urls = getKefiUrls();

  constructor() {
    this.http = axios.create({
      baseURL: this.urls.apiUrl,
      timeout: 30000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true,
    });
  }

  /** Tenant-owner PUT /admin/stripe-credentials (#177). Returns the non-secret status. */
  async updateStripeCredentials(
    ownerBearer: string, input: UpdateStripeCredentialsInput,
  ): Promise<StripeCredentialsStatus> {
    const resp = await this.http.put<StripeCredentialsStatus>(
      '/api/v1/admin/stripe-credentials', input,
      { headers: { Authorization: `Bearer ${ownerBearer}` } },
    );
    this.assert2xx(resp.status, 'stripe-credentials', resp.data);
    return resp.data;
  }

  /** Tenant-owner GET /admin/payment-config — reads back the #177 Stripe status fields. */
  async getPaymentConfig(ownerBearer: string): Promise<StripeCredentialsStatus> {
    const resp = await this.http.get<StripeCredentialsStatus>(
      '/api/v1/admin/payment-config',
      { headers: { Authorization: `Bearer ${ownerBearer}` } },
    );
    this.assert2xx(resp.status, 'payment-config', resp.data);
    return resp.data;
  }

  /**
   * Persist `providerKind: 'stripe-checkout'` via PUT /admin/payment-config so the
   * public register response advertises it (#177). PUT semantics overwrite the
   * whole blob, so this sends a minimal stripe-checkout config.
   */
  async setProviderKindStripeCheckout(ownerBearer: string): Promise<void> {
    const resp = await this.http.put(
      '/api/v1/admin/payment-config',
      { providerKind: 'stripe-checkout', payAtDoorAllowed: false },
      { headers: { Authorization: `Bearer ${ownerBearer}` } },
    );
    this.assert2xx(resp.status, 'payment-config (PUT)', resp.data);
  }

  /**
   * Public, anonymous POST /t/{slug}/checkout-session (#177 — Layer 2, live key).
   * Returns the HTTP status + the parsed `hostedUrl` so the caller can assert the
   * Stripe-hosted redirect URL shape.
   */
  async createCheckoutSession(
    slug: string, attendeeExternalId: string,
  ): Promise<{ status: number; hostedUrl: string | null }> {
    const resp = await this.http.post(
      `/api/v1/t/${encodeURIComponent(slug)}/checkout-session`,
      { attendeeExternalId },
    );
    const data = (resp.data ?? {}) as { hostedUrl?: string };
    return { status: resp.status, hostedUrl: data.hostedUrl ?? null };
  }

  /**
   * Public, anonymous POST to the per-tenant Stripe webhook with a RAW body +
   * `Stripe-Signature` header (#177). The body must be the EXACT bytes that were
   * signed, so the string is sent verbatim with an explicit JSON content type and
   * NO axios transform. Returns the HTTP status (200 processed/ignored, 400
   * bad-sig/not-configured, 404 unknown attendee).
   */
  async postStripeWebhook(input: {
    webhookUrl: string;
    rawBody: string;
    signature: string;
  }): Promise<number> {
    const path = new URL(input.webhookUrl).pathname;
    const resp = await this.http.post(path, input.rawBody, {
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': input.signature },
      transformRequest: [(data: unknown) => data],
    });
    return resp.status;
  }

  /** Build the per-tenant webhook URL from the configured apiUrl + a tenant id. */
  buildStripeWebhookUrl(tenantId: string): string {
    return `${this.urls.apiUrl.replace(/\/$/, '')}/api/v1/webhooks/stripe-payments/${tenantId}`;
  }

  private assert2xx(status: number, path: string, data: unknown): void {
    if (status < 200 || status >= 300) {
      throw new Error(
        `[kefiPaymentClient] ${path} expected 2xx, got ${status}: ${JSON.stringify(data)}`,
      );
    }
  }
}

/**
 * Extract the tenant id (Guid) from a per-tenant Stripe webhook URL — it's the
 * last path segment of `{apiBase}/api/v1/webhooks/stripe-payments/{tenantId}`.
 * The #177 GET payment-config / PUT stripe-credentials responses both surface
 * this URL, so the spec never needs the tenant id from any other source.
 */
export function tenantIdFromWebhookUrl(webhookUrl: string): string {
  const segments = new URL(webhookUrl).pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) {
    throw new Error(`[kefiPaymentClient] could not parse tenant id from webhook URL: ${webhookUrl}`);
  }
  return last;
}
