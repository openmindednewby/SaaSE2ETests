// @aml-api tier — the ADVERSE-MEDIA baseline over HTTP (no browser). Adverse media is a COMPLIANCE
// CONTROL, not an informational panel, so these specs assert the DECISION first and the payload second.
//
// 🔴 WHY THERE IS NO "seed a GDELT hit" TEST HERE.
// `AdverseMedia:SliceTail:Enabled` is unset on every environment and the wave-3 migration is unapplied,
// so no live adverse-media rows exist anywhere and there is NO API that can seed one (audited
// 2026-09-07: IngestController exposes only GET /v1/ingest/history; DemoController only GET
// /v1/demo/config; the only writable AM surfaces are ERASURE — Application/Privacy/AdverseMediaErasure).
// A spec that drove a GDELT hit would therefore be permanently skipped, or worse, vacuously green.
// So the decision-outcome control is asserted where it is DETERMINISTIC and data-free: the effective
// decision matrix that any adverse-media factor must resolve through
// (Domain/Risk/DecisionMatrix.cs:168 — pep and adverse_media return Review across every tier).
//
// What a regression here looks like: someone re-marks adverse_media inert / maps it to Pass / drops it
// from DecisionMatrix.Categories. Every such change turns AM-E2E-2 RED.
import { expect, test } from '@playwright/test';
import {
  ADVERSE_MEDIA_CATEGORY,
  AML_API_KEY,
  AML_API_URL,
  CAPABILITY_SOURCES,
  EVIDENCE_TIERS,
  type AdverseMediaCapability,
  type DecisionMatrixCell,
  type DecisionMatrixView,
  amlGet,
  amlReachable,
  screen,
} from './aml-helpers.js';

const AUTH_REJECTED = [401, 403];
const MULTIPLICITY_COUNT = 2; // single + multiple
const EXPECTED_AM_CELLS = EVIDENCE_TIERS.length * MULTIPLICITY_COUNT;
const AM_SUBJECT = { fullName: 'Bashar al-Assad', dateOfBirth: '1965-09-11' };

interface ReasonBlock {
  code: string;
  summary: string;
  category?: string | null;
}
interface AmMatchedEntity {
  externalId: string;
  rejectionTag?: string | null;
  adverseMediaCategory?: string | null;
  headline?: string | null;
  publisher?: string | null;
}
interface AmScreeningResult {
  decision?: string | null;
  isMatch: boolean;
  matchedEntities: AmMatchedEntity[];
  adverseMediaStatus?: string | null;
  reason?: ReasonBlock | null;
  reasonCodes?: string[] | null;
}

/** Skip (never fail) when the key is rejected — the same posture as aml-screening.spec.ts. */
function skipIfUnauthorised(status: number): boolean {
  if (!AUTH_REJECTED.includes(status)) return false;
  test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
  return true;
}

const amCells = (cells: DecisionMatrixCell[]): DecisionMatrixCell[] =>
  cells.filter(c => c.category === ADVERSE_MEDIA_CATEGORY);

test.describe('AML adverse media @aml-api', () => {
  test.beforeEach(async ({ request }) => {
    if (!AML_API_KEY) test.skip(true, 'AML_API_KEY is not set — cannot authenticate.');
    if (!(await amlReachable(request))) test.skip(true, `AML API not reachable at ${AML_API_URL}.`);
  });

  // 1 — the honest availability probe. An adverse-media result that was NEVER CHECKED must never be
  // presentable as a clean one, so an unavailable capability has to say why.
  test('AM-E2E-1 screening-capabilities reports the adverse-media source honestly', async ({ request }) => {
    const res = await amlGet(request, '/v1/tenants/me/screening-capabilities');
    expect(res, 'capabilities endpoint unreachable').not.toBeNull();
    if (skipIfUnauthorised(res!.status())) return;
    expect(res!.status()).toBe(200);

    const body = (await res!.json()) as { adverseMedia: AdverseMediaCapability };
    const cap = body.adverseMedia;
    expect(cap, 'response must carry an adverseMedia capability block').toBeTruthy();
    expect(typeof cap.available).toBe('boolean');
    expect(
      CAPABILITY_SOURCES.has(cap.source),
      `capability source '${cap.source}' is outside {None, Gdelt, TenantEndpoint}`,
    ).toBeTruthy();
    if (cap.available) {
      expect(cap.source).not.toBe('None');
      // A stale reason left on an AVAILABLE stage tells the console the screen was never checked when it
      // was — the same misreporting as a silent unavailable stage, pointed the other way. Without this,
      // the available branch is one assertion thinner than the unavailable one it will replace.
      expect(
        cap.unavailableReason?.trim() ?? '',
        `adverse media is AVAILABLE (source=${cap.source}) yet still carries an unavailableReason`,
      ).toBe('');
    } else {
      expect(cap.source).toBe('None');
      expect(
        cap.unavailableReason?.trim(),
        'an UNAVAILABLE adverse-media stage must state a reason — silence would let a never-checked ' +
          'screen read as a clean one',
      ).toBeTruthy();
    }
    test.info().annotations.push({ type: 'am-capability', description: `${cap.source}/${cap.available}` });
  });

  // 2 — THE DECISION-OUTCOME CONTROL. Data-free and deterministic: every adverse-media coordinate must
  // resolve to a real decision, and none of them may be Pass. Assert the exact Review value against the
  // SYSTEM DEFAULT (shipped policy, tenant-independent) and the never-Pass invariant against the
  // EFFECTIVE matrix (which a tenant may harden to Fail, but must never soften to Pass).
  test('AM-E2E-2 an adverse-media factor can never resolve to Pass', async ({ request }) => {
    const res = await amlGet(request, '/v1/tenants/me/risk-profile/decision-matrix');
    expect(res, 'decision-matrix endpoint unreachable').not.toBeNull();
    if (skipIfUnauthorised(res!.status())) return;
    expect(res!.status()).toBe(200);

    const view = (await res!.json()) as DecisionMatrixView;
    const effective = amCells(view.effective?.cells ?? []);
    const shipped = amCells(view.systemDefault?.cells ?? []);

    expect(
      effective.length,
      'adverse_media must be a REAL category in the matrix — a zero-cell row means it was made inert',
    ).toBe(EXPECTED_AM_CELLS);
    expect(shipped.length).toBe(EXPECTED_AM_CELLS);
    for (const tier of EVIDENCE_TIERS) {
      expect(
        effective.filter(c => c.tier === tier).length,
        `adverse_media is missing evidence tier '${tier}'`,
      ).toBe(MULTIPLICITY_COUNT);
    }

    for (const cell of effective) {
      expect(
        cell.decision,
        `adverse_media/${cell.tier}/${cell.multiplicity} resolved to Pass — an adverse-media hit would ` +
          'clear silently (DecisionMatrix.cs:168)',
      ).not.toBe('Pass');
      expect(['Review', 'Fail']).toContain(cell.decision);
    }

    // Andreas 2026-08-23 Q7 supersedes DM-2: an article is an allegation, not an adjudication, so even
    // exact name + DOB routes to an analyst rather than auto-blocking.
    const shippedExact = shipped.find(
      c => c.tier === 'exact_name_exact_dob' && c.multiplicity === 'single',
    );
    expect(shippedExact, 'system default is missing adverse_media/exact_name_exact_dob/single').toBeTruthy();
    expect(
      shippedExact!.decision,
      'the SHIPPED adverse-media posture is Review on exact name + DOB (Q7, 2026-08-23)',
    ).toBe('Review');
  });

  // 3 — the payload/reason contract on a live screen. The AM leg must always report its own status, and
  // any surfaced AM match must drive the decision + reason code, never sit alongside a Pass.
  test('AM-E2E-3 a screen reports its adverse-media status and any AM match drives the decision', async ({
    request,
  }) => {
    const res = await screen(request, { ...AM_SUBJECT, adverseMedia: true, includeReasoning: true });
    expect(res, 'screening endpoint unreachable').not.toBeNull();
    if (skipIfUnauthorised(res!.status())) return;
    expect(res!.status()).toBe(201);
    const body = (await res!.json()) as AmScreeningResult;

    expect(
      body.adverseMediaStatus?.trim(),
      'a screen that ASKED for adverse media must report what the AM stage did — a null status is the ' +
        '"never checked, looks clean" failure mode (ScreeningOrchestrator.cs:497)',
    ).toBeTruthy();

    const amMatches = body.matchedEntities.filter(
      m => m.rejectionTag === ADVERSE_MEDIA_CATEGORY || !!m.adverseMediaCategory,
    );
    test.info().annotations.push({
      type: 'am-matches',
      description: `${amMatches.length} adverse-media match(es); status=${body.adverseMediaStatus}`,
    });
    if (amMatches.length === 0) {
      // 🔴 THIS SKIP IS KEYED TO AN EMPTY RESULT SET, NOT TO THE FLAG. It cannot separate "collection is
      // off" from "collection is on and the payload dropped the matches" — the second is the regression
      // this control exists to catch, and it would report SKIPPED rather than FAILED, behind the same
      // green tally. The backstop is AM-E2E-5 in aml-adverse-media-hit.spec.ts, which keys its skip on
      // the CAPABILITY and therefore FAILS when the stage is available and the corpus yields nothing.
      test.skip(
        true,
        `no adverse-media match available (status=${body.adverseMediaStatus}) — collection is off, so ` +
          'the AM-hit branch cannot be observed here. Covered structurally by AM-E2E-2, and by AM-E2E-5 ' +
          '(aml-adverse-media-hit.spec.ts) once the stage reports itself available.',
      );
      return;
    }
    expect(body.decision, 'an adverse-media match must never sit alongside a Pass').not.toBe('Pass');
    expect(
      ['Review', 'Fail'],
      `an adverse-media-driven decision must be a real adjudication (got '${body.decision}')`,
    ).toContain(body.decision);
    const codes = [...(body.reasonCodes ?? []), body.reason?.code ?? ''].join(' ');
    expect(
      codes.includes('ADVERSE_MEDIA') || body.reason?.category === ADVERSE_MEDIA_CATEGORY,
      `an adverse-media-driven decision must carry an adverse-media reason (got '${codes}')`,
    ).toBeTruthy();
  });

  // 4 — reproducibility. The same subject screened twice must reach the same decision and the same AM
  // status; a decision that wobbles is not auditable, and the regulator pack quotes it.
  test('AM-E2E-4 the adverse-media decision is reproducible across identical screens', async ({ request }) => {
    const body = { ...AM_SUBJECT, adverseMedia: true, includeReasoning: true };
    const first = await screen(request, body);
    expect(first).not.toBeNull();
    if (skipIfUnauthorised(first!.status())) return;
    expect(first!.status()).toBe(201);
    const second = await screen(request, body);
    expect(second).not.toBeNull();
    expect(second!.status()).toBe(201);

    const a = (await first!.json()) as AmScreeningResult;
    const b = (await second!.json()) as AmScreeningResult;
    // 🔴 With collection OFF this compares two EMPTY results, so today it is a weak green: two agreeing
    // nothings. The annotation records what was actually observed, so a report reader can tell an
    // agreeing pair of HITS from an agreeing pair of zeroes. The assertion strengthens on its own once
    // data flows; nothing here changes meaning when it does.
    test.info().annotations.push({
      type: 'am-reproducibility',
      description:
        `matches=${a.matchedEntities.length}/${b.matchedEntities.length} ` +
        `status=${a.adverseMediaStatus} decision=${a.decision}`,
    });
    expect(b.decision, 'two identical screens reached different decisions').toBe(a.decision);
    expect(b.adverseMediaStatus, 'the adverse-media status is not reproducible').toBe(a.adverseMediaStatus);
    expect(b.isMatch).toBe(a.isMatch);
  });
});
