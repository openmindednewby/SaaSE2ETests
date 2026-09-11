// Selida ("drop an HTML file, get a link") — @api tier helpers.
//
// Every constant here is read off SelidaService source, not guessed. The file:line each one rests
// on is named next to it, so when the contract moves the reader knows which line to re-read.
//
// 🔴 RATE LIMIT. CreatePage is throttled at 10 hits / 60 s per client IP (CreatePage.cs:11-12,31),
// and REJECTED uploads count too — the throttle runs before the handler. The whole selida-api
// project makes exactly 9 upload calls. Adding an upload anywhere means removing one elsewhere, or
// the last test of the run gets a 429 instead of the status it asserts. The project pins
// `retries: 0` for the same reason: a retry is a second upload.
import { expect, request as playwrightRequest } from '@playwright/test';

import type { APIRequestContext, APIResponse } from '@playwright/test';

/** The API origin (routes under /api/v1). Default: production. */
export const SELIDA_API_BASE = (
  process.env.SELIDA_API_BASE?.trim() || 'https://selida-api.dloizides.com'
).replace(/\/+$/, '');

/**
 * The public site — the browser origin that calls the API cross-origin (so CORS must allow it)
 * and hosts the report form the served-page footer links to. Default: production.
 */
export const SELIDA_SITE_BASE = (
  process.env.SELIDA_SITE_BASE?.trim() || 'https://selida.dloizides.com'
).replace(/\/+$/, '');

/** The hostile-content origin that serves user pages. Default: production. */
export const SELIDA_PAGES_BASE = (
  process.env.SELIDA_PAGES_BASE?.trim() || 'https://pages.dloizides.com'
).replace(/\/+$/, '');

/** FastEndpoints RoutePrefix is `api/v1` (MiddlewareConfig.cs:32); ServePage overrides it to none. */
export const SELIDA_ROUTES = {
  pages: `${SELIDA_API_BASE}/api/v1/pages`,
  page: (slug: string): string => `${SELIDA_API_BASE}/api/v1/pages/${slug}`,
  report: (slug: string): string => `${SELIDA_API_BASE}/api/v1/pages/${slug}/report`,
  servedOnPagesHost: (slug: string): string => `${SELIDA_PAGES_BASE}/p/${slug}`,
  servedOnApiHost: (slug: string): string => `${SELIDA_API_BASE}/p/${slug}`,
  apiOnPagesHost: (slug: string): string => `${SELIDA_PAGES_BASE}/api/v1/pages/${slug}`,
} as const;

/** The report link the serve path appends after the user's bytes — on the SITE, not the API. */
export function reportLink(slug: string): string {
  return `${SELIDA_SITE_BASE}/report.html?slug=${slug}`;
}

export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
} as const;

/** UploadPolicy.cs:12 — 5 MB. */
export const MAX_ANONYMOUS_UPLOAD_BYTES = 5 * 1024 * 1024;

/** UploadPolicy.cs:15 — anonymous pages expire this many days after publication. */
export const ANONYMOUS_RETENTION_DAYS = 30;

/** UploadPolicy.cs:20-21 — the ONLY served type; the caller's Content-Type is never consulted. */
export const SERVED_CONTENT_TYPE = 'text/html; charset=utf-8';

/** SlugGenerator.cs — 10 chars from `abcdefghijkmnpqrstuvwxyz23456789` (no l, o, 0, 1). */
export const SLUG_PATTERN = /^[a-km-np-z2-9]{10}$/;

/** A slug the generator can never produce (it contains `0` and `l`), so it is unknown by construction. */
export const UNGENERATABLE_SLUG = 'zz0000000l';

/** ClaimTokenGenerator.cs — 32 random bytes, lowercase hex. */
export const CLAIM_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The non-CSP half of ServedPageHeaders.Required (ServedPageHeaders.cs), held as data so the spec
 * asserts the TABLE rather than a hand-picked subset. Names are lowercase because Playwright
 * lowercases response header names. CSP is asserted per directive (see `parseCsp`), not as one
 * string, because its source lists are expected to grow (CDN allowlists) without weakening it.
 */
export const REQUIRED_EXACT_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-cache',
};

/** DTOs/CreatedPageDto.cs — the one response that carries the claim token. */
export interface CreatedPage {
  slug: string;
  url: string;
  claimToken: string;
  expiresAt: string;
}

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** An anonymous context with no baseURL: every Selida call names its host explicitly. */
export async function anonymousApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ ignoreHTTPSErrors: true });
}

/** A small, valid HTML document carrying a unique marker the spec can look for. */
export function htmlFixture(label: string): { marker: string; buffer: Buffer } {
  const marker = `selida-e2e-${label}-${Date.now()}`;
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${marker}</title></head>` +
    `<body><p id="marker">${marker}</p></body></html>`;
  return { marker, buffer: Buffer.from(html, 'utf8') };
}

/** POST /api/v1/pages, multipart field `file` (CreatePage.cs:78-85). */
export async function upload(api: APIRequestContext, file: UploadFile): Promise<APIResponse> {
  return api.post(SELIDA_ROUTES.pages, { multipart: { file } });
}

/** DELETE /api/v1/pages/{slug}; the token travels in `X-Claim-Token` (DeletePage.cs:47-51). */
export async function deletePage(
  api: APIRequestContext,
  slug: string,
  claimToken?: string,
): Promise<APIResponse> {
  const headers: Record<string, string> = claimToken === undefined ? {} : { 'X-Claim-Token': claimToken };
  return api.delete(SELIDA_ROUTES.page(slug), { headers });
}

/** A failure message that names the status, the URL and the start of the body. */
export async function describeResponse(response: APIResponse): Promise<string> {
  let body: string;
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    body = '<unreadable body>';
  }
  const hint =
    response.status() === HTTP.TOO_MANY_REQUESTS
      ? ' — RATE LIMITED: uploads are capped at 10/min per IP; wait 60 s before re-running the suite.'
      : '';
  return `${response.status()} from ${response.url()}${hint} body: ${body}`;
}

/**
 * Pages this run made public. Drained by afterEach/afterAll with the claim token, so the suite
 * leaves nothing behind even when an assertion fails half-way through a test.
 */
export class PageLedger {
  private readonly pages = new Map<string, CreatedPage>();

  track(page: CreatedPage): void {
    this.pages.set(page.slug, page);
  }

  /** Deletes every tracked page. 404 counts as gone. Returns the slugs that could NOT be removed. */
  async drain(api: APIRequestContext): Promise<string[]> {
    const leftovers: string[] = [];
    for (const page of this.pages.values()) {
      const status = (await deletePage(api, page.slug, page.claimToken)).status();
      if (status !== HTTP.NO_CONTENT && status !== HTTP.NOT_FOUND) leftovers.push(`${page.slug} (${status})`);
    }
    this.pages.clear();
    return leftovers;
  }
}

/** Uploads and requires a 201; the created page is tracked for cleanup before anything is asserted. */
export async function publish(
  api: APIRequestContext,
  ledger: PageLedger,
  file: UploadFile,
): Promise<CreatedPage> {
  const response = await upload(api, file);
  expect(response.status(), await describeResponse(response)).toBe(HTTP.CREATED);
  const created = (await response.json()) as CreatedPage;
  ledger.track(created);
  return created;
}

/**
 * Parses a CSP header into directive → source tokens. Lowercases directive names only; source
 * tokens (`'none'`, hosts) are kept verbatim.
 */
export function parseCsp(header: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const raw of header.split(';')) {
    const [name, ...tokens] = raw.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), tokens);
  }
  return directives;
}

/**
 * The sources a FETCH directive (connect-src, img-src, …) actually enforces: its own list, else
 * `default-src`. Only fetch directives fall back — form-action, frame-ancestors, base-uri and
 * sandbox do NOT, so those must be asserted as explicit directives.
 */
export function effectiveFetchSources(csp: Map<string, string[]>, directive: string): string[] | undefined {
  return csp.get(directive) ?? csp.get('default-src');
}
