// 🔴 THE BATCH FOUR-EYES SPEC (FINREG P-04) — the batch-level twin of `zygos-maker-checker.spec.ts`.
//
// A batch carries ONE central approval that authorises every instruction in it at once. If the
// person who assembled the batch (or contributed to any instruction in it) can also approve it,
// four-eyes is bypassed wholesale — worse than at the instruction level, because one signature now
// covers many payments. This spec proves the control holds at the batch layer.
//
// The two rules from the instruction spec apply here unchanged:
//   1. 🔴 A 403 IS NOT PROOF — the BFF returns 403 for a missing CSRF header too. So the refusal
//      asserts the BODY names the violation ("Maker-checker violation"), never the status alone.
//   2. 🔴 A REFUSAL ONLY MEANS SOMETHING IF SOMEONE ELSE SUCCEEDS — the same batch, same state, same
//      endpoint, approved by an uninvolved checker. Only the pair discriminates a working control
//      from "approve is simply broken".
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ConsoleApi } from './zygos-console-client.js';
import { ZYGOS_USERS, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto } from './zygos-client.js';
import type { PaymentBatchDto } from './zygos-console-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe('Zygos batch maker-checker @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let checkerC: ZygosSession | null;

  let aInstr: ZygosApi;
  let aBatch: ConsoleApi;
  let cBatch: ConsoleApi;

  test.beforeAll(async () => {
    // A cold start can hit the shared 5/60s login budget; `loginAs` polls it out, so give the hook
    // room. On a warm run every session comes from playwright/.auth and this costs nothing.
    test.setTimeout(180_000);
    [makerA, checkerC] = await Promise.all([loginAs(ZYGOS_USERS.MAKER_A), loginAs(ZYGOS_USERS.CHECKER_C)]);
    if (makerA && checkerC) {
      aInstr = new ZygosApi(makerA);
      aBatch = new ConsoleApi(makerA);
      cBatch = new ConsoleApi(checkerC);
    }
  });

  test.beforeEach(() => {
    test.skip(!makerA || !checkerC, SKIP_REASON);
  });

  /** Create a fresh instruction and drive it to PendingApproval as maker-a. Returns its externalId. */
  async function pendingInstruction(label: string): Promise<string> {
    const tag = zygosTag(label);
    const createRes = await aInstr.create(instructionBody(tag));
    expect(createRes.status(), `create failed: ${await bodyText(createRes)}`).toBe(201);
    const created = (await createRes.json()) as InstructionDto;

    expect((await aInstr.validate(created.externalId)).status()).toBe(200);
    expect((await aInstr.submitForApproval(created.externalId)).status()).toBe(200);
    return created.externalId;
  }

  /** Assemble a Draft batch (as maker-a) from a single PendingApproval instruction. */
  async function draftBatch(label: string): Promise<PaymentBatchDto> {
    const instructionId = await pendingInstruction(label);
    const res = await aBatch.createBatch({ instructionIds: [instructionId], failurePolicy: 'HoldForCorrection' });
    expect(res.status(), `create batch failed: ${await bodyText(res)}`).toBe(201);
    const batch = (await res.json()) as PaymentBatchDto;
    expect(batch.status, 'a new batch is always Draft').toBe('Draft');
    return batch;
  }

  test('🔴 a Draft instruction cannot be batched — a batch only groups PendingApproval', async () => {
    // Create an instruction and leave it Draft (no validate/submit). Batching it must be refused
    // with 409: the batch's central approval drives PendingApproval → Approved, so an instruction
    // that is not yet awaiting approval has no place in a batch.
    const tag = zygosTag('batch-draft-guard');
    const createRes = await aInstr.create(instructionBody(tag));
    expect(createRes.status()).toBe(201);
    const draft = (await createRes.json()) as InstructionDto;
    expect(draft.status).toBe('Draft');

    const res = await aBatch.createBatch({ instructionIds: [draft.externalId], failurePolicy: 'RejectAll' });
    const body = await bodyText(res);
    expect(res.status(), `batching a Draft instruction must be 409; body: ${body}`).toBe(409);
    expect(body, 'the 409 should name the offending state').toContain('PendingApproval');
  });

  test('🔴 the batch assembler CANNOT approve their own batch — and an uninvolved checker CAN', async () => {
    const batch = await draftBatch('batch-mc');

    const submit = await aBatch.submitBatchForApproval(batch.externalId);
    expect(submit.status(), `submit-for-approval failed: ${await bodyText(submit)}`).toBe(200);
    expect(((await submit.json()) as PaymentBatchDto).status).toBe('PendingApproval');

    // ── The control ──────────────────────────────────────────────────────────────────────────
    // maker-a assembled the batch and created its instruction ⇒ a pooled contributor ⇒ refused.
    const refused = await aBatch.approveBatch(batch.externalId);
    const refusedBody = await bodyText(refused);
    expect(refused.status(), `maker-a must be refused with 403; body: ${refusedBody}`).toBe(403);
    // 🔴 The distinguishing evidence — a CSRF/auth 403 would NOT carry this string.
    expect(refusedBody, `the 403 must be a maker-checker refusal, not CSRF/auth; body: ${refusedBody}`).toContain(
      'Maker-checker violation',
    );

    // ── The discrimination proof ─────────────────────────────────────────────────────────────
    // SAME batch, SAME PendingApproval state, SAME endpoint — only the actor differs.
    const approved = await cBatch.approveBatch(batch.externalId);
    expect(
      approved.status(),
      `checker-c (uninvolved) MUST approve — otherwise maker-a's 403 proves nothing; body: ${await bodyText(approved)}`,
    ).toBe(200);
    expect(((await approved.json()) as PaymentBatchDto).status).toBe('Approved');
  });

  test('a batch rejection requires a reason and moves the batch to Rejected', async () => {
    const batch = await draftBatch('batch-reject');

    expect((await aBatch.submitBatchForApproval(batch.externalId)).status()).toBe(200);

    // A reasonless rejection is a 400 — the maker has to be told why.
    const noReason = await cBatch.rejectBatch(batch.externalId, '');
    expect(noReason.status(), `an empty reason must be 400; body: ${await bodyText(noReason)}`).toBe(400);

    const rejected = await cBatch.rejectBatch(batch.externalId, `Rejected by FINREG E2E ${batch.reference}`);
    expect(rejected.status(), `reject failed: ${await bodyText(rejected)}`).toBe(200);
    expect(((await rejected.json()) as PaymentBatchDto).status).toBe('Rejected');
  });
});
