// @aml-api tier — the per-tenant adverse-media SURFACE gate on the screening response.
// 🔴 D-MODB-AM-18 "Article links always travel with adverse-media matches" (owner, 2026-09-22, shipped as
// AM-LINKS-1 "Article links always on", AMLService `623c2240`) supersedes the link-hiding of D-MODB-AM-13
// "AM-E2E-6 screens as the surface-ON tenant, and the gate OMITS externalId". Every adverse-media match that
// is returned now carries its article link (`sourceUrl` + a URL `externalId`) regardless of
// `AdverseMedia:Surface:Enabled`; the surface switch no longer hides anything on the wire.
//
// 🔴 D-MODB-AM-15 "Adverse media fully OFF by default, with a per-tenant MASTER switch for development" (owner,
// 2026-09-21) is UNCHANGED and is what splits the two tests. Staging runs `AdverseMedia__Enabled=false` with the
// master ON only for tenant MODB_SURFACE_ON_TENANT_ID. So AM-E2E-6 screens as that tenant (the D-MODB-AM-9
// pattern, modb-mock-source-links.spec.ts AC-MOCK-6), because it is the only tenant that receives adverse media
// at all, and asserts every adverse-media match carries its article URL. AM-E2E-6B screens the SAME subject as
// the default tenant (AML_API_KEY) and asserts NO adverse media comes back (no match, no ADVERSE_MEDIA reason,
// no sourceUrl, no "stage ran" status), so the absence is observed on a subject that HAS adverse media, while
// the watchlist matches keep their externalId.
//
// Needs an AVAILABLE adverse-media stage (requireAvailableStage) and a corpus subject with a hit; see
// aml-adverse-media-hit.spec.ts for why the corpus is what it is and for AM-E2E-5, the control that
// turns a corpus-wide zero red.
import { expect, test } from '@playwright/test';
import {
  ADVERSE_MEDIA_CATEGORIES,
  AM_E2E_6_TIMEOUT_MS,
  HTTP_URL,
  CREATED,
  SURFACE_ON_TENANT_ID,
  expectAdverseMediaAbsent,
  firstCorpusHit,
  isAm,
  requireAvailableStage,
  skipNoCorpusHit,
  surfaceOnKeyOrSkip,
  type AmScreen,
} from './am-hit-helpers.js';
import { ADVERSE_MEDIA_CATEGORY, AML_API_KEY, AML_API_URL, amlReachable, screen } from './aml-helpers.js';

test.describe('AML adverse media — per-tenant surface gate @aml-api', () => {
  test.beforeEach(async ({ request }) => {
    // Budget, not flake: this screens the WHOLE positive corpus sequentially, and each screen()
    // is allowed 25s by aml-helpers. Under the 30s default the test times out whenever more than
    // one subject is slow (observed 2026-09-11: timeout at 30.0s, then a clean pass). Raising the
    // cap fixes the measurement window; it does not weaken an assertion.
    test.setTimeout(180_000);
    if (!AML_API_KEY) test.skip(true, 'AML_API_KEY is not set — cannot authenticate.');
    if (!(await amlReachable(request))) test.skip(true, `AML API not reachable at ${AML_API_URL}.`);
  });

  // 6 — the decision + reason + presentable-evidence contract ON A REAL HIT. AM-E2E-3 asserts only
  // `decision !== 'Pass'`; the shipped posture (Q7, 2026-08-23) is REVIEW, and a Fail would satisfy
  // `!== 'Pass'` while contradicting that posture. Assert the value, not the negation.
  // D-MODB-AM-13: screened as the surface-ON tenant, the only tenant for which externalId is the article URL.
  test('AM-E2E-6 as the surface-ON tenant, a real adverse-media hit resolves to Review and carries a usable reason + evidence', async ({
    request,
  }) => {
    test.setTimeout(AM_E2E_6_TIMEOUT_MS);
    const onKey = surfaceOnKeyOrSkip();
    if (!(await requireAvailableStage(request, onKey))) return;

    const found = await firstCorpusHit(request, onKey, `surface-ON tenant ${SURFACE_ON_TENANT_ID}`);
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

  // 6B — D-MODB-AM-15: the default tenant has adverse media fully OFF. The control screen (surface-ON tenant)
  // proves the subject HAS adverse media; the same subject screened as the default tenant must then carry no
  // adverse-media match, no ADVERSE_MEDIA reason, no sourceUrl and no "stage ran" status, while its watchlist
  // matches are untouched and keep their externalId.
  test('AM-E2E-6B as the default tenant (adverse media OFF, D-MODB-AM-15), a subject with adverse media returns none and watchlist matches keep externalId', async ({
    request,
  }) => {
    test.setTimeout(AM_E2E_6_TIMEOUT_MS);
    const onKey = surfaceOnKeyOrSkip();
    if (!(await requireAvailableStage(request, onKey))) return;

    const control = await firstCorpusHit(request, onKey, `surface-ON tenant ${SURFACE_ON_TENANT_ID}`);
    if (!control) {
      skipNoCorpusHit('am-e2e-6b');
      return;
    }
    const res = await screen(request, { fullName: control.fullName, adverseMedia: true, includeReasoning: true });
    expect(res, 'screening endpoint unreachable').not.toBeNull();
    expect(res!.status(), `default-tenant screen of '${control.fullName}'`).toBe(CREATED);
    const body = (await res!.json()) as AmScreen;
    test.info().annotations.push({
      type: 'am-subject',
      description: `${control.fullName}: surface-ON tenant ${control.hits.length} hits; default tenant status=${body.adverseMediaStatus}`,
    });

    expectAdverseMediaAbsent(body, `default tenant screening '${control.fullName}'`);

    const watchlist = body.matchedEntities.filter((match) => !isAm(match));
    expect(
      watchlist.length,
      `screening '${control.fullName}' returned no watchlist match, so "no adverse media" and "watchlist keeps externalId" are unobserved`,
    ).toBeGreaterThanOrEqual(1);
    for (const [index, match] of watchlist.entries()) {
      expect(
        (match.externalId ?? '').trim(),
        `watchlist match ${index} lost its externalId: turning adverse media off must touch adverse media only`,
      ).toBeTruthy();
    }
  });
});
