// @aml-api tier — the SWITCHED-ON half of adverse media. aml-adverse-media.spec.ts asserts what is true
// while collection is OFF (capability honesty, the decision matrix, reproducibility). This file asserts
// what must become true the moment `AdverseMedia:SliceTail:Enabled` is on and rows exist.
//
// 🔴 WHY THIS FILE EXISTS — the hole it closes.
// AM-E2E-3 skips on an EMPTY MATCH SET (`amMatches.length === 0`, aml-adverse-media.spec.ts:173). That
// condition cannot tell three different worlds apart:
//   (a) collection is off — nothing to match. Legitimate skip.
//   (b) collection is on, but this one subject genuinely has no article. Legitimate.
//   (c) collection is on, rows exist, and the API DROPS them from the screening payload — the exact
//       regression the adverse-media control exists to catch.
// In world (c) AM-E2E-3 reports SKIPPED, the tally stays "3 passed / 1 skipped / 0 failed", and the
// defect ships behind the same green line as today. AM-E2E-5 below is the control that turns (c) RED.
//
// 🔴 2026-09-08 — AM-E2E-5's ORIGINAL PREMISE WAS WRONG, and its first-ever red was a false
// attribution. It skipped on the CAPABILITY alone and then read `available && total === 0` as "the
// leg is broken". Measured: the stage IS available and the pipeline IS collecting (8 slices
// processed, 1,796 GKG records scanned), but the tailer only scans names in its WATCH BOOK, and the
// golden corpus was never in that book — so there was never anything to find. Two different failures
// wore one red. The probe in ./am-name-book-probe.ts splits them on an observable the match count
// cannot supply, and the skip it produces is keyed to the ROSTER, never to an empty result set.
//
// 🔴 WHAT THIS STILL CANNOT SEE. API-driven by owner decision: it drives the AML API, never the aml-v2
// UI, so a portal that renders an adverse-media hit blank still passes here. It also cannot adjudicate
// PRECISION — whether the article is genuinely about this subject. And the roster it probes is a
// TENANT-SCOPED SUBSET of the tailer's cross-tenant book, so "not on the roster" is not observable
// absence from the book — see the header of am-name-book-probe.ts.
//
// 🔴 D-MODB-AM-13 "AM-E2E-6 screens as the surface-ON tenant, and the gate OMITS externalId" (owner,
// 2026-09-21, MODB-BOARD-1 "Azure board items to Module B PR bundles" §24). The response mapper
// (ScreeningResponseMapper.OutwardExternalId) hides the adverse-media article URL for every tenant whose
// `AdverseMedia:Surface` is OFF, which is the default. So AM-E2E-6 screens as the surface-ON tenant
// MODB_SURFACE_ON_TENANT_ID (the D-MODB-AM-9 pattern, modb-mock-source-links.spec.ts AC-MOCK-6), and its
// sibling AM-E2E-6B screens the SAME request as the default tenant (AML_API_KEY) and requires the
// `externalId` KEY to be ABSENT on adverse-media matches (not "", not null), exactly like `sourceUrl`,
// while watchlist matches keep theirs.
import { expect, test } from '@playwright/test';
import { probeAmNameBook, ruleOnAmCorpus } from './am-name-book-probe.js';
import {
  ADVERSE_MEDIA_CATEGORY,
  AML_API_KEY,
  AML_API_URL,
  adverseMediaCapability,
  amlGet,
  amlPost,
  amlReachable,
  screen,
  type AdverseMediaCapability,
} from './aml-helpers.js';

const AUTH_REJECTED = [401, 403];
const CREATED = 201;
const OK = 200;

// AdverseMediaCategory (AMLService/Domain/Screening/AdverseMediaCategory.cs), serialized by NAME.
const ADVERSE_MEDIA_CATEGORIES = new Set([
  'Unknown',
  'FinancialCrime',
  'Cybercrime',
  'Regulatory',
  'HighRisk',
  'GeneralCrime',
]);

// The subjects these controls screen. 🔴 CORRECTED 2026-09-08 from the original golden-corpus
// `positives` bucket (`Jho Low`, `Gulnara Karimova`, `Bashar al-Assad`) after the index carried real
// rows for the first time. MEASURED against the live API on that date: those three return ZERO
// adverse-media matches, because the slice-tailer only scans names in its watch book and none of the
// three is in it. Screening a name the tailer never watched can only ever produce a zero, so the old
// corpus made AM-E2E-5/6/7 structurally unable to observe a hit — three controls that had never run a
// single assertion between them.
//
// What IS in the book, and why each name is here:
//   Benjamin Netanyahu — a MonitoredSubject (tenant 7e57a001-…-0001, enrolled 2026-09-08). FIRST on
//     purpose: it is the only corpus name the tenant-scoped roster probe can SEE, so it is what turns
//     ruleOnAmCorpus into `mustAssert`, and AM-E2E-7 dispositions POSITIVE_CORPUS[0]. 5 bound articles.
//   Vladimir Putin — NOT a MonitoredSubject; he entered the book via the IncludeScreenedNames branch
//     off MediaLookups (AdverseMediaSliceTailService.cs:721-728). 137 bound articles, the densest
//     input available, so AM-E2E-6 has evidence to assert on even if the enrolled subject is unbound.
//   Jho Low — kept as the original-corpus canary. It is expected to contribute zero today; if it ever
//     starts contributing, the book widened and that is worth noticing.
// When the stage is AVAILABLE, a corpus subject is provably in the book, and this whole list still
// returns nothing, the collection leg is broken — that is what AM-E2E-5 turns red on.
const POSITIVE_CORPUS = ['Benjamin Netanyahu', 'Vladimir Putin', 'Jho Low'];

interface AmMatch {
  externalId?: string | null;
  matchKey?: string | null;
  rejectionTag?: string | null;
  adverseMediaCategory?: string | null;
  headline?: string | null;
  publisher?: string | null;
}
interface AmScreen {
  id: string;
  decision?: string | null;
  matchedEntities: AmMatch[];
  adverseMediaStatus?: string | null;
  reason?: { code: string; category?: string | null } | null;
  reasonCodes?: string[] | null;
}
interface CaseMatch {
  matchKey: string;
  rejectionTag?: string | null;
  reviewStatus?: string | null;
  reviewReason?: string | null;
  reviewedAt?: string | null;
}
interface CaseDetail {
  id: string;
  reviewStatus: string;
  matches: CaseMatch[];
}

const isAm = (m: AmMatch | CaseMatch): boolean =>
  m.rejectionTag === ADVERSE_MEDIA_CATEGORY || !!(m as AmMatch).adverseMediaCategory;

const amOf = (body: AmScreen): AmMatch[] => body.matchedEntities.filter(isAm);

// D-MODB-AM-13: the tenant whose adverse-media surface override is ON (created for D-MODB-AM-9).
const SURFACE_ON_TENANT_ID = process.env.MODB_SURFACE_ON_TENANT_ID?.trim() || null;
const SURFACE_ON_API_KEY = process.env.MODB_SURFACE_ON_AML_API_KEY?.trim() || null;
/**
 * `adverseMediaStatus=Unavailable` means the GDELT stage missed its latency budget, i.e. "not yet", not
 * "broken". Re-screen with backoff, the same way AC-MOCK-6 does (modb-mock-source-links.spec.ts).
 */
const AM_RETRY_INTERVALS_MS = [5_000, 10_000, 20_000, 30_000];
const AM_RETRY_TIMEOUT_MS = 120_000;
/** Up to three corpus subjects, each allowed one full retry budget. */
const AM_E2E_6_TIMEOUT_MS = 420_000;
const HTTP_URL = /^https?:\/\/\S+$/;

/** Screen `fullName` with `apiKey` until adverse media leaves Unavailable, or fail with the last status seen. */
async function screenUntilAmSettles(
  request: Parameters<typeof screen>[0],
  fullName: string,
  apiKey: string,
  who: string,
): Promise<AmScreen> {
  let last: AmScreen | null = null;
  await expect
    .poll(
      async () => {
        const res = await screen(request, { fullName, adverseMedia: true, includeReasoning: true }, apiKey);
        const http = res?.status() ?? 0;
        if (!res || http !== CREATED) return `http ${http}`;
        last = (await res.json()) as AmScreen;
        return last.adverseMediaStatus ?? 'missing';
      },
      {
        message:
          `screening '${fullName}' as ${who} at ${AML_API_URL} never reached adverseMediaStatus=Ok within the ` +
          'retry budget (Unavailable = the GDELT stage kept missing its latency budget; http 401/403 = key rejected)',
        intervals: AM_RETRY_INTERVALS_MS,
        timeout: AM_RETRY_TIMEOUT_MS,
      },
    )
    .toBe('Ok');
  return last as unknown as AmScreen;
}

/** The first corpus subject whose settled screen carries an adverse-media match, or null if none does. */
async function firstCorpusHit(
  request: Parameters<typeof screen>[0],
  apiKey: string,
  who: string,
): Promise<{ fullName: string; body: AmScreen; hits: AmMatch[] } | null> {
  for (const fullName of POSITIVE_CORPUS) {
    const body = await screenUntilAmSettles(request, fullName, apiKey, who);
    const hits = amOf(body);
    if (hits.length > 0) return { fullName, body, hits };
  }
  return null;
}

function skipNoCorpusHit(testId: string): void {
  test.info().annotations.push({
    type: `${testId}-never-executed`,
    description: `no corpus subject carried an adverse-media match, so ${testId} asserted nothing on this run.`,
  });
  test.skip(
    true,
    'the stage is available but no corpus subject carried an adverse-media match. AM-E2E-5 is the ' +
      'control for this: it FAILS when a corpus subject is provably in the indexed name book and ' +
      'slices were scanned against it, and reports its own no-input outcome otherwise.',
  );
}

/**
 * Skip ONLY when the stage says it is unavailable. This is the discriminator AM-E2E-3 lacks: an empty
 * result set is not evidence that collection is off.
 */
async function requireAvailableStage(
  request: Parameters<typeof screen>[0],
): Promise<AdverseMediaCapability | null> {
  const cap = await adverseMediaCapability(request);
  if (!cap) {
    test.skip(true, `screening-capabilities unreadable at ${AML_API_URL} — cannot tell on from off.`);
    return null;
  }
  if (!cap.available) {
    test.skip(
      true,
      `adverse-media collection is OFF (source=${cap.source}, reason=${cap.unavailableReason ?? 'none'}) ` +
        '— the switched-on assertions have nothing to observe. This skip is keyed to the CAPABILITY, so ' +
        'it disappears on its own the moment the stage reports itself available.',
    );
    return null;
  }
  return cap;
}

test.describe('AML adverse media — switched on @aml-api', () => {
  test.beforeEach(async ({ request }) => {
    // Budget, not flake: this screens the WHOLE positive corpus sequentially, and each screen()
    // is allowed 25s by aml-helpers. Under the 30s default the test times out whenever more than
    // one subject is slow (observed 2026-09-11: timeout at 30.0s, then a clean pass). Raising the
    // cap fixes the measurement window; it does not weaken an assertion.
    test.setTimeout(180_000);
    if (!AML_API_KEY) test.skip(true, 'AML_API_KEY is not set — cannot authenticate.');
    if (!(await amlReachable(request))) test.skip(true, `AML API not reachable at ${AML_API_URL}.`);
  });

  // 5 — THE ANTI-SILENT-SKIP CONTROL. Runs only once the stage is available; then a corpus-wide zero
  // FAILS instead of skipping. This is the assertion that makes world (c) above visible.
  test('AM-E2E-5 an AVAILABLE adverse-media stage surfaces at least one hit across the positive corpus', async ({
    request,
  }) => {
    if (!(await requireAvailableStage(request))) return;

    let total = 0;
    const perSubject: string[] = [];
    for (const fullName of POSITIVE_CORPUS) {
      const res = await screen(request, { fullName, adverseMedia: true, includeReasoning: true });
      expect(res, `screening endpoint unreachable for '${fullName}'`).not.toBeNull();
      if (AUTH_REJECTED.includes(res!.status())) {
        test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
        return;
      }
      expect(res!.status()).toBe(CREATED);
      const body = (await res!.json()) as AmScreen;
      const hits = amOf(body).length;
      total += hits;
      perSubject.push(`${fullName}=${hits}/${body.adverseMediaStatus}`);
    }
    test.info().annotations.push({ type: 'am-corpus', description: perSubject.join(' ') });

    // The discriminator. `available == true` does NOT imply the corpus is findable: the tailer only
    // scans names in its watch book, and the golden corpus was never in it (measured 2026-09-08 — 8
    // slices processed, 1,796 records scanned, 0 hits, book built from 3 MonitoredSubjects + 2
    // MediaLookups rows, none of them corpus). Keyed on the ROSTER + the slice history, never on the
    // match count — keying on the empty result set is the vacuity AM-E2E-3 already has.
    const probe = await probeAmNameBook(request, POSITIVE_CORPUS);
    const ruling = ruleOnAmCorpus(probe);
    test.info().annotations.push({
      type: 'am-name-book',
      description:
        `roster=${probe.rosterSize} corpusOnRoster=[${probe.observedCorpusNames.join('|')}] ` +
        `enrolledAt=${probe.earliestCorpusEnrolledAt ?? 'n/a'} ` +
        `newestProcessedSlice=${probe.newestProcessedSliceAt ?? 'none'} ` +
        `probeError=${probe.probeError ?? 'none'} mustAssert=${ruling.mustAssert}`,
    });

    // A non-zero total passes in either world. Only what a ZERO MEANS is in dispute.
    if (total === 0 && !ruling.mustAssert) {
      test.info().annotations.push({ type: 'am-e2e-5-did-not-test', description: ruling.reason });
      test.skip(true, ruling.reason);
      return;
    }

    expect(total, ruling.reason).toBeGreaterThan(0);
  });

  // 6 — the decision + reason + presentable-evidence contract ON A REAL HIT. AM-E2E-3 asserts only
  // `decision !== 'Pass'`; the shipped posture (Q7, 2026-08-23) is REVIEW, and a Fail would satisfy
  // `!== 'Pass'` while contradicting that posture. Assert the value, not the negation.
  // D-MODB-AM-13: screened as the surface-ON tenant, the only tenant for which externalId is the article URL.
  test('AM-E2E-6 as the surface-ON tenant, a real adverse-media hit resolves to Review and carries a usable reason + evidence', async ({
    request,
  }) => {
    test.setTimeout(AM_E2E_6_TIMEOUT_MS);
    test.skip(
      !SURFACE_ON_TENANT_ID || !SURFACE_ON_API_KEY,
      'MODB_SURFACE_ON_TENANT_ID / MODB_SURFACE_ON_AML_API_KEY are not set (E2ETests/.env.<target>.secrets): ' +
        'the surface-ON tenant is unobserved (D-MODB-AM-13)',
    );
    if (!(await requireAvailableStage(request))) return;
    test.info().annotations.push({ type: 'tenant', description: String(SURFACE_ON_TENANT_ID) });

    const found = await firstCorpusHit(request, SURFACE_ON_API_KEY!, `surface-ON tenant ${SURFACE_ON_TENANT_ID}`);
    if (!found) {
      skipNoCorpusHit('am-e2e-6');
      return;
    }
    const { body, hits } = found;
    const [hit] = hits;
    test.info().annotations.push({ type: 'am-subject', description: `${found.fullName} (${hits.length} hits)` });

    expect(
      body.decision,
      'an adverse-media hit routes to an analyst rather than auto-blocking (Q7, 2026-08-23; ' +
        'DecisionMatrix.cs:168)',
    ).toBe('Review');

    const codes = [...(body.reasonCodes ?? []), body.reason?.code ?? ''].join(' ');
    expect(
      codes.includes('ADVERSE_MEDIA') || body.reason?.category === ADVERSE_MEDIA_CATEGORY,
      `an adverse-media-driven decision must carry an adverse-media reason (got '${codes}')`,
    ).toBeTruthy();

    if (hit.adverseMediaCategory) {
      expect(
        ADVERSE_MEDIA_CATEGORIES.has(String(hit.adverseMediaCategory)),
        `adverseMediaCategory '${hit.adverseMediaCategory}' is outside the declared taxonomy — a category ` +
          'the tenant warning-type policy has no key for silently drops the warning',
      ).toBeTruthy();
    }
    // 🔴 REWRITTEN 2026-09-08 against a REAL payload. `headline` is NULL on every row (the
    // `gkg:v1minimal:themegated:v1` parse profile captures no title), so each field is asserted on its
    // own and the headline gap is recorded as a KNOWN PRODUCT LIMITATION. Do NOT convert this into
    // `expect(hit.headline).toBeNull()` — that would PIN the defect.
    expect(
      (hit.publisher ?? '').trim(),
      'an adverse-media match with no publisher is not reviewable evidence — the analyst is asked to ' +
        'judge an article they cannot attribute to any outlet',
    ).toBeTruthy();
    for (const [index, match] of hits.entries()) {
      expect(
        match.externalId,
        `adverse-media match ${index}: for the surface-ON tenant externalId IS the article URL ` +
          '(AdverseMediaArticle.cs:14). With the headline empty it is the only way an analyst can reach the article',
      ).toEqual(expect.stringMatching(HTTP_URL));
    }
    if (!(hit.headline ?? '').trim()) {
      test.info().annotations.push({
        type: 'am-headline-gap',
        description:
          'KNOWN PRODUCT LIMITATION (measured 2026-09-08, not a test defect): `headline` is on the ' +
          'wire but NULL on every adverse-media row, because the shipped parse profile ' +
          '`gkg:v1minimal:themegated:v1` extracts no article title. A customer-facing surface can ' +
          `show only the publisher domain (${hit.publisher}) and the URL. Track 8 renders this field.`,
      });
    }
  });

  // 6B — the other half of the D-MODB-AM-13 gate. The SAME screen as the default tenant (surface OFF):
  // the article URL must not leave the API. The key is ABSENT, never "" and never null, so it behaves
  // exactly like `sourceUrl`. Watchlist matches are untouched by the gate and keep their externalId.
  test('AM-E2E-6B as the default tenant (surface OFF), adverse-media matches OMIT externalId while watchlist matches keep it', async ({
    request,
  }) => {
    test.setTimeout(AM_E2E_6_TIMEOUT_MS);
    if (!(await requireAvailableStage(request))) return;

    const found = await firstCorpusHit(request, AML_API_KEY!, 'the default tenant (AML_API_KEY)');
    if (!found) {
      skipNoCorpusHit('am-e2e-6b');
      return;
    }
    const { body, hits } = found;
    test.info().annotations.push({ type: 'am-subject', description: `${found.fullName} (${hits.length} hits)` });

    for (const [index, match] of hits.entries()) {
      expect(
        Object.keys(match),
        `adverse-media match ${index}: the surface is OFF, so the externalId KEY must be absent ` +
          `(got ${JSON.stringify(match.externalId)}); "" or null still tells the client a link exists`,
      ).not.toContain('externalId');
    }

    const watchlist = body.matchedEntities.filter((match) => !isAm(match));
    expect(
      watchlist.length,
      `screening '${found.fullName}' returned no watchlist match, so "watchlist matches keep externalId" is unobserved`,
    ).toBeGreaterThanOrEqual(1);
    for (const [index, match] of watchlist.entries()) {
      expect(
        (match.externalId ?? '').trim(),
        `watchlist match ${index} lost its externalId: the D-MODB-AM-13 gate must touch adverse media only`,
      ).toBeTruthy();
    }
  });

  // 7 — the per-match disposition control on an ADVERSE-MEDIA match. GAP-5 has only ever been proven
  // against a WIKIDATA hit (AMLService.IntegrationTests/CaseMatchDispositionEndpointTests.cs seeds one),
  // so the AM path through POST /v1/cases/{id}/matches/{matchKey}/disposition is unexercised.
  test('AM-E2E-7 the per-match disposition operates on an ADVERSE-MEDIA match and is reversible', async ({
    request,
  }) => {
    if (!(await requireAvailableStage(request))) return;

    const userReference = `e2e-am-${Date.now()}`;
    const screened = await screen(request, {
      fullName: POSITIVE_CORPUS[0],
      adverseMedia: true,
      includeReasoning: true,
      userReference,
    });
    expect(screened, 'screening endpoint unreachable').not.toBeNull();
    if (AUTH_REJECTED.includes(screened!.status())) {
      test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
      return;
    }
    expect(screened!.status()).toBe(CREATED);

    const list = await amlGet(request, `/v1/cases?userReference=${encodeURIComponent(userReference)}`);
    expect(list, 'cases list unreachable').not.toBeNull();
    expect(list!.status()).toBe(OK);
    const page = (await list!.json()) as { items: Array<{ id: string }> };
    if (page.items.length === 0) {
      test.skip(true, `no case was filed for ${userReference} — nothing to disposition.`);
      return;
    }
    const caseId = page.items[0].id;

    const detailRes = await amlGet(request, `/v1/cases/${caseId}`);
    expect(detailRes!.status()).toBe(OK);
    const detail = (await detailRes!.json()) as CaseDetail;
    const caseLevelBefore = detail.reviewStatus;
    const amMatch = detail.matches.find(isAm);
    if (!amMatch) {
      test.info().annotations.push({
        type: 'am-e2e-7-never-executed',
        description:
          'ZERO assertions have ever run in AM-E2E-7. The disposition round-trip, its persistence and ' +
          'its reversibility on an ADVERSE-MEDIA match are unexercised; only the WIKIDATA path is ' +
          'covered (AMLService.IntegrationTests/CaseMatchDispositionEndpointTests.cs).',
      });
      test.skip(
        true,
        'the case carries no adverse-media match. AM-E2E-5 is the control for this: it FAILS when a ' +
          'corpus subject is provably in the indexed name book and slices were scanned against it, and ' +
          'reports its own no-input outcome otherwise. Note the case read model exposes rejectionTag ' +
          'but NOT adverseMediaCategory (Application/Cases/CaseDtos.cs:102).',
      );
      return;
    }

    const url = `/v1/cases/${caseId}/matches/${amMatch.matchKey}/disposition`;
    const cleared = await amlPost(request, url, { status: 'cleared', reason: 'e2e: co-occurrence only' });
    expect(cleared, 'disposition endpoint unreachable').not.toBeNull();
    if (AUTH_REJECTED.includes(cleared!.status())) {
      test.skip(true, 'the AML_API_KEY does not carry ScreeningWrite — cannot disposition.');
      return;
    }
    expect(cleared!.status()).toBe(OK);

    // A fresh read, not the POST echo: a read weeks later must not disagree with the analyst.
    const rereadRes = await amlGet(request, `/v1/cases/${caseId}`);
    const reread = (await rereadRes!.json()) as CaseDetail;
    const after = reread.matches.find(m => m.matchKey === amMatch.matchKey);
    expect(after, 'the dispositioned match vanished from the case').toBeTruthy();
    expect(after!.reviewStatus, 'the adverse-media disposition did not persist on the match').toBe('cleared');
    expect(after!.reviewReason).toBe('e2e: co-occurrence only');
    expect(after!.reviewedAt, 'a disposition with no timestamp is not auditable').toBeTruthy();
    expect(
      reread.reviewStatus,
      'clearing ONE adverse-media article must not move the case-level disposition — that would let a ' +
        'dismissed article clear a sanctions hit on the same screening',
    ).toBe(caseLevelBefore);

    // Reversible: an analyst who clears the wrong article must be able to put it back.
    const reopened = await amlPost(request, url, { status: 'open', reason: 'e2e: reopened' });
    expect(reopened!.status()).toBe(OK);
    const finalRes = await amlGet(request, `/v1/cases/${caseId}`);
    const final = (await finalRes!.json()) as CaseDetail;
    expect(final.matches.find(m => m.matchKey === amMatch.matchKey)!.reviewStatus).toBe('open');
  });
});
