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
// defect ships behind the same green line as today. AM-E2E-5 below is the control that turns (c) RED:
// it skips on the CAPABILITY being unavailable, never on an empty result, so once the stage reports
// itself available a corpus-wide zero is a FAILURE and not a skip.
//
// 🔴 WHAT THIS STILL CANNOT SEE. API-driven by owner decision: it drives the AML API, never the aml-v2
// UI, so a portal that renders an adverse-media hit blank still passes here. It also cannot adjudicate
// PRECISION — whether the article is genuinely about this subject.
import { expect, test } from '@playwright/test';
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

// The golden-corpus `positives` bucket — the same subjects aml-adverse-media-category.spec.ts screens.
// When the stage is AVAILABLE and returns nothing for ALL of these, the collection leg is broken.
const POSITIVE_CORPUS = ['Jho Low', 'Gulnara Karimova', 'Bashar al-Assad'];

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

    expect(
      total,
      'the adverse-media stage reports itself AVAILABLE, yet not one of the golden-corpus positives ' +
        `(${POSITIVE_CORPUS.join(', ')}) carried an adverse-media match. Collection is on and nothing ` +
        'reaches the screening payload — the leg is broken, or matches are stripped before the wire.',
    ).toBeGreaterThan(0);
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
      test.skip(
        true,
        'the stage is available but no corpus subject carried an adverse-media match — AM-E2E-5 is the ' +
          'control that FAILS on this, so it is not being swallowed here.',
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
    expect(
      `${hit.headline ?? ''}${hit.publisher ?? ''}`.trim(),
      'an adverse-media match with neither headline nor publisher is not reviewable evidence — the ' +
        'analyst is asked to judge an article they cannot see',
    ).toBeTruthy();
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
      test.skip(
        true,
        'the case carries no adverse-media match — AM-E2E-5 is the control that FAILS when the stage is ' +
          'available and nothing surfaces. Note the case read model exposes rejectionTag but NOT ' +
          'adverseMediaCategory (Application/Cases/CaseDtos.cs:102).',
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
