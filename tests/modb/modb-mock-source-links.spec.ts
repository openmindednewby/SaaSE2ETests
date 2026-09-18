// @modb-api tier — MODB-MOCK-1 "demo identity picker + AML source links", acceptance tests AC-MOCK-6 and the API
// side of AC-MOCK-8 (owner decision MOCK-1-D4, MODB-MOCK-1-SPEC.md §3.3 + §4). HTTP only, against the wl-api-gateway.
//
// Each test screens the synthetic MRZ specimen (46 matches with adverse media Ok on staging, MODB-2-INT 8-AM-diag), so
// the payload has adverse-media matches to carry links and more than ten matches for the display cap.
//
// AC-MOCK-6 is committed RED: no gateway match carries `source_url` until AMLService maps GdeltArticleIndexEntry.Url
// onto MatchedEntityResponse and http-aml-case.reader.ts forwards it. AC-MOCK-8 (API side) is a guard that the display
// cap never becomes API paging, and is expected green throughout.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AML_CHECK, assertGatewayReachable, getAmlCase, rowOf, submitVerification, waitForAmlTerminal } from './modb-helpers.js';
import { resolveGatewayUrl } from './modb-guards.js';

/** The portal renders the first 10 and a "show all N" control (spec §3.3). */
const DISPLAY_CAP = 10;
const PAGING_QUERY = 'limit=10&offset=0&page=1&page_size=10&cursor=0';
const PAGING_KEYS = ['page', 'page_size', 'limit', 'offset', 'cursor', 'next', 'next_cursor', 'has_more', 'total_pages', 'total'];
const HTTP_BAD_REQUEST = 400;
const REQUEST_TIMEOUT_MS = 30_000;

type Match = Record<string, unknown>;

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

/** An adverse-media match is the one that carries an article headline (gateway aml-case matches). */
const isAdverseMedia = (match: Match): boolean => typeof match.headline === 'string' && match.headline !== '';

test.describe('MODB-MOCK-1 AML source links on the gateway aml-case @modb-api', () => {
  test('AC-MOCK-6: adverse-media matches carry a source_url; the field is omitted, never "", where there is none', async ({ request }) => {
    const { data } = await screenedCase(request);
    const matches = data.matches as Match[];
    const adverseMedia = matches.filter(isAdverseMedia);
    expect(adverseMedia.length, 'the specimen screen returned no adverse-media match to link').toBeGreaterThanOrEqual(1);

    const linked = adverseMedia.filter((match) => 'source_url' in match);
    expect(linked.length, 'NOT IMPLEMENTED: no adverse-media match carries source_url').toBeGreaterThanOrEqual(1);
    for (const [index, match] of matches.entries()) {
      if (!('source_url' in match)) continue;
      expect(match.source_url, `matches[${index}].source_url is present, so it must be a full URL`).toEqual(
        expect.stringMatching(/^https?:\/\/\S+$/),
      );
    }
    // A watchlist match has no article: its link is absent, not null and not "".
    for (const match of matches.filter((candidate) => !isAdverseMedia(candidate))) expect(match).not.toHaveProperty('source_url');
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
