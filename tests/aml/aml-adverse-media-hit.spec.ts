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
  test('AM-E2E-6 a real adverse-media hit resolves to Review and carries a usable reason + evidence', async ({
    request,
  }) => {
    if (!(await requireAvailableStage(request))) return;

    let hit: AmMatch | null = null;
    let body: AmScreen | null = null;
    for (const fullName of POSITIVE_CORPUS) {
      const res = await screen(request, { fullName, adverseMedia: true, includeReasoning: true });
      if (!res || AUTH_REJECTED.includes(res.status())) {
        test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
        return;
      }
      expect(res.status()).toBe(CREATED);
      const parsed = (await res.json()) as AmScreen;
      const matches = amOf(parsed);
      if (matches.length > 0) {
        [hit] = matches;
        body = parsed;
        break;
      }
    }
    if (!hit || !body) {
      test.info().annotations.push({
        type: 'am-e2e-6-never-executed',
        description:
          'ZERO assertions have ever run in AM-E2E-6. Its Review-decision, reason-code, taxonomy and ' +
          'headline/publisher expectations below are INFERRED from the TS interface and have never ' +
          'been observed on a live payload. Three skips are three unverified contracts, not passes.',
      });
      test.skip(
        true,
        'the stage is available but no corpus subject carried an adverse-media match. AM-E2E-5 is the ' +
          'control for this: it FAILS when a corpus subject is provably in the indexed name book and ' +
          'slices were scanned against it, and reports its own no-input outcome otherwise — read its ' +
          'am-name-book annotation to see which of the two happened on this run.',
      );
      return;
    }

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
    // 🔴 REWRITTEN 2026-09-08 against a REAL payload — the first one this assertion has ever seen.
    // The old form was `headline + publisher` truthy, and both names were INFERRED from the TS
    // interface. Measured on the live wire: both fields exist verbatim (the API maps DB `title` →
    // `headline` and `domain` → `publisher`), `publisher` is populated, and `headline` is NULL on
    // every row — the `gkg:v1minimal:themegated:v1` parse profile captures no article title. The old
    // form would therefore have gone GREEN on `publisher` alone while the headline half was never
    // once satisfied: a passing assertion that silently covered nothing.
    //
    // So assert the fields that ARE meaningful, each on its own so a regression names itself, and
    // record the headline gap as a KNOWN PRODUCT LIMITATION instead of dropping it. Do NOT convert
    // this into `expect(hit.headline).toBeNull()` — that would PIN the defect and turn fixing the
    // parse profile into a test failure.
    expect(
      (hit.publisher ?? '').trim(),
      'an adverse-media match with no publisher is not reviewable evidence — the analyst is asked to ' +
        'judge an article they cannot attribute to any outlet',
    ).toBeTruthy();
    expect(
      (hit.externalId ?? '').trim(),
      'for an adverse-media hit externalId IS the article URL (AdverseMediaArticle.cs:14). With the ' +
        'headline empty it is the only way an analyst can reach the article at all',
    ).toMatch(/^https?:\/\//);
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
