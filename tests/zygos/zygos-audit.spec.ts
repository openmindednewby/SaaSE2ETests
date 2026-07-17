// Zygos audit trail @api (ZY-18) — contract §1 rule 2, §2.9.
//
// "Every transition writes an AuditEntry. There is no other way to move an instruction, so the
// audit trail cannot drift from reality."
//
// That claim is only worth anything if it is checked against reality rather than against itself.
// So this spec never asks "does the trail look plausible" — it drives a KNOWN sequence of
// transitions and asserts the trail is EXACTLY that sequence, attributed to the users who
// actually performed each step. "Cannot drift" means: reconstruct the history from the trail and
// it must equal what we did.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_USERS, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { AuditEntryDto, InstructionDto } from './zygos-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe('Zygos audit trail @zygos-api @api', () => {
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

  test.beforeEach(() => {
    test.skip(!makerA || !editorB || !checkerC, SKIP_REASON);
  });

  async function trail(id: string): Promise<AuditEntryDto[]> {
    const res = await a.audit(id);
    expect(res.status(), `audit fetch failed: ${await bodyText(res)}`).toBe(200);
    return (await res.json()) as AuditEntryDto[];
  }

  test('🔴 every transition appears in the trail, in order, with the right from/to statuses', async () => {
    const tag = zygosTag('audit-full');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    // A known sequence — this is the ground truth the trail must reproduce.
    expect((await a.validate(created.externalId)).status()).toBe(200);
    expect((await a.submitForApproval(created.externalId)).status()).toBe(200);
    expect((await c.approve(created.externalId)).status()).toBe(200);

    const entries = await trail(created.externalId);

    // Assert the WHOLE shape at once. Checking "contains an Approved entry" would pass on a trail
    // that also invented three transitions that never happened — drift in the other direction.
    expect(
      entries.map((e) => [e.action, e.fromStatus, e.toStatus]),
      'the trail must be exactly the transitions we performed — no more, no fewer, in order',
    ).toEqual([
      ['Created', null, 'Draft'],
      ['Validated', 'Draft', 'Validated'],
      ['SubmittedForApproval', 'Validated', 'PendingApproval'],
      ['Approved', 'PendingApproval', 'Approved'],
    ]);

    // Oldest first, and time moves forward.
    const times = entries.map((e) => Date.parse(e.occurredAt));
    expect(times, 'entries are oldest-first').toEqual([...times].sort((x, y) => x - y));
  });

  test('🔴 the trail attributes each action to the user who actually performed it', async () => {
    // The audit trail's whole job is answering "who did this". An approval recorded against the
    // maker would make maker-checker unauditable even while it is enforced.
    const tag = zygosTag('audit-actors');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    expect((await b.update(created.externalId, instructionBody(tag, { amount: 424.24 }))).status()).toBe(200);
    expect((await a.validate(created.externalId)).status()).toBe(200);
    expect((await a.submitForApproval(created.externalId)).status()).toBe(200);
    expect((await c.approve(created.externalId)).status()).toBe(200);

    const entries = await trail(created.externalId);
    const actorOf = (action: string): string | undefined => entries.find((e) => e.action === action)?.actorUserId;

    const creator = actorOf('Created');
    const editor = actorOf('Edited');
    const approver = actorOf('Approved');

    expect(creator, 'the creation must be attributed').toBeTruthy();
    expect(editor, 'the edit must be attributed — this is what makes the editor a Contributor').toBeTruthy();
    expect(approver, 'the approval must be attributed').toBeTruthy();

    // The three are genuinely three different people — the whole point of four-eyes.
    expect(editor, 'the editor is not the creator').not.toBe(creator);
    expect(approver, 'the approver is neither the creator...').not.toBe(creator);
    expect(approver, '...nor the editor').not.toBe(editor);
  });

  test('an edit is recorded — the trail shows the instruction was touched', async () => {
    const tag = zygosTag('audit-edit');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    expect((await b.update(created.externalId, instructionBody(tag, { amount: 515.15 }))).status()).toBe(200);

    const entries = await trail(created.externalId);
    // Contract §1: `AuditEntry.Action` is a STRING, not an enum, and the edit value is "Edited".
    expect(entries.map((e) => e.action), 'an edit must leave a trace').toContain('Edited');
  });

  test('a rejection is recorded with its own entry', async () => {
    const tag = zygosTag('audit-reject');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    await a.validate(created.externalId);
    await a.submitForApproval(created.externalId);
    expect((await c.reject(created.externalId, 'ZY-18 audit check')).status()).toBe(200);

    const entries = await trail(created.externalId);
    expect(entries.map((e) => [e.action, e.fromStatus, e.toStatus])).toContainEqual([
      'Rejected',
      'PendingApproval',
      'Rejected',
    ]);
  });

  test('🔴 a REFUSED transition writes nothing — the trail records what happened, not what was tried', async () => {
    // The counter-check to "every transition is recorded": an ATTEMPT that the aggregate refused
    // is not a transition, and must not appear. If refusals leaked in, the trail would say a
    // contributor approved an instruction they were actually denied.
    const tag = zygosTag('audit-refused');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    await a.validate(created.externalId);
    await a.submitForApproval(created.externalId);

    const before = await trail(created.externalId);

    // A (a contributor) is refused.
    expect((await a.approve(created.externalId)).status()).toBe(403);

    const after = await trail(created.externalId);
    expect(after.length, 'a refused approval must not append an entry').toBe(before.length);
    expect(after.map((e) => e.action), 'the refused approval must not appear as an Approved action').not.toContain(
      'Approved',
    );
  });
});
