// @modb-api tier — MODB-MOCK-1 "demo identity picker + AML source links", acceptance tests AC-MOCK-6 and the API
// side of AC-MOCK-8 (owner decision MOCK-1-D4, MODB-MOCK-1-SPEC.md §3.3 + §4).
//
// AC-MOCK-6B and AC-MOCK-8 go through the wl-api-gateway as tenant 706772f5, naming the subject through the mock identity
// field. The ERIKSSON specimen screens clean once adverse media is OFF (0 matches, measured 2026-09-21), so 6B screens
// "Viktor Bout" (1 OFAC match) and 8 screens "Mohammed Ali" (25 watchlist matches, above the display cap of 10).
//
// 🔴 D-MODB-AM-15 "Adverse media fully OFF by default, with a per-tenant MASTER switch for development" (owner,
// 2026-09-21; AMLService 1654f960 on staging, `AdverseMedia__Enabled=false`, master ON only for the surface-ON
// tenant). The gateway tenant 706772f5 now gets `adverse_media_status=NotReported` and NO adverse media at all, so
// AC-MOCK-6B asserts that absence (no ADVERSE_MEDIA match, no adverse-media reason, no source_url) against at least
// one watchlist match, instead of "adverse-media matches exist but carry no link".
//
// AC-MOCK-6 calls AMLService DIRECTLY (owner decision D-MODB-AM-9 "AC-MOCK-6 calls AMLService directly as a second
// tenant", 2026-09-21). The gateway pins ONE tenant (706772f5, modb-api-gateway.yml:101) and the per-tenant flag
// `AdverseMedia__Surface__TenantOverrides__<tenantId>` can make only one of 6/6B true for it. So 6 screens as tenant
// MODB_SURFACE_ON_TENANT_ID "ModB E2E Surface-ON (staging)" with MODB_SURFACE_ON_AML_API_KEY, whose override is ON.
// ACCEPTED GAP (D-MODB-AM-9): the surface-ON case no longer covers the gateway forwarding `source_url`
// (http-aml-case.reader.ts). Only the OFF case (6B) covers the full gateway path.
//
// MODB-E2E-MIGRATE-1 (2026-09-23): the gateway half (6B, 8) moved to the SESSION API and reads the case through the
// operator API, because `POST /api/v1/verifications` and the public `/api/v1/checks` route are unregistered on the
// deployed gateway (MODB-ENDPOINT-1). AC-MOCK-6 calls AMLService directly and is untouched by that move.
//
// 🔴 D-MODB-AM-18 "Article links always travel with adverse-media matches" (owner, 2026-09-22) SUPERSEDES the
// link-hiding rule of D-MODB-AM-1 / D-MODB-AM-4: every adverse-media match that is returned carries its article
// link, whatever `AdverseMedia:Surface:Enabled` says. AC-MOCK-6B's old line "no match may carry source_url" pinned
// exactly the behaviour that decision reversed, so it is inverted below (owner unlock 2026-09-23, recorded in
// BaseClient/docs/Tasks/COMPLETED/MODB-MOCK-1-SPEC.md). D-MODB-AM-15 is UNCHANGED: a master-OFF tenant still gets
// no adverse-media matches at all, so on the gateway tenant the link rule has nothing to range over - AC-MOCK-6
// (surface-ON tenant, direct AMLService) is the half that observes a link.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADVERSE_MEDIA_CATEGORY, AML_API_URL, screen } from '../aml/aml-helpers.js';
import {
  AML_CHECK,
  amlCase,
  assertGatewayReachable,
  rowOf,
  waitForAmlTerminal,
} from './modb-session-helpers.js';
import { screenViaSession } from './modb-session-mock.js';

/** The portal renders the first 10 and a "show all N" control (spec §3.3). */
const DISPLAY_CAP = 10;
/** One OFAC match through the gateway (measured 2026-09-21). */
const WATCHLIST_SUBJECT = 'Viktor Bout';
/** 25 watchlist matches through the gateway (EU/UK/OFAC/WIKIDATA, measured 2026-09-21), above DISPLAY_CAP. */
const MANY_MATCHES_SUBJECT = 'Mohammed Ali';
const PAGING_QUERY = 'limit=10&offset=0&page=1&page_size=10&cursor=0';
const PAGING_KEYS = ['page', 'page_size', 'limit', 'offset', 'cursor', 'next', 'next_cursor', 'has_more', 'total_pages', 'total'];
const HTTP_BAD_REQUEST = 400;
/** D-MODB-AM-18: an article link is a full URL, never "" and never a bare id. */
const ARTICLE_LINK = /^https?:\/\/\S+$/;

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

/** Screen the specimen through the gateway and return its aml-case `data`. Adverse media is OFF for this tenant (D-MODB-AM-15). */
async function screenedCase(request: APIRequestContext, subject: string): Promise<{ requestId: string; data: Record<string, unknown> }> {
  await assertGatewayReachable(request);
  const { session, requestId } = await screenViaSession(request, { subject });
  test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
  expect(rowOf(await waitForAmlTerminal(request, session.sessionId), AML_CHECK).status).toBe('completed');
  const read = await amlCase(request, requestId);
  expect(read.status(), await read.text()).toBe(200);
  const data = (await read.json()).data as Record<string, unknown>;
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
        expect.stringMatching(ARTICLE_LINK),
      );
    }
    // A watchlist match has no article: its link is absent, never "".
    for (const match of matches.filter((candidate) => !isDirectAdverseMedia(candidate))) expect(match.sourceUrl ?? null).toBeNull();
  });

  // AC-MOCK-6B — D-MODB-AM-15 "Adverse media fully OFF by default, with a per-tenant MASTER switch for development"
  // (owner, 2026-09-21) replaces the D-MODB-AM-1 reading of this test ("adverse-media matches exist, links hidden").
  // The gateway tenant 706772f5 has the master OFF, so the gateway case must carry no adverse media at all: no
  // ADVERSE_MEDIA match, no adverse-media reason or category anywhere in `data`, and no `source_url` on any match.
  // At least one watchlist match must exist, or "no adverse media" and "no link" are true of an empty list.
  // AC-MOCK-6 (surface-ON tenant, direct AMLService) remains the half that proves links are emitted when ON.
  test('AC-MOCK-6B: the gateway tenant has adverse media OFF (D-MODB-AM-15): no adverse-media match or reason, no source_url', async ({ request }) => {
    const { data } = await screenedCase(request, WATCHLIST_SUBJECT);
    const matches = data.matches as Match[];
    expect(data.adverse_media_status, 'the gateway tenant has the adverse-media master OFF (D-MODB-AM-15)').toBe('NotReported');

    const watchlist = matches.filter((match) => !isAdverseMedia(match));
    expect(watchlist.length, 'the specimen screen returned no watchlist match, so the absence checks below are vacuous').toBeGreaterThanOrEqual(1);
    expect(
      matches.filter(isAdverseMedia).map((match) => String(match.external_id ?? match.name ?? '?')),
      'adverse media is OFF for the gateway tenant, yet ADVERSE_MEDIA matches came back',
    ).toEqual([]);

    // Reasons and categories are checked over the WHOLE payload, not a guessed field name. The status key itself is
    // dropped first because its NAME contains "adverse_media".
    const rest: Record<string, unknown> = { ...data };
    delete rest.adverse_media_status;
    const payload = JSON.stringify(rest);
    expect(payload, 'an ADVERSE_MEDIA source or reason code is on the gateway case').not.toContain('ADVERSE_MEDIA');
    // As a VALUE only: the key "adverse_media" legitimately names the (null) stage in aml_processing.stages.
    expect(payload, 'an adverse_media category is on the gateway case').not.toContain(':"adverse_media"');

    // D-MODB-AM-18 (owner 2026-09-22) replaces "no match may carry source_url": a returned adverse-media match
    // ALWAYS carries its article link. Under D-MODB-AM-15 this tenant returns none, so the rule is checked over the
    // adverse-media matches the gateway actually returned (today: zero - see this file's header and NOT COVERED).
    for (const [index, match] of matches.filter(isAdverseMedia).entries()) {
      expect(
        match.source_url,
        `adverse-media match ${index} (${String(match.external_id)}) must carry its article link (D-MODB-AM-18)`,
      ).toEqual(expect.stringMatching(ARTICLE_LINK));
    }
  });

  test('AC-MOCK-8 (API side): every match is returned in one response, and no paging parameter changes it', async ({ request }) => {
    const { requestId, data } = await screenedCase(request, MANY_MATCHES_SUBJECT);
    const matches = data.matches as Match[];
    expect(matches.length, 'the display cap needs more than 10 matches to mean anything').toBeGreaterThan(DISPLAY_CAP);
    for (const key of PAGING_KEYS) expect(data, `aml-case data carries paging key "${key}"`).not.toHaveProperty(key);

    const again = await amlCase(request, requestId);
    expect(again.status(), await again.text()).toBe(200);
    expect((await again.json()).data.matches).toEqual(matches);

    // A paging query is either refused outright or ignored; it never trims the list.
    const paged = await amlCase(request, requestId, PAGING_QUERY);
    if (paged.status() === HTTP_BAD_REQUEST) return;
    expect(paged.status()).toBe(200);
    const pagedBody = await paged.json();
    expect(pagedBody.data.matches).toEqual(matches);
    for (const key of PAGING_KEYS) expect(pagedBody.meta ?? {}, `meta carries paging key "${key}"`).not.toHaveProperty(key);
  });
});
