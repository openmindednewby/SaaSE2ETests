// @modb-api tier — MODB-MOCK-1 "demo identity picker + AML source links", acceptance tests AC-MOCK-6 and the API
// side of AC-MOCK-8 (owner decision MOCK-1-D4, MODB-MOCK-1-SPEC.md §3.3 + §4).
//
// AC-MOCK-6B and AC-MOCK-8 go through the wl-api-gateway and screen the synthetic MRZ specimen, so the payload has
// adverse-media matches to carry links and more than ten matches for the display cap.
//
// AC-MOCK-6 calls AMLService DIRECTLY (owner decision D-MODB-AM-9 "AC-MOCK-6 calls AMLService directly as a second
// tenant", 2026-09-21). The gateway pins ONE tenant (706772f5, modb-api-gateway.yml:101) and the per-tenant flag
// `AdverseMedia__Surface__TenantOverrides__<tenantId>` can make only one of 6/6B true for it. So 6 screens as tenant
// MODB_SURFACE_ON_TENANT_ID "ModB E2E Surface-ON (staging)" with MODB_SURFACE_ON_AML_API_KEY, whose override is ON.
// ACCEPTED GAP (D-MODB-AM-9): the surface-ON case no longer covers the gateway forwarding `source_url`
// (http-aml-case.reader.ts). Only the OFF case (6B) covers the full gateway path.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADVERSE_MEDIA_CATEGORY, AML_API_URL, screen } from '../aml/aml-helpers.js';
import { AML_CHECK, assertGatewayReachable, getAmlCase, rowOf, submitVerification, waitForAmlTerminal } from './modb-helpers.js';
import { resolveGatewayUrl } from './modb-guards.js';

/** The portal renders the first 10 and a "show all N" control (spec §3.3). */
const DISPLAY_CAP = 10;
const PAGING_QUERY = 'limit=10&offset=0&page=1&page_size=10&cursor=0';
const PAGING_KEYS = ['page', 'page_size', 'limit', 'offset', 'cursor', 'next', 'next_cursor', 'has_more', 'total_pages', 'total'];
const HTTP_BAD_REQUEST = 400;
const REQUEST_TIMEOUT_MS = 30_000;

type Match = Record<string, unknown>;

/** A subject with dense GDELT coverage; 10/10 adverse-media matches carried sourceUrl when checked by hand (§24). */
const SURFACE_ON_SUBJECT = 'Najib Razak';
const SURFACE_ON_TENANT_ID = process.env.MODB_SURFACE_ON_TENANT_ID?.trim() || null;
const SURFACE_ON_API_KEY = process.env.MODB_SURFACE_ON_AML_API_KEY?.trim() || null;
const HTTP_CREATED = 201;
/**
 * `adverseMediaStatus=Unavailable` means the GDELT stage missed its latency budget (ScreeningServiceCollectionExtensions.cs:304),
 * i.e. "not yet", not "broken". Re-screen with backoff, bounded well inside the 240 s modb-api test timeout.
 */
const AM_RETRY_INTERVALS_MS = [5_000, 10_000, 20_000, 30_000];
const AM_RETRY_TIMEOUT_MS = 180_000;

interface DirectScreen {
  adverseMediaStatus?: string | null;
  matchedEntities: Match[];
}

/** AMLService direct-response discriminator, the same one the aml-api specs use (aml-adverse-media-hit.spec.ts:106). */
const isDirectAdverseMedia = (match: Match): boolean =>
  match.rejectionTag === ADVERSE_MEDIA_CATEGORY || !!match.adverseMediaCategory;

/** Screen as the surface-ON tenant until adverse media leaves Unavailable, or fail with the last status seen. */
async function screenAsSurfaceOnTenant(request: APIRequestContext, apiKey: string): Promise<DirectScreen> {
  let last: DirectScreen | null = null;
  let lastHttp = 0;
  await expect
    .poll(
      async () => {
        const res = await screen(request, { fullName: SURFACE_ON_SUBJECT, adverseMedia: true, includeReasoning: true }, apiKey);
        lastHttp = res?.status() ?? 0;
        if (!res || lastHttp !== HTTP_CREATED) return `http ${lastHttp}`;
        last = (await res.json()) as DirectScreen;
        return last.adverseMediaStatus ?? 'missing';
      },
      {
        message:
          `AMLService ${AML_API_URL} screening '${SURFACE_ON_SUBJECT}' as tenant ${SURFACE_ON_TENANT_ID} never reached ` +
          'adverseMediaStatus=Ok within the retry budget (Unavailable = the GDELT stage kept missing its latency budget; ' +
          'http 401/403 = MODB_SURFACE_ON_AML_API_KEY rejected)',
        intervals: AM_RETRY_INTERVALS_MS,
        timeout: AM_RETRY_TIMEOUT_MS,
      },
    )
    .toBe('Ok');
  return last as unknown as DirectScreen;
}

/** Screen the specimen and return its aml-case `data`, requiring adverse media to have been checked. */
async function screenedCase(request: APIRequestContext): Promise<{ requestId: string; data: Record<string, unknown> }> {
  await assertGatewayReachable(request);
  const requestId = await submitVerification(request, { mrz_match: 'passed' });
  test.info().annotations.push({ type: 'request_id', description: requestId });
  expect(rowOf(await waitForAmlTerminal(request, requestId), AML_CHECK).status).toBe('completed');
  const amlCase = await getAmlCase(request, requestId);
  expect(amlCase.status()).toBe(200);
  const data = (await amlCase.json()).data as Record<string, unknown>;
  // Not Ok = the adverse-media index did not answer (cold page cache, MODB-2-INT 8-AM-diag): environment, not feature.
  expect(data.adverse_media_status, 'adverse media must have been checked for links to exist').toBe('Ok');
  return { requestId, data };
}

/**
 * An adverse-media match is one whose source list is ADVERSE_MEDIA (gateway aml-case matches). Keyed on source_list, not
 * headline: a real ADVERSE_MEDIA match can have headline:null (lrb.co.uk, MOCK-1-D5).
 */
const isAdverseMedia = (match: Match): boolean => match.source_list === 'ADVERSE_MEDIA';

test.describe('MODB-MOCK-1 AML source links on the gateway aml-case @modb-api', () => {
  test('AC-MOCK-6: as the surface-ON tenant, direct AMLService adverse-media matches carry a non-empty sourceUrl', async ({ request }) => {
    test.skip(
      !SURFACE_ON_TENANT_ID || !SURFACE_ON_API_KEY,
      'MODB_SURFACE_ON_TENANT_ID / MODB_SURFACE_ON_AML_API_KEY missing from .env.<target>.secrets: the surface-ON tenant is unobserved',
    );
    test.info().annotations.push({ type: 'tenant', description: String(SURFACE_ON_TENANT_ID) });
    const body = await screenAsSurfaceOnTenant(request, SURFACE_ON_API_KEY!);
    const matches = body.matchedEntities;
    const adverseMedia = matches.filter(isDirectAdverseMedia);
    // Without this, "every match has a sourceUrl" is vacuously true over zero matches.
    expect(adverseMedia.length, `screening '${SURFACE_ON_SUBJECT}' returned no adverse-media match to link`).toBeGreaterThanOrEqual(1);

    for (const [index, match] of adverseMedia.entries()) {
      expect(match.sourceUrl, `adverse-media match ${index} (${String(match.externalId)}) must carry a full sourceUrl`).toEqual(
        expect.stringMatching(/^https?:\/\/\S+$/),
      );
    }
    // A watchlist match has no article: its link is absent, never "".
    for (const match of matches.filter((candidate) => !isDirectAdverseMedia(candidate))) expect(match.sourceUrl ?? null).toBeNull();
  });

  // AC-MOCK-6B pairs with AC-MOCK-6 as the two halves of one flag (owner decision D-MODB-AM-1 "Suppress
  // adverse media at the response mapper", 2026-09-20). AC-MOCK-6 asserts the link-carrying behaviour the
  // product is built to have; this asserts the CLIENT-FACING DEFAULT, which is that the link is not emitted
  // at all. `AdverseMedia:Surface:Enabled` (AdverseMediaSurfaceOptions, default FALSE) decides which of the
  // two holds, so exactly one of this pair is green in any one deployment -- that is the contract, not a
  // conflict. Neither may be amended to agree with whatever the configuration currently is.
  //
  // Scope: the gateway's own `source_url` field ONLY. Out of scope and NOT asserted absent here --
  // `external_id` still carries the GDELT article URL and the leadership link still rides inside
  // Presentation.Evidence (open item AM-SURFACE-2). Asserting those absent would fail on a known gap and
  // say nothing about this flag.
  test('AC-MOCK-6B: with the adverse-media surface OFF (the default), no match carries a source_url', async ({ request }) => {
    const { data } = await screenedCase(request);
    const matches = data.matches as Match[];
    const adverseMedia = matches.filter(isAdverseMedia);
    expect(adverseMedia.length, 'the specimen screen returned no adverse-media match, so the gate is unobserved').toBeGreaterThanOrEqual(1);
    const linked = matches.filter((match) => 'source_url' in match).map((match) => String(match.source_url));
    expect(linked, 'the surface is OFF, so no match may carry source_url; these did').toEqual([]);
  });

  test('AC-MOCK-8 (API side): every match is returned in one response, and no paging parameter changes it', async ({ request }) => {
    const { requestId, data } = await screenedCase(request);
    const matches = data.matches as Match[];
    expect(matches.length, 'the display cap needs more than 10 matches to mean anything').toBeGreaterThan(DISPLAY_CAP);
    for (const key of PAGING_KEYS) expect(data, `aml-case data carries paging key "${key}"`).not.toHaveProperty(key);

    const again = await getAmlCase(request, requestId);
    expect(again.status()).toBe(200);
    expect((await again.json()).data.matches).toEqual(matches);

    // A paging query is either refused outright or ignored; it never trims the list.
    const paged = await request.get(`${resolveGatewayUrl(process.env)}/api/v1/checks/${requestId}/aml-case?${PAGING_QUERY}`, {
      failOnStatusCode: false,
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (paged.status() === HTTP_BAD_REQUEST) return;
    expect(paged.status()).toBe(200);
    const pagedBody = await paged.json();
    expect(pagedBody.data.matches).toEqual(matches);
    for (const key of PAGING_KEYS) expect(pagedBody.meta ?? {}, `meta carries paging key "${key}"`).not.toHaveProperty(key);
  });
});
