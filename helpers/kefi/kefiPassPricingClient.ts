/**
 * Server-side client for the Kefi PASS-PRICING surfaces — the routes that decide
 * how much money a buyer is asked for, and how much the server actually books.
 *
 * Two routes, and the whole point of this client is that they are DIFFERENT
 * READERS OF THE SAME PRICE and must agree:
 *
 *   GET /api/v1/organizer/events/{eventExternalId}/passes   Roles(organizer, tenant-owner)
 *     → the organizer's authoritative pass list, including the resolved
 *       `currentPriceEur` + `currentPriceSource` and the full `priceWindows`.
 *
 *   GET /api/v1/t/{slug}/{eventSlug}                        anonymous
 *     → the PUBLIC event payload the landing page is baked from. Carries a
 *       top-level `passes` array with the same resolved price.
 *
 * ⚠️ The public payload ALSO carries `landing.passes` — a hand-authored
 * marketing array of DISPLAY STRINGS (`price: "€30"`) that is a completely
 * separate field from the server's `priceEur`. Nothing keeps the two in sync,
 * which is precisely the defect class this suite exists to catch: the marketing
 * array is what the static page renders, while `priceEur` is what the register
 * endpoint charges. {@link PublicEventPayload} exposes both so a spec can assert
 * they agree rather than trusting either alone.
 *
 * `validateStatus: () => true` so a 403/404 negative is an assertion, not a throw.
 */

import axios, { type AxiosInstance } from 'axios';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;

/** One tiered-price window. Open-ended at either end when the bound is null. */
export interface PassPriceWindow {
  priceEur: number;
  /** ISO UTC. `null` = open at the start (applies from the beginning of time). */
  effectiveFromUtc: string | null;
  /** ISO UTC. `null` = open-ended (the final, never-expiring window). */
  effectiveUntilUtc: string | null;
}

/** How the server resolved `currentPriceEur`. */
export type PriceSource = 'Window' | 'FlatPrice';

/** One pass on the organizer's authoritative list. */
export interface OrganizerPass {
  externalId: string;
  code: string;
  label: string;
  /** The pass's base/flat price. */
  priceEur: number;
  /** The price a buyer is charged RIGHT NOW. */
  currentPriceEur: number;
  /** `Window` when a tiered window resolved it; `FlatPrice` for a non-tiered pass. */
  currentPriceSource: PriceSource;
  /** When the current window lapses. `null` for a flat pass or an open-ended window. */
  currentPriceHoldsUntilUtc: string | null;
  /** Empty for a non-tiered (flat) pass. */
  priceWindows: PassPriceWindow[];
}

/** One pass on the PUBLIC event payload (the server's resolved view). */
export interface PublicPass {
  code: string;
  label: string;
  /** The resolved current price — must equal the organizer list's `currentPriceEur`. */
  priceEur: number;
  priceHoldsUntilUtc: string | null;
}

/** One entry of the hand-authored marketing array (`landing.passes`). */
export interface LandingMarketingPass {
  id: string;
  name: string;
  /** A DISPLAY STRING with a currency symbol, e.g. `"€30"` — not a number. */
  price: string;
  description: string | null;
}

/** The slice of the public event payload this suite asserts on. */
export interface PublicEventPayload {
  slug: string;
  event: { externalId: string; slug: string; name: string; status: string } | null;
  /** The server's resolved pass prices. */
  passes: PublicPass[];
  /** The hand-authored marketing display strings. Separate field, separate truth. */
  landingPasses: LandingMarketingPass[];
}

/** A raw `{ status, data }` pair so the spec can assert either. */
export interface StatusAnd<T> {
  status: number;
  data: T;
}

/**
 * Parse a marketing display price (`"€30"`, `"30 EUR"`, `"€ 30"`) into a number.
 * Returns `null` when the string carries no digits at all, so a spec can report
 * "the marketing array is unparseable" distinctly from "it disagrees".
 */
export function parseDisplayPrice(display: string): number | null {
  const digits = display.replace(/[^0-9.]/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/**
 * Sort windows chronologically, treating a null `effectiveFromUtc` as the
 * earliest possible instant. Contiguity assertions depend on a stable order and
 * the API does not promise one.
 */
export function sortWindows(windows: PassPriceWindow[]): PassPriceWindow[] {
  return [...windows].sort((a, b) => {
    const left = a.effectiveFromUtc === null ? -Infinity : Date.parse(a.effectiveFromUtc);
    const right = b.effectiveFromUtc === null ? -Infinity : Date.parse(b.effectiveFromUtc);
    return left - right;
  });
}

export class KefiPassPricingClient {
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

  /**
   * GET the organizer's authoritative pass list. Pass an empty bearer to assert
   * the 401 auth wall.
   */
  async getOrganizerPasses(
    bearer: string,
    eventExternalId: string,
  ): Promise<StatusAnd<OrganizerPass[] | unknown>> {
    const headers = bearer === '' ? undefined : { Authorization: `Bearer ${bearer}` };
    const resp = await this.http.get<OrganizerPass[]>(
      `/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}/passes`,
      headers === undefined ? undefined : { headers },
    );
    return { status: resp.status, data: resp.data };
  }

  /** GET the anonymous public event payload the landing page is baked from. */
  async getPublicEvent(slug: string, eventSlug: string): Promise<StatusAnd<PublicEventPayload>> {
    const resp = await this.http.get(
      `/api/v1/t/${encodeURIComponent(slug)}/${encodeURIComponent(eventSlug)}`,
    );
    const data = (resp.data ?? {}) as {
      slug?: string;
      event?: { externalId: string; slug: string; name: string; status: string };
      passes?: PublicPass[];
      landing?: { passes?: LandingMarketingPass[] };
    };
    return {
      status: resp.status,
      data: {
        slug: data.slug ?? '',
        event: data.event ?? null,
        passes: data.passes ?? [],
        landingPasses: data.landing?.passes ?? [],
      },
    };
  }
}
