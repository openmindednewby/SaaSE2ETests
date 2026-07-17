// Zygos tenant isolation @api (ZY-18) — contract §5 G1: "real handlers → real EF → real DB.
// Tenant B cannot read, list or mutate A's anything."
//
// This is a G-gate, so it is tested against the real deployed stack — no mocks, no in-memory
// handler, no seam. `zygos-tenant-b` carries a DIFFERENT `tenantId` claim, which is the only
// thing separating it from tenant A.
//
// 🔴 THE EXPECTED ANSWER IS 404, NOT 403. A 403 would confirm the id exists somewhere — the
// existence of a payment to a named counterparty is itself the leak. "Not found" is the only
// answer that reveals nothing, and the backend is explicit about this: "Another tenant's
// instruction is 'not found', not 'forbidden' — a 403 would confirm the id exists somewhere,
// which is itself a leak."
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_USERS, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto, PagedInstructions } from './zygos-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe('Zygos tenant isolation @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let tenantB: ZygosSession | null;
  let a: ZygosApi;
  let bTenant: ZygosApi;

  /** An instruction belonging to tenant A, created fresh so the test owns its subject. */
  let aInstruction: InstructionDto;
  let aTag: string;

  test.beforeAll(async () => {
    // The login budget (5/60s per IP) is shared by the whole run, so a COLD start — where no
    // session is parked yet — can legitimately hit a 429 and must wait the window out. The
    // default 30s hook timeout is shorter than that window, which would turn a transient
    // throttle into a hard beforeAll failure and cascade-fail the file. `loginAs` polls; this
    // gives it room to. On a warm run every session comes from playwright/.auth/ and this costs
    // nothing.
    test.setTimeout(180_000);
    [makerA, tenantB] = await Promise.all([loginAs(ZYGOS_USERS.MAKER_A), loginAs(ZYGOS_USERS.TENANT_B)]);
    if (!makerA || !tenantB) return;

    a = new ZygosApi(makerA);
    bTenant = new ZygosApi(tenantB);

    aTag = zygosTag('isolation');
    const res = await a.create(instructionBody(aTag));
    expect(res.status(), `tenant A create failed: ${await bodyText(res)}`).toBe(201);
    aInstruction = (await res.json()) as InstructionDto;
  });

  test.beforeEach(() => {
    test.skip(!makerA || !tenantB, SKIP_REASON);
  });

  test('🔴 tenant B cannot READ tenant A\'s instruction — and A can', async () => {
    const bRead = await bTenant.get(aInstruction.externalId);
    expect(
      bRead.status(),
      `tenant B must get 404 (not 403 — that would confirm the id exists); body: ${await bodyText(bRead)}`,
    ).toBe(404);

    // ── The discrimination proof ──────────────────────────────────────────────────────────
    // SAME id, SAME endpoint. Only the tenant differs. Without this, B's 404 is equally
    // consistent with "the id is wrong", "the row was never created", or "GET is broken" —
    // none of which demonstrate isolation.
    const aRead = await a.get(aInstruction.externalId);
    expect(aRead.status(), `tenant A MUST be able to read its own instruction — otherwise B's 404 proves nothing; body: ${await bodyText(aRead)}`).toBe(200);
    expect(((await aRead.json()) as InstructionDto).externalId).toBe(aInstruction.externalId);
  });

  test('🔴 tenant B cannot LIST tenant A\'s instructions, even searching for them by name', async () => {
    // Search by A's unique tag. If the tenant filter were a pass-through, this is exactly the
    // query that would expose it — B asking a precise question about A's data.
    const bList = await bTenant.list(`?Search=${encodeURIComponent(aTag)}`);
    expect(bList.status(), `list should succeed for B (scoped to B); body: ${await bodyText(bList)}`).toBe(200);

    const bBody = (await bList.json()) as PagedInstructions;
    expect(bBody.totalCount, "tenant B must see NONE of tenant A's rows").toBe(0);
    expect(bBody.items, 'not one row may leak across the tenant wall').toHaveLength(0);

    // Discrimination: the identical search, run by A, finds it.
    const aList = await a.list(`?Search=${encodeURIComponent(aTag)}`);
    const aBody = (await aList.json()) as PagedInstructions;
    expect(aBody.totalCount, 'tenant A must find its own row with the same search — otherwise B seeing 0 proves nothing').toBe(1);
  });

  test('🔴 tenant B cannot MUTATE tenant A\'s instruction', async () => {
    // Read isolation without write isolation would still let B drive A's payments through the
    // state machine.
    const validate = await bTenant.validate(aInstruction.externalId);
    expect(validate.status(), `B must not be able to validate A's instruction; body: ${await bodyText(validate)}`).toBe(404);

    const update = await bTenant.update(aInstruction.externalId, instructionBody(aTag, { amount: 1.23 }));
    expect(update.status(), `B must not be able to edit A's instruction; body: ${await bodyText(update)}`).toBe(404);

    const approve = await bTenant.approve(aInstruction.externalId);
    expect(approve.status(), `B must not be able to approve A's instruction; body: ${await bodyText(approve)}`).toBe(404);

    // And the record is untouched — the refusals were real, not cosmetic.
    const after = (await (await a.get(aInstruction.externalId)).json()) as InstructionDto;
    expect(after.status, "A's instruction must still be Draft").toBe('Draft');
    expect(after.amount, "B's attempted edit must not have landed").not.toBe(1.23);
  });

  test('🔴 tenant B cannot read tenant A\'s AUDIT TRAIL', async () => {
    // The trail names counterparties, amounts and actors — everything the instruction itself
    // would leak, plus who touched it.
    const bAudit = await bTenant.audit(aInstruction.externalId);
    expect(bAudit.status(), `B must not read A's audit trail; body: ${await bodyText(bAudit)}`).toBe(404);

    const aAudit = await a.audit(aInstruction.externalId);
    expect(aAudit.status(), 'A must be able to read its own trail').toBe(200);
  });

  test('tenant B has its own scope — B\'s own instruction is visible to B and invisible to A', async () => {
    // Isolation is symmetric. A tenant filter that only ever hides "everything except tenant A"
    // (e.g. a hardcoded predicate) would pass every test above and fail this one.
    const bTag = zygosTag('isolation-b');
    const created = await bTenant.create(instructionBody(bTag));
    expect(created.status(), `tenant B create failed: ${await bodyText(created)}`).toBe(201);
    const bInstruction = (await created.json()) as InstructionDto;

    expect((await bTenant.get(bInstruction.externalId)).status(), 'B can read its own').toBe(200);

    const aRead = await a.get(bInstruction.externalId);
    expect(aRead.status(), `tenant A must not read tenant B's instruction either; body: ${await bodyText(aRead)}`).toBe(404);

    const aList = await a.list(`?Search=${encodeURIComponent(bTag)}`);
    expect(((await aList.json()) as PagedInstructions).totalCount, "A must not find B's row").toBe(0);
  });
});
