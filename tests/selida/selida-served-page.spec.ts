// Selida @api — one published page, every read-only assertion about it.
//
// ONE upload serves five tests (publish response, the hardened serve path, host isolation both
// ways, and the report 404). That is deliberate: CreatePage is throttled at 10/min per IP and the
// whole project spends 9. `mode: 'serial'` keeps a failure from restarting the worker and
// re-running beforeAll — which would be a second upload.
//
// The page is deleted with its claim token in afterAll, so the run leaves nothing public.
import { expect, test } from '@playwright/test';

import {
  ANONYMOUS_RETENTION_DAYS,
  CLAIM_TOKEN_PATTERN,
  HTTP,
  PageLedger,
  REQUIRED_EXACT_HEADERS,
  SELIDA_PAGES_BASE,
  SELIDA_ROUTES,
  SERVED_CONTENT_TYPE,
  SLUG_PATTERN,
  UNGENERATABLE_SLUG,
  anonymousApi,
  describeResponse,
  effectiveFetchSources,
  htmlFixture,
  parseCsp,
  reportLink,
  upload,
} from './selida-helpers.js';

import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { CreatedPage } from './selida-helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Generous: absorbs clock skew and a DateTime serialised without a zone designator. */
const EXPIRY_TOLERANCE_MS = DAY_MS;

const isSuccess = (status: number): boolean => status >= HTTP.OK && status < 300;

test.describe('Selida served page @selida-api @selida', () => {
  test.describe.configure({ mode: 'serial' });

  const ledger = new PageLedger();
  const fixture = htmlFixture('served');
  let api: APIRequestContext;
  let createStatus = 0;
  let createFailure = '';
  let created: CreatedPage | undefined;
  let publishedAt = 0;

  test.beforeAll(async () => {
    api = await anonymousApi();
    publishedAt = Date.now();
    const response: APIResponse = await upload(api, {
      name: 'index.html',
      mimeType: 'text/html',
      buffer: fixture.buffer,
    });
    createStatus = response.status();
    createFailure = await describeResponse(response);
    if (createStatus === HTTP.CREATED) {
      created = (await response.json()) as CreatedPage;
      ledger.track(created);
    }
  });

  test.afterAll(async () => {
    const leftovers = await ledger.drain(api);
    await api?.dispose();
    expect(leftovers, 'these pages are still PUBLIC — delete them by hand').toEqual([]);
  });

  /** The page every test below reads. Fails loudly (never skips) when the publish did not land. */
  function page(): CreatedPage {
    expect(created, `publish did not return 201: ${createFailure}`).toBeDefined();
    return created as CreatedPage;
  }

  test('publishing an .html file returns 201 with slug, pages-host url, claim token and a 30-day expiry', async () => {
    // CreatePage.cs:74 (201) · CreatedPageDto.cs:4 (shape) · CreatePageHandler.cs:61 (expiry)
    expect(createStatus, createFailure).toBe(HTTP.CREATED);
    const { slug, url, claimToken, expiresAt } = page();

    expect(slug).toMatch(SLUG_PATTERN);
    expect(claimToken).toMatch(CLAIM_TOKEN_PATTERN);

    // PageUrlBuilder.cs: `{PublicBaseUrl}/p/{slug}` — must be the hostile origin, never the API one.
    const parsed = new URL(url);
    expect(parsed.origin).toBe(new URL(SELIDA_PAGES_BASE).origin);
    expect(parsed.pathname).toBe(`/p/${slug}`);

    const expectedExpiry = publishedAt + ANONYMOUS_RETENTION_DAYS * DAY_MS;
    const expiry = Date.parse(expiresAt);
    expect(Number.isNaN(expiry), `expiresAt is not a date: ${expiresAt}`).toBe(false);
    expect(Math.abs(expiry - expectedExpiry)).toBeLessThan(EXPIRY_TOLERANCE_MS);
  });

  test('the served page carries the full hardened header table and the report footer', async () => {
    const { slug, url } = page();
    const response = await api.get(url, { maxRedirects: 0 });
    expect(response.status(), await describeResponse(response)).toBe(HTTP.OK);

    const headers = response.headers();
    // UploadPolicy.cs:20 — the server decides the type from the extension.
    expect(headers['content-type']).toBe(SERVED_CONTENT_TYPE);

    // ServedPageHeaders.Required, written by ServedPageHeaderWriter.cs:14-17 in one loop.
    for (const [name, value] of Object.entries(REQUIRED_EXACT_HEADERS)) {
      expect(headers[name], `served page header ${name}`).toBe(value);
    }

    const csp = parseCsp(headers['content-security-policy'] ?? '');
    const sandbox = csp.get('sandbox');
    expect(sandbox, 'CSP must sandbox user HTML').toBeDefined();
    expect(sandbox, 'a sandbox with allow-same-origin gives user script the pages origin back').not.toContain(
      "'allow-same-origin'",
    );
    expect(sandbox).not.toContain('allow-same-origin');
    expect(effectiveFetchSources(csp, 'connect-src'), 'no network egress from user script').toEqual(["'none'"]);
    expect(csp.get('form-action'), 'form-action does not fall back to default-src').toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);

    // The user's bytes come first, untouched; the report link follows them.
    const served = await response.body();
    const uploaded = fixture.buffer;
    expect(served.subarray(0, uploaded.length).toString('utf8')).toBe(uploaded.toString('utf8'));
    const servedText = served.toString('utf8');
    expect(servedText).toContain(reportLink(slug));
    expect(servedText.indexOf(reportLink(slug))).toBeGreaterThanOrEqual(uploaded.length);
  });

  test('the API host does not serve user pages (/p/{slug} on the API origin is not 200)', async () => {
    const { slug } = page();
    // maxRedirects 0: a redirect to the pages host is acceptable isolation; following it would
    // turn that into a false 200.
    const response = await api.get(SELIDA_ROUTES.servedOnApiHost(slug), { maxRedirects: 0 });
    expect(response.status(), await describeResponse(response)).not.toBe(HTTP.OK);
    expect(await response.text(), 'user bytes leaked onto the API origin').not.toContain(fixture.marker);
  });

  test('the pages host does not answer the API (/api/v1/pages/{slug} there is not 2xx)', async () => {
    const { slug } = page();
    const response = await api.get(SELIDA_ROUTES.apiOnPagesHost(slug), { maxRedirects: 0 });
    expect(isSuccess(response.status()), await describeResponse(response)).toBe(false);
  });

  test('reporting an unknown slug is 404', async () => {
    // ReportPage.cs:37-41 · ReportPageHandler.cs:24-27. Reason is required (ReportPage.Validator.cs:12-14),
    // so a body is sent — without it the 400 would mask the 404 being tested.
    const response = await api.post(SELIDA_ROUTES.report(UNGENERATABLE_SLUG), {
      data: { reason: 'selida e2e: unknown-slug probe' },
    });
    expect(response.status(), await describeResponse(response)).toBe(HTTP.NOT_FOUND);
  });
});
