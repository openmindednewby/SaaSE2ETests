// Zygos instruction lifecycle @api (ZY-18) — the state machine (contract §1).
//
// The legal path: Draft → Validated → PendingApproval → Approved → Submitted.
// Everything else throws. The aggregate has no public `Status` setter, so illegal moves are
// meant to be UNREPRESENTABLE rather than merely validated against — these tests check the
// wire-level consequence of that design.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_USERS, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto } from './zygos-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe('Zygos instruction lifecycle @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let checkerC: ZygosSession | null;
  let a: ZygosApi;
  let c: ZygosApi;

  test.beforeAll(async () => {
    // The login budget (5/60s per IP) is shared by the whole run, so a COLD start — where no
    // session is parked yet — can legitimately hit a 429 and must wait the window out. The
    // default 30s hook timeout is shorter than that window, which would turn a transient
    // throttle into a hard beforeAll failure and cascade-fail the file. `loginAs` polls; this
    // gives it room to. On a warm run every session comes from playwright/.auth/ and this costs
    // nothing.
    test.setTimeout(180_000);
    [makerA, checkerC] = await Promise.all([loginAs(ZYGOS_USERS.MAKER_A), loginAs(ZYGOS_USERS.CHECKER_C)]);
    if (makerA && checkerC) {
      a = new ZygosApi(makerA);
      c = new ZygosApi(checkerC);
    }
  });

  // No afterAll disposal: sessions are cached and shared suite-wide (login budget is 5/60s per
  // IP). An instruction cannot be deleted anyway — no DELETE route; it is an immutable financial
  // record. See zygos-helpers.zygosTag for how re-runnability is achieved instead.

  test.beforeEach(() => {
    test.skip(!makerA || !checkerC, SKIP_REASON);
  });

  async function createDraft(label: string): Promise<InstructionDto> {
    const res = await a.create(instructionBody(zygosTag(label)));
    expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);
    return (await res.json()) as InstructionDto;
  }

  test('a new instruction starts in Draft with a server-allocated reference', async () => {
    const tag = zygosTag('life-create');
    const res = await a.create(instructionBody(tag, { amount: 123.45, currency: 'EUR' }));

    expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);
    const dto = (await res.json()) as InstructionDto;

    expect(dto.status, 'a new instruction is always Draft — there is no constructor that says otherwise').toBe('Draft');
    expect(dto.amount).toBe(123.45);
    expect(dto.currency).toBe('EUR');
    // The reference is allocated server-side and is not a field the client can supply.
    expect(dto.reference, 'the server must allocate a reference').toMatch(/^ZY-\d{4}-\d+$/);
    // The key is minted at Submit and only at Submit.
    expect(dto.idempotencyKey, 'no idempotency key before Submitted').toBeNull();
    expect(dto.providerCode, 'no provider before Submitted').toBeNull();
  });

  test('the full legal path Draft → Validated → PendingApproval → Approved', async () => {
    const draft = await createDraft('life-happy');

    const validated = await a.validate(draft.externalId);
    expect(validated.status(), `validate failed: ${await bodyText(validated)}`).toBe(200);
    expect(((await validated.json()) as InstructionDto).status).toBe('Validated');

    const pending = await a.submitForApproval(draft.externalId);
    expect(pending.status(), `submit-for-approval failed: ${await bodyText(pending)}`).toBe(200);
    expect(((await pending.json()) as InstructionDto).status).toBe('PendingApproval');

    // C, who has touched nothing, is the only one who may approve.
    const approved = await c.approve(draft.externalId);
    expect(approved.status(), `approve failed: ${await bodyText(approved)}`).toBe(200);
    expect(((await approved.json()) as InstructionDto).status).toBe('Approved');
  });

  test('editing a Validated instruction sends it back to Draft — it must be re-validated', async () => {
    const tag = zygosTag('life-reedit');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    expect((await a.validate(created.externalId)).status()).toBe(200);

    // The §1 re-edit arrow: Validated → Draft. A change invalidates the validation that
    // preceded it — otherwise you could validate a benign payment and then edit it.
    const edited = await a.update(created.externalId, instructionBody(tag, { amount: 777.77 }));
    expect(edited.status(), `edit failed: ${await bodyText(edited)}`).toBe(200);
    expect(((await edited.json()) as InstructionDto).status, 'editing a Validated instruction must return it to Draft').toBe('Draft');
  });

  test.describe('illegal transitions are rejected with 409', () => {
    test('Draft → Approved (skipping validation and approval) is refused', async () => {
      const draft = await createDraft('life-illegal-approve');
      const res = await c.approve(draft.externalId);
      expect(res.status(), `approving a Draft must be 409; body: ${await bodyText(res)}`).toBe(409);
      expect(await bodyText(res)).toContain('Illegal transition');
    });

    test('Draft → PendingApproval (skipping Validated) is refused', async () => {
      const draft = await createDraft('life-illegal-sfa');
      const res = await a.submitForApproval(draft.externalId);
      expect(res.status(), `submit-for-approval from Draft must be 409; body: ${await bodyText(res)}`).toBe(409);
      expect(await bodyText(res)).toContain('Illegal transition');
    });

    test('validating an already-Validated instruction is refused', async () => {
      const draft = await createDraft('life-illegal-revalidate');
      expect((await a.validate(draft.externalId)).status()).toBe(200);

      const again = await a.validate(draft.externalId);
      expect(again.status(), `re-validating must be 409; body: ${await bodyText(again)}`).toBe(409);
    });

    test('🔴 an Approved instruction cannot be sent back to Draft — there is no such route at all', async () => {
      // The strongest form of the rule: `Approved → Draft` is not "rejected", it is
      // unrepresentable. There is no endpoint that expresses it and no public Status setter.
      // The nearest thing a client can reach for is PUT (edit), which is legal ONLY in
      // Draft/Validated — so the attempt dies at the edit guard.
      const tag = zygosTag('life-no-backward');
      const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;
      await a.validate(created.externalId);
      await a.submitForApproval(created.externalId);
      expect((await c.approve(created.externalId)).status()).toBe(200);

      const edit = await a.update(created.externalId, instructionBody(tag, { amount: 1.0 }));
      expect(edit.status(), `editing an Approved instruction must be refused; body: ${await bodyText(edit)}`).toBe(409);

      // And it really is still Approved — the refused edit changed nothing.
      const after = (await (await a.get(created.externalId)).json()) as InstructionDto;
      expect(after.status).toBe('Approved');
      expect(after.amount, 'a refused edit must not have altered the record').not.toBe(1.0);
    });

    test('a rejected instruction cannot then be approved', async () => {
      const draft = await createDraft('life-rejected-then-approve');
      await a.validate(draft.externalId);
      await a.submitForApproval(draft.externalId);

      expect((await c.reject(draft.externalId, 'ZY-18 lifecycle check')).status()).toBe(200);

      const approve = await c.approve(draft.externalId);
      expect(approve.status(), `approving a Rejected instruction must be 409; body: ${await bodyText(approve)}`).toBe(409);
    });
  });
});
