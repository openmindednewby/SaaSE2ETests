// @aml-api tier — GAP 1 (c): the adverse-media CATEGORY is a compliance-facing label that reaches the
// tenant's warning-type policy and the regulator pack, so the set of values on the wire must be closed
// and must include `GeneralCrime` (AM-3 / decision D13: a catch-all GDELT theme — an arrest, a robbery,
// a seizure — is no longer stamped `FinancialCrime`).
//
// 🔴 WHAT THIS CANNOT SEE. E2E here is API-DRIVEN by owner decision: it drives the AML API, never the
// UI, so it structurally cannot observe a client-side defect — a portal that renders `GeneralCrime` as
// blank, or crashes on an unknown category, passes this file. It also cannot adjudicate PRECISION: it
// asserts the label is well-formed, never that the label is TRUE of the article.
import { expect, test } from '@playwright/test';
import { AML_API_KEY, AML_API_URL, amlReachable, screen, type ScreeningResult } from './aml-helpers.js';

const AUTH_REJECTED = [401, 403];

// AdverseMediaCategory (AMLService/Domain/Screening/AdverseMediaCategory.cs). Appended, never
// renumbered — and serialized by NAME, so this is the wire contract, not an ordinal.
const ADVERSE_MEDIA_CATEGORIES = new Set([
  'Unknown',
  'FinancialCrime',
  'Cybercrime',
  'Regulatory',
  'HighRisk',
  'GeneralCrime',
]);

// Subjects with well-documented public adverse media, mirroring the golden corpus `positives` bucket.
const SUBJECTS = ['Jho Low', 'Gulnara Karimova'];

test.describe('AML adverse-media category @aml-api', () => {
  test.beforeEach(async ({ request }) => {
    if (!AML_API_KEY) test.skip(true, 'AML_API_KEY is not set — cannot authenticate screenings.');
    if (!(await amlReachable(request))) test.skip(true, `AML API not reachable at ${AML_API_URL}.`);
  });

  for (const fullName of SUBJECTS) {
    test(`adverseMediaCategory stays inside the declared taxonomy — ${fullName}`, async ({ request }) => {
      const res = await screen(request, { fullName });
      if (!res || AUTH_REJECTED.includes(res.status())) {
        test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
        return;
      }
      expect(res.status()).toBe(201);
      const body = (await res.json()) as ScreeningResult;

      let seen = 0;
      for (const entity of body.matchedEntities) {
        const category = (entity as unknown as Record<string, unknown>).adverseMediaCategory;
        if (category === null || category === undefined) continue;
        seen += 1;
        expect(
          ADVERSE_MEDIA_CATEGORIES.has(String(category)),
          `'${fullName}' returned adverseMediaCategory '${String(category)}', outside the declared set ` +
            `(${[...ADVERSE_MEDIA_CATEGORIES].join(' / ')}). A category the tenant policy has no key for ` +
            `silently drops the warning.`,
        ).toBeTruthy();
      }

      // 🔴 NOT an assertion that hits exist: adverse media is a live upstream (GDELT) and a zero-hit
      // screen is a legitimate outcome. This annotation is what stops a green run being read as
      // "the taxonomy was exercised" when nothing carried a category at all.
      test.info().annotations.push({ type: 'categories-observed', description: `${seen}` });
    });
  }
});
