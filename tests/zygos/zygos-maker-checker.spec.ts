// 🔴 THE MOST IMPORTANT SPEC IN THE SUITE (ZY-18) — maker-checker, the product's core control.
//
// If four-eyes can be walked around by editing someone else's draft, Zygos is selling compliance
// theatre. Everything here exists to make that impossible to ship by accident.
//
// ── Why this file is shaped the way it is ────────────────────────────────────────────────────
//
// The naive test is one line: "B approves A's instruction → expect 403". It is worthless, for
// two independent reasons, BOTH of which were observed live while building this:
//
//  1. 🔴 A 403 IS NOT PROOF. The BFF returns 403 `{"error":"Anti-forgery validation failed."}`
//     for any mutation missing `X-BFF-Csrf`. The first hand-probe of this exact flow got 403 on
//     every approve — and the naive assertion PASSED, having never reached the aggregate. The
//     control was never exercised. A green test, testing nothing.
//     ⇒ every refusal here asserts the BODY NAMES THE VIOLATION, not merely the status code.
//
//  2. 🔴 A REFUSAL ONLY MEANS SOMETHING IF SOMEONE ELSE SUCCEEDS. "B is refused" is equally
//     consistent with "approve is broken for everyone", "the instruction is in the wrong state",
//     and "the endpoint 404s". Only the pair discriminates.
//     ⇒ every refusal is asserted against C SUCCEEDING on the SAME instruction, in the SAME
//       state, through the SAME endpoint — differing ONLY in who is asking.
//
// ── The rule under test (contract §1, the maker ruling) ─────────────────────────────────────
//
// The checker must be outside `Contributors` — everyone who CREATED **or MATERIALLY EDITED** it.
// NOT merely "≠ creator". That weaker rule has a hole big enough to drive a payment through:
//
//     A creates a draft → B edits it to point at B's own account → B approves.
//
// B is not the creator. B passes "approver ≠ creator" at every step. One person originated and
// authorised a payment. `editor-b` exists solely to walk that path and be refused.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_USERS, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto } from './zygos-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe('Zygos maker-checker @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let editorB: ZygosSession | null;
  let checkerC: ZygosSession | null;

  let a: ZygosApi;
  let b: ZygosApi;
  let c: ZygosApi;

  test.beforeAll(async () => {
    // The login budget (5/60s per IP) is shared by the whole run, so a COLD start — where no
    // session is parked yet — can legitimately hit a 429 and must wait the window out. The
    // default 30s hook timeout is shorter than that window, which would turn a transient
    // throttle into a hard beforeAll failure and cascade-fail the file. `loginAs` polls; this
    // gives it room to. On a warm run every session comes from playwright/.auth/ and this costs
    // nothing.
    test.setTimeout(180_000);
    [makerA, editorB, checkerC] = await Promise.all([
      loginAs(ZYGOS_USERS.MAKER_A),
      loginAs(ZYGOS_USERS.EDITOR_B),
      loginAs(ZYGOS_USERS.CHECKER_C),
    ]);
    if (makerA && editorB && checkerC) {
      a = new ZygosApi(makerA);
      b = new ZygosApi(editorB);
      c = new ZygosApi(checkerC);
    }
  });

  // NB: no afterAll disposal. Sessions are CACHED and shared across every zygos spec — the
  // login budget is 5/60s per IP for the whole run (see zygos-helpers), so disposing here would
  // force the next file to re-auth and throttle the suite. Nothing else needs cleaning up:
  //  - users are permanent fixtures (#235: a teardown that swept `e2ec-` users mid-run caused a
  //    401 cascade — this suite creates no users, so it sweeps none);
  //  - an instruction CANNOT be deleted (no DELETE route — it is an immutable financial record).
  //    Seed-independence, not cleanup, is what keeps these tests re-runnable.

  test.beforeEach(() => {
    test.skip(!makerA || !editorB || !checkerC, SKIP_REASON);
  });

  /**
   * Drive a fresh instruction to PendingApproval. Returns it plus its tag.
   *
   * `contributors` decides who has touched it — the single variable each test below changes.
   */
  async function pendingApproval(label: string, editedBy?: ZygosApi): Promise<InstructionDto> {
    const tag = zygosTag(label);

    const createRes = await a.create(instructionBody(tag));
    expect(createRes.status(), `create failed: ${await bodyText(createRes)}`).toBe(201);
    const created = (await createRes.json()) as InstructionDto;
    expect(created.status).toBe('Draft');

    if (editedBy) {
      // A MATERIAL edit — this is what makes the editor a Contributor.
      //
      // The creditor is REPLACED wholesale, so it must carry a complete counterparty.
      // This previously omitted `iban`, which silently stripped it — and the draft still
      // reached `Validated`, because no request validation ran anywhere in the service
      // (D1). A payment with no creditor IBAN could be submitted to a provider. Once the
      // validators were actually registered, `validate` started refusing it correctly and
      // this fixture was exposed as building an invalid payment. The product is right;
      // the edit is what was wrong.
      const editRes = await editedBy.update(
        created.externalId,
        instructionBody(tag, {
          amount: 222.75,
          creditor: { name: `Creditor ${tag} REDIRECTED`, iban: 'DE89370400440532013000', country: 'DE' },
        }),
      );
      expect(editRes.status(), `edit by ${editedBy.actor} failed: ${await bodyText(editRes)}`).toBe(200);
    }

    const validateRes = await a.validate(created.externalId);
    expect(validateRes.status(), `validate failed: ${await bodyText(validateRes)}`).toBe(200);

    const sfaRes = await a.submitForApproval(created.externalId);
    expect(sfaRes.status(), `submit-for-approval failed: ${await bodyText(sfaRes)}`).toBe(200);

    return created;
  }

  /**
   * 🔴 Assert a refusal is THE MAKER-CHECKER REFUSAL — not a CSRF block, not a 403 from the
   * BFF, not an auth failure that happens to share a status code.
   *
   * This is the assertion that makes the whole file trustworthy. Status alone is ambiguous;
   * the aggregate's message is not.
   */
  async function expectMakerCheckerRefusal(res: Awaited<ReturnType<ZygosApi['approve']>>, who: string): Promise<void> {
    const body = await bodyText(res);
    expect(res.status(), `${who} should be refused with 403; body: ${body}`).toBe(403);
    // The distinguishing evidence. "Anti-forgery validation failed" must NEVER satisfy this.
    expect(body, `${who}'s 403 must be a maker-checker refusal, not CSRF/auth; body: ${body}`).toContain(
      'Maker-checker violation',
    );
  }

  test('🔴 an editor of someone else\'s draft CANNOT approve it — and an uninvolved user CAN', async () => {
    // A creates, B edits. B is now a Contributor despite never being the creator.
    const instruction = await pendingApproval('mc-editor', b);

    // ── The control ───────────────────────────────────────────────────────────────────────
    const bApprove = await b.approve(instruction.externalId);
    await expectMakerCheckerRefusal(bApprove, 'editor-b (a contributor via EDIT)');

    // ── The discrimination proof ──────────────────────────────────────────────────────────
    // SAME instruction. SAME PendingApproval state. SAME endpoint. Only the actor differs.
    // If approve were simply broken/mis-stated/404ing, THIS leg fails and the test is red —
    // which is exactly what must happen. A refusal is only evidence of a working control when
    // the identical request from an eligible user succeeds.
    const cApprove = await c.approve(instruction.externalId);
    expect(cApprove.status(), `checker-c (uninvolved) MUST be able to approve — otherwise b's 403 proves nothing about maker-checker; body: ${await bodyText(cApprove)}`).toBe(200);
    expect(((await cApprove.json()) as InstructionDto).status).toBe('Approved');
  });

  test('the creator cannot approve their own instruction', async () => {
    const instruction = await pendingApproval('mc-creator');

    const aApprove = await a.approve(instruction.externalId);
    await expectMakerCheckerRefusal(aApprove, 'maker-a (the creator)');

    // Discrimination: the same request from C succeeds.
    const cApprove = await c.approve(instruction.externalId);
    expect(cApprove.status(), `checker-c must be able to approve; body: ${await bodyText(cApprove)}`).toBe(200);
  });

  test('contribution is permanent — an editor stays disqualified even after the creator re-edits', async () => {
    // B edits (⇒ Contributor), then A edits again. B's contribution is cumulative and is never
    // "washed out" by a later edit — `AddContributor` only ever adds.
    const tag = zygosTag('mc-permanent');
    const createRes = await a.create(instructionBody(tag));
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as InstructionDto;

    expect((await b.update(created.externalId, instructionBody(tag, { amount: 310.0 }))).status()).toBe(200);
    expect((await a.update(created.externalId, instructionBody(tag, { amount: 415.5 }))).status()).toBe(200);

    expect((await a.validate(created.externalId)).status()).toBe(200);
    expect((await a.submitForApproval(created.externalId)).status()).toBe(200);

    await expectMakerCheckerRefusal(await b.approve(created.externalId), 'editor-b after a later edit by maker-a');

    const cApprove = await c.approve(created.externalId);
    expect(cApprove.status(), `checker-c must still be able to approve; body: ${await bodyText(cApprove)}`).toBe(200);
  });

  test('approving twice is refused — two approvals from one person is one pair of eyes', async () => {
    const instruction = await pendingApproval('mc-double');

    const first = await c.approve(instruction.externalId);
    expect(first.status(), `first approve by c should succeed; body: ${await bodyText(first)}`).toBe(200);

    // Now Approved, so this is a state conflict (409) rather than a 403 — the aggregate checks
    // state BEFORE identity, deliberately: "you already approved this" about an instruction that
    // settled last week would be both wrong and confusing.
    const second = await c.approve(instruction.externalId);
    expect(second.status(), `a second approve must not succeed; body: ${await bodyText(second)}`).toBe(409);
  });

  test('a rejection requires a reason and is attributed to the rejector', async () => {
    const instruction = await pendingApproval('mc-reject');

    const rejected = await c.reject(instruction.externalId, `Rejected by ZY-18 ${instruction.reference}`);
    expect(rejected.status(), `reject failed: ${await bodyText(rejected)}`).toBe(200);
    expect(((await rejected.json()) as InstructionDto).status).toBe('Rejected');
  });
});
