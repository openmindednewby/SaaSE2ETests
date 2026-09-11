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
  amlUpload,
  amlReachable,
  screen,
} from './aml-helpers.js';

const AUTH_REJECTED = [401, 403];
const MULTIPLICITY_COUNT = 2; // single + multiple
const EXPECTED_AM_CELLS = EVIDENCE_TIERS.length * MULTIPLICITY_COUNT;
/** The 16 fields the console's generated JobListItemResponse declares; measured against the
 * served /v1/jobs payload 2026-09-11. Used by AM-E2E-9 in BOTH directions (missing AND extra). */
const JOB_ROW_FIELDS = ['completedAt', 'continuous', 'detail', 'error', 'lastSuccessAt', 'name', 'phase', 'processed', 'runningTotalEntities', 'schedule', 'stale', 'startedAt', 'state', 'success', 'total', 'updatedAt'];
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

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // AM-READY-5 §3.1 additions (A5-1, A5-4, A5-5, A5-6). 2026-09-11.
  //
  // 🔴 A5-0a — EVERY test below HAND-ASSEMBLES its HTTP request via `screen()` / `amlGet()`. It
  // therefore exercises the SERVER contract only and can NEVER observe a client-shape defect in
  // aml-v2 (a stripped Content-Type, a body that never left, a ReferenceError before the first
  // fetch). Its companion is the console-error smoke over the real UI, AM-READY-5 §3.6.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // A5-1 / gap G5 — THE assertion this whole feature rests on: the adverse-media flag must CHANGE
  // THE OUTPUT, not merely be accepted. A flag that is parsed and then dropped also returns 201, and
  // every builder/formatter test upstream of this one would still be green.
  //
  // MEASURED 2026-09-11 against https://aml-screening.dloizides.com: the two responses differ in
  // EXACTLY ONE field, `adverseMediaStatus` ("Ok" with the flag ON, "Skipped" with it OFF). Every
  // other field — decision, riskScore, reasonCodes, all 9 matchedEntities — is byte-identical once
  // the id and correlationId are stripped. That is a REAL differential (the flag reaches the stage
  // that sets the status) but a THIN one: with no adverse-media rows in the corpus it does not yet
  // move the decision. The assertion is written to hold now AND to tighten on its own once data
  // flows; the annotation records which of those two worlds the run actually observed.
  test('AM-E2E-8 the adverse-media flag CHANGES the screening output, not just the request', async ({
    request,
  }) => {
    const subject = { ...AM_SUBJECT, includeReasoning: true };
    const onRes = await screen(request, { ...subject, adverseMedia: true });
    expect(onRes, 'screening endpoint unreachable').not.toBeNull();
    if (skipIfUnauthorised(onRes!.status())) return;
    expect(onRes!.status()).toBe(201);
    const offRes = await screen(request, { ...subject, adverseMedia: false });
    expect(offRes, 'screening endpoint unreachable').not.toBeNull();
    expect(offRes!.status()).toBe(201);

    const on = (await onRes!.json()) as AmScreeningResult;
    const off = (await offRes!.json()) as AmScreeningResult;

    test.info().annotations.push({
      type: 'am-on-off-differential',
      description:
        `ON status=${on.adverseMediaStatus} decision=${on.decision} matches=${on.matchedEntities.length} | ` +
        `OFF status=${off.adverseMediaStatus} decision=${off.decision} matches=${off.matchedEntities.length}`,
    });

    // The named field that must differ. Naming it, rather than deep-diffing two blobs, is what makes
    // a regression readable: when the flag stops reaching the engine, BOTH sides read "Skipped".
    expect(
      on.adverseMediaStatus,
      'adverseMedia:true produced the same status as adverseMedia:false — the flag is not reaching ' +
        'the engine. This is gap G5: every request-shape test upstream stays green when this breaks.',
    ).not.toBe(off.adverseMediaStatus);

    // Direction, not merely difference. "Skipped" on the ON run would be a differential pointing the
    // wrong way, which a bare not-equal would happily accept.
    expect(off.adverseMediaStatus, 'adverseMedia:false must report the stage as Skipped').toBe(
      'Skipped',
    );
    expect(on.adverseMediaStatus, 'adverseMedia:true must NOT report the stage as Skipped').not.toBe(
      'Skipped',
    );

    // The stronger half, live only once the corpus carries rows for this subject. Written as a
    // conditional rather than omitted, so the day data flows this test already covers it.
    const amOn = on.matchedEntities.filter(
      m => m.rejectionTag === ADVERSE_MEDIA_CATEGORY || !!m.adverseMediaCategory,
    );
    if (amOn.length > 0) {
      const amOff = off.matchedEntities.filter(
        m => m.rejectionTag === ADVERSE_MEDIA_CATEGORY || !!m.adverseMediaCategory,
      );
      expect(
        amOff.length,
        'adverseMedia:false returned adverse-media matches — the flag does not gate the stage',
      ).toBe(0);
    }
  });

  // A5-4 — the SERVED /v1/jobs contract, not a fixture. The jobs UI asserts against fixtures today;
  // nothing had ever seen a served payload. This pins the keyset the console's generated
  // JobListItemResponse (apps/aml-v2/src/api/generated/jobs/models/jobListItemResponse.ts) assumes.
  // MEASURED 2026-09-11: the served rows carry exactly these 16 fields and no others.
  test('AM-E2E-9 the served /v1/jobs payload matches the fields the console generates against', async ({
    request,
  }) => {
    const res = await amlGet(request, '/v1/jobs');
    expect(res, '/v1/jobs unreachable').not.toBeNull();
    if (skipIfUnauthorised(res!.status())) return;
    expect(res!.status()).toBe(200);
    const rows = (await res!.json()) as Record<string, unknown>[];
    expect(Array.isArray(rows), '/v1/jobs must serve an array').toBeTruthy();
    expect(
      rows.length,
      '/v1/jobs served no rows — a contract cannot be pinned against an empty feed',
    ).toBeGreaterThan(0);

    for (const row of rows) {
      for (const field of JOB_ROW_FIELDS) {
        expect(
          Object.prototype.hasOwnProperty.call(row, field),
          `served job row '${String(row.name)}' is missing '${field}', which the console's ` +
            'JobListItemResponse declares — the UI would render undefined',
        ).toBeTruthy();
      }
      // The reverse direction: a field the server invented that the console does not know about.
      const unknown = Object.keys(row).filter(k => !JOB_ROW_FIELDS.includes(k));
      expect(
        unknown,
        `served job row '${String(row.name)}' carries field(s) the console's model does not declare`,
      ).toEqual([]);
    }

    // F7 — "3840 of 0" is worse than an absent denominator. A row reporting progress must not report
    // a zero total alongside a non-zero processed count.
    for (const row of rows) {
      const processed = row.processed as number | null;
      const total = row.total as number | null;
      if (typeof processed === 'number' && processed > 0) {
        expect(
          total === null || (typeof total === 'number' && total > 0),
          `job '${String(row.name)}' reports ${processed} of ${String(total)} — a zero denominator ` +
            'renders as "N of 0" (F7). Null is honest; zero is not.',
        ).toBeTruthy();
      }
    }
  });

  // A5-5 / A5-6 — the adverse-media MENTIONS index, by name and by date range.
  //
  // 🔴 EXPECTED RED UNTIL DEPLOYED. Measured 2026-09-11: GET /v1/adverse-media/mentions returns 404
  // on the live staging image. The endpoint exists in source but is NOT in the deployed build
  // (AM-READY-8 owns shipping). These carry test.fail() so the suite TALLY stays honest while the
  // endpoint is missing, AND so they flip to a reported failure the moment it deploys and starts
  // passing — which is precisely the signal that this marker should be removed.
  //
  // 🔴 A5-23: test.fail() prints a ✘ glyph while the test PASSES. Do not read that ✘ as a failure;
  // only the pass/fail TALLY and the exit code count.
  test.describe('adverse-media mentions index', () => {
    test.fail(
      true,
      'GET /v1/adverse-media/mentions is 404 on the deployed image (measured 2026-09-11)',
    );

    test('AM-E2E-10 mentions search by name returns rows for a known name and empty for an unknown one', async ({
      request,
    }) => {
      const known = await amlGet(request, '/v1/adverse-media/mentions?name=Ivan%20Petrov');
      expect(known, 'mentions endpoint unreachable').not.toBeNull();
      if (skipIfUnauthorised(known!.status())) return;
      expect(known!.status(), 'mentions-by-name must not 404').toBe(200);

      // An unknown name is an EMPTY RESULT, not an error. A 404/500 here makes the console show a
      // failure where the honest answer is "nothing matched".
      const unknown = await amlGet(
        request,
        '/v1/adverse-media/mentions?name=Zzzqqx%20Nonexistentsubject',
      );
      expect(
        unknown!.status(),
        'an unknown name must return 200 with an empty set, not an error',
      ).toBe(200);
      const unknownBody = (await unknown!.json()) as { items?: unknown[] };
      const items = Array.isArray(unknownBody) ? unknownBody : (unknownBody.items ?? []);
      expect(items, 'an unknown name must return zero rows').toEqual([]);
    });

    test('AM-E2E-11 mentions search by date range returns only rows inside the range (inclusive bounds)', async ({
      request,
    }) => {
      const from = '2024-01-01';
      const to = '2024-01-31';
      const res = await amlGet(request, `/v1/adverse-media/mentions?from=${from}&to=${to}`);
      expect(res, 'mentions endpoint unreachable').not.toBeNull();
      if (skipIfUnauthorised(res!.status())) return;
      expect(res!.status(), 'mentions-by-date-range must not 404').toBe(200);
      const body = (await res!.json()) as { items?: { capturedAt?: string }[] };
      const rows = Array.isArray(body) ? body : (body.items ?? []);
      // Bounds are asserted INCLUSIVE on both ends. If the server is exclusive this goes red and the
      // contract gets stated rather than assumed.
      const lower = Date.parse(`${from}T00:00:00Z`);
      const upper = Date.parse(`${to}T23:59:59.999Z`);
      const outside = rows.filter(r => {
        const t = Date.parse(String(r.capturedAt));
        return Number.isNaN(t) || t < lower || t > upper;
      });
      expect(
        outside.map(r => r.capturedAt),
        'the date-range filter returned rows outside the requested bounds',
      ).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // AM-READY-5 §3.1 A5-2 — BATCH multipart. 2026-09-11.
  //
  // 🔴 WHICH OF THE TWO THIS COVERS: the SERVER. This test hand-assembles its own multipart body
  // (`amlUpload`, aml-helpers.ts). `apps/aml-v2/src/api/client.ts:345-352` assembles a DIFFERENT one
  // — its own FormData with `file` plus a String()'d `adverseMedia` form field. Nothing here can
  // observe a defect in THAT shape: if the client stopped appending the flag, or sent it as a JSON
  // blob instead of a form field, every assertion below would stay green. Pinning client.ts:345-352
  // is a unit-level job inside apps/aml-v2 and is logged in AM-READY-5 §6 for the frontend agent; it
  // is deliberately NOT faked here.
  //
  // What this DOES cover, and what nothing covered before: that the endpoint accepts a multipart
  // upload, returns per-row results for EVERY submitted row (not just the first), and that the
  // job-level `adverseMedia` form field reaches EVERY row rather than row 0 only.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  const BATCH_SUBJECTS = ['Bashar al-Assad', 'Ada Quorine Zxqv', 'Brannoch Velgrim Zxqv'];
  const BATCH_CSV = `fullName\r\n${BATCH_SUBJECTS.join('\r\n')}\r\n`;
  const BATCH_POLL_MS = 3_000;
  const BATCH_POLL_ATTEMPTS = 40; // 40 x 3s = 120s ceiling; the test's own timeout is 300s
  const TERMINAL_STATES = new Set(['Completed', 'Failed', 'Cancelled', 'completed', 'failed', 'cancelled']);

  interface BatchRow {
    rowIndex?: number;
    fullName?: string;
    error?: string | null;
    adverseMediaStatus?: string | null;
    [key: string]: unknown;
  }

  /** Upload the fixed 3-row CSV with the job-level adverseMedia flag, poll to terminal, return rows. */
  async function runBatch(
    request: Parameters<typeof amlUpload>[0],
    adverseMedia: boolean,
  ): Promise<{ rows: BatchRow[]; state: string } | null> {
    const upload = await amlUpload(request, '/v1/screenings/batch', {
      file: { name: 'am-batch.csv', mimeType: 'text/csv', buffer: Buffer.from(BATCH_CSV, 'utf8') },
      adverseMedia: String(adverseMedia),
    });
    expect(upload, 'batch upload endpoint unreachable').not.toBeNull();
    if (AUTH_REJECTED.includes(upload!.status())) return null;
    expect(upload!.status(), `POST /v1/screenings/batch adverseMedia=${adverseMedia}`).toBe(202);
    const created = (await upload!.json()) as { jobId?: string; id?: string };
    const jobId = created.jobId ?? created.id;
    expect(jobId, 'batch upload returned no job id').toBeTruthy();

    let state = '';
    for (let attempt = 0; attempt < BATCH_POLL_ATTEMPTS; attempt++) {
      const statusRes = await amlGet(request, `/v1/screenings/batch/${jobId}`);
      expect(statusRes, 'batch status endpoint unreachable').not.toBeNull();
      expect(statusRes!.status()).toBe(200);
      const status = (await statusRes!.json()) as { state?: string; status?: string };
      state = status.state ?? status.status ?? '';
      if (TERMINAL_STATES.has(state)) break;
      await new Promise(resolve => setTimeout(resolve, BATCH_POLL_MS));
    }
    expect(TERMINAL_STATES.has(state), `batch job never reached a terminal state (last: "${state}")`).toBe(true);

    const resultsRes = await amlGet(request, `/v1/screenings/batch/${jobId}/results?format=json`);
    expect(resultsRes, 'batch results endpoint unreachable').not.toBeNull();
    expect(resultsRes!.status()).toBe(200);
    const body = (await resultsRes!.json()) as { rows?: BatchRow[]; results?: BatchRow[] };
    const rows = body.rows ?? body.results ?? [];
    return { rows, state };
  }

  test('AM-E2E-12 a batch upload returns a per-row result for EVERY submitted row', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const run = await runBatch(request, true);
    if (run === null) {
      test.skip(true, 'AML_API_KEY not accepted for batch (AM-READY-5 §5, F6) — not a product verdict');
      return;
    }
    // The defect this catches: a batch that screens row 0 and silently drops the rest still returns
    // 202 and a "Completed" job. Row COUNT, and the name set, are the assertion.
    expect(run.rows.length, `expected ${BATCH_SUBJECTS.length} per-row results, got ${run.rows.length}`).toBe(
      BATCH_SUBJECTS.length,
    );
    const names = run.rows.map(row => (row.fullName ?? '').trim()).sort();
    expect(names).toEqual([...BATCH_SUBJECTS].sort());
    for (const row of run.rows) expect(row.error ?? null, `row "${row.fullName}" carried an error`).toBeNull();
  });

  test('AM-E2E-13 the batch adverseMedia form field reaches EVERY row, not only the first', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const on = await runBatch(request, true);
    if (on === null) {
      test.skip(true, 'AML_API_KEY not accepted for batch (AM-READY-5 §5, F6) — not a product verdict');
      return;
    }
    // A5-25: the claim is per-ROW application, so it is asserted over EVERY row, never over row 0.
    // If the per-row payload carries no adverse-media observable at all, that is itself the finding —
    // the flag's per-row application would be unobservable through the API — so the failure message
    // prints the actual row keys rather than asserting something adjacent.
    const observable = run0Keys(on.rows);
    expect(
      observable,
      `no per-row adverse-media observable in the batch results payload; row keys were: ${JSON.stringify(
        Object.keys(on.rows[0] ?? {}),
      )}`,
    ).not.toBeNull();
    for (const row of on.rows) {
      expect(
        String(row[observable!] ?? ''),
        `row "${row.fullName}" did not carry the adverse-media flag's effect`,
      ).not.toBe('Skipped');
    }

    const off = await runBatch(request, false);
    expect(off, 'batch upload endpoint unreachable on the OFF run').not.toBeNull();
    for (const row of off!.rows) {
      expect(
        String(row[observable!] ?? ''),
        `row "${row.fullName}" ran adverse media with the flag OFF`,
      ).toBe('Skipped');
    }
  });

  /** The first per-row key that observes adverse media, or null when the payload carries none. */
  function run0Keys(rows: BatchRow[]): string | null {
    const candidates = ['adverseMediaStatus', 'adverseMedia'];
    const keys = Object.keys(rows[0] ?? {});
    return candidates.find(candidate => keys.includes(candidate)) ?? null;
  }
});
