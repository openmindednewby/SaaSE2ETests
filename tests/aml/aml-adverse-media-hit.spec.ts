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
// AM-E2E-6 / 6B (the per-tenant adverse-media surface gate, D-MODB-AM-13) live in
// aml-adverse-media-surface.spec.ts; the shared helpers in am-hit-helpers.ts.
import { expect, test } from '@playwright/test';
import { probeAmNameBook, ruleOnAmCorpus } from './am-name-book-probe.js';
import {
  AUTH_REJECTED,
  CREATED,
  OK,
  POSITIVE_CORPUS,
  amOf,
  isAm,
  requireAvailableStage,
  type AmScreen,
  type CaseDetail,
} from './am-hit-helpers.js';
import { AML_API_KEY, AML_API_URL, amlGet, amlPost, amlReachable, screen } from './aml-helpers.js';

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
