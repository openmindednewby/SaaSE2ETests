import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { ModulesApi } from './zygos-console-modules.js';
import { ZYGOS_API_PREFIX, ZYGOS_USERS, bodyJson, bodyText, csrfHeaders, jsonCsrfHeaders, zygosTag } from './zygos-helpers.js';
import { loginAs, loginFresh } from './zygos-session.js';

import type { APIResponse } from '@playwright/test';
import type { ContactDto } from './zygos-console-modules.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

interface Balance { ownerType: string; ownerId: string; kind: string; currency: string; available: number; held: number; total: number }
interface Movement { status: string; requestId: string | null; journalId: string | null; requestedByUserId: string | null; balance: Balance | null }
interface Problem { code?: string; shortfall?: number; detail?: string; title?: string }
interface Settings { gateEnabled: boolean; gateStage: string; approvalThreshold: number }
interface TenantUser { id: string; username: string; roles: string[]; blocked: boolean }
interface JournalLine { direction: string; amount: number }
interface Deal { externalId: string; fundingStatus?: string | null }
interface HistoryRow { movement: string; journalId: string | null }

function api(path: string): string {
  return `${ZYGOS_API_PREFIX}${path}`;
}

function post(s: ZygosSession, path: string, data?: unknown): Promise<APIResponse> {
  return data === undefined
    ? s.context.post(api(path), { headers: csrfHeaders() })
    : s.context.post(api(path), { headers: jsonCsrfHeaders(), data });
}

function movement(ownerId: string, kind: string, amount: number, reason?: string): Record<string, unknown> {
  return { ownerType: 'user', ownerId, kind, currency: 'EUR', amount, idempotencyKey: randomUUID(), reason };
}

async function expectProblem(res: APIResponse, status: number, code: string): Promise<Problem> {
  const text = await bodyText(res);
  expect(res.status(), `expected ${status} ${code}; body: ${text}`).toBe(status);
  const problem = (await bodyJson<Problem>(res)) ?? {};
  expect(problem.code, `expected refusal code ${code}; body: ${text}`).toBe(code);
  return problem;
}

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}; body: ${await bodyText(res)}`).toBe(status);
}

test.describe('FinReg funds, deal gate, blocking, roles @zygos-api @api', () => {
  const THRESHOLD = 100;
  const NO_THRESHOLD = 1_000_000_000;
  const GATE_STAGE = 'Negotiation';

  let admin: ZygosSession | null = null;
  let checker: ZygosSession | null = null;
  let editor: ZygosSession | null = null;
  let users: TenantUser[] = [];
  let original: Settings | null = null;

  async function listUsers(s: ZygosSession): Promise<TenantUser[]> {
    const res = await s.context.get(api('/access/users'));
    await expectStatus(res, 200, 'GET /access/users');
    return (await res.json()) as TenantUser[];
  }

  function userId(username: string): string {
    const user = users.find((u) => u.username === username);
    expect(user, `fixture user ${username} must be listed in the e2e tenant`).toBeTruthy();
    return user!.id;
  }

  async function ensureRole(s: ZygosSession, username: string, role: string): Promise<void> {
    const user = users.find((u) => u.username === username);
    if (!user || user.roles.includes(role)) return;
    await expectStatus(await post(s, `/access/users/${user.id}/roles`, { role }), 200, `assign ${role} to ${username}`);
  }

  async function putSettings(s: ZygosSession, body: Settings): Promise<void> {
    const res = await s.context.put(api('/funds/settings'), { headers: jsonCsrfHeaders(), data: body });
    await expectStatus(res, 200, 'PUT /funds/settings');
  }

  async function balance(s: ZygosSession, ownerType: string, ownerId: string, kind: string): Promise<Balance | undefined> {
    const res = await s.context.get(api(`/funds/balances?ownerType=${ownerType}&ownerId=${ownerId}`));
    await expectStatus(res, 200, 'GET /funds/balances');
    return ((await res.json()) as Balance[]).find((b) => b.kind === kind && b.currency === 'EUR');
  }

  async function orgDeal(tag: string, amount: number): Promise<{ org: string; deal: Deal }> {
    const contactRes = await new ModulesApi(admin!).createContact({ displayName: `Funds org ${tag}`, kind: 'Organization' });
    await expectStatus(contactRes, 201, 'create organization contact');
    const org = ((await contactRes.json()) as ContactDto).externalId;
    const dealRes = await post(admin!, '/deals', { title: `Funds deal ${tag}`, stage: 'Lead', contactId: org, amount, currency: 'EUR' });
    await expectStatus(dealRes, 201, 'create deal');
    return { org, deal: (await dealRes.json()) as Deal };
  }

  async function fundOrganization(org: string, amount: number): Promise<void> {
    const fund = { ...movement(org, 'money', amount), ownerType: 'organization' };
    await expectStatus(await post(admin!, '/funds/issues', fund), 201, `issue ${amount} money to the organization`);
  }

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    [admin, editor] = await Promise.all([loginAs(ZYGOS_USERS.ADMIN), loginAs(ZYGOS_USERS.EDITOR_B)]);
    if (admin) users = await listUsers(admin);
  });

  test.beforeEach(() => {
    test.skip(!admin || !editor, SKIP_REASON);
  });

  test.describe('balances and deal gate', () => {
    test.beforeAll(async () => {
      test.setTimeout(240_000);
      if (!admin) return;
      await ensureRole(admin, ZYGOS_USERS.ADMIN, 'funds-settings');
      await ensureRole(admin, ZYGOS_USERS.CHECKER_C, 'approver');
      [admin, checker] = await Promise.all([loginFresh(ZYGOS_USERS.ADMIN), loginFresh(ZYGOS_USERS.CHECKER_C)]);
      if (!admin) return;
      const res = await admin.context.get(api('/funds/settings'));
      await expectStatus(res, 200, 'GET /funds/settings');
      original = (await res.json()) as Settings;
      await putSettings(admin, { gateEnabled: true, gateStage: GATE_STAGE, approvalThreshold: THRESHOLD });
    });

    test.afterAll(async () => {
      if (!admin || !original) return;
      await putSettings(admin, {
        gateEnabled: original.gateEnabled,
        gateStage: original.gateStage,
        approvalThreshold: original.approvalThreshold,
      });
    });

    test.beforeEach(() => {
      test.skip(!checker, SKIP_REASON);
    });

    test('AC-F1 issuing 50 credits to a user, posts one balanced journal entry and shows 50 available', async () => {
      const owner = randomUUID();
      const amount = 50;

      const res = await post(admin!, '/funds/issues', movement(owner, 'credits', amount));

      await expectStatus(res, 201, 'issue credits');
      const moved = (await res.json()) as Movement;
      expect(moved.status).toBe('applied');
      expect(moved.journalId, 'an applied issue names its journal entry').toBeTruthy();
      expect(moved.balance?.available).toBe(amount);
      const journal = await admin!.context.get(api(`/journals/${moved.journalId}`));
      await expectStatus(journal, 200, 'GET the issue journal');
      const lines = ((await journal.json()) as { lines: JournalLine[] }).lines;
      const sum = (dir: string): number => lines.filter((l) => l.direction === dir).reduce((t, l) => t + l.amount, 0);
      expect(lines.length, 'a journal entry has at least two lines').toBeGreaterThanOrEqual(2);
      expect(sum('Debit'), 'debits equal credits').toBe(sum('Credit'));
      expect(sum('Debit')).toBe(amount);
      const history = await admin!.context.get(api(`/funds/history?ownerType=user&ownerId=${owner}`));
      await expectStatus(history, 200, 'GET /funds/history');
      expect(((await history.json()) as HistoryRow[]).map((r) => r.journalId)).toContain(moved.journalId);
    });

    test('AC-F2 removing 50 from a 30 credit balance, is refused with InsufficientAvailable and shortfall 20', async () => {
      const owner = randomUUID();
      await expectStatus(await post(admin!, '/funds/issues', movement(owner, 'credits', 30)), 201, 'issue 30 credits');

      const res = await post(admin!, '/funds/adjustments', movement(owner, 'credits', -50, 'e2e remove below zero'));

      const problem = await expectProblem(res, 409, 'InsufficientAvailable');
      expect(problem.shortfall).toBe(20);
      expect((await balance(admin!, 'user', owner, 'credits'))?.available, 'the balance is unchanged').toBe(30);
    });

    test('AC-F2 an adjustment of 10 without a reason, is refused with ReasonRequired', async () => {
      const owner = randomUUID();

      const res = await post(admin!, '/funds/adjustments', movement(owner, 'credits', 10));

      await expectProblem(res, 400, 'ReasonRequired');
    });

    test('AC-F3 an issue of 150 over the 100 threshold, waits; the maker cannot approve it, another approver can', async () => {
      const owner = randomUUID();
      const amount = 150;

      const res = await post(admin!, '/funds/issues', movement(owner, 'credits', amount));

      await expectStatus(res, 202, 'issue over the threshold waits for approval');
      const pending = (await res.json()) as Movement;
      expect(pending.status).toBe('pending');
      expect(pending.requestId).toBeTruthy();
      expect((await balance(admin!, 'user', owner, 'credits'))?.available ?? 0, 'nothing applied while pending').toBe(0);
      await expectProblem(await post(admin!, `/funds/movements/${pending.requestId}/approve`), 403, 'MakerCheckerViolation');
      const approved = await post(checker!, `/funds/movements/${pending.requestId}/approve`);
      await expectStatus(approved, 200, 'checker-c (approver) approves');
      expect(((await approved.json()) as Movement).status).toBe('applied');
      expect((await balance(admin!, 'user', owner, 'credits'))?.available).toBe(amount);
    });

    test('AC-F5 a payout of 10 from a 20 credit balance, is refused with CreditsNotPayable', async () => {
      const owner = randomUUID();
      await expectStatus(await post(admin!, '/funds/issues', movement(owner, 'credits', 20)), 201, 'issue 20 credits');

      const res = await post(admin!, '/funds/payouts', movement(owner, 'credits', 10));

      await expectProblem(res, 400, 'CreditsNotPayable');
      expect((await balance(admin!, 'user', owner, 'credits'))?.available).toBe(20);
    });

    test('AC-F6 issuing 900000000 money above the provider balance, is refused with ProviderBalanceInsufficient', async () => {
      const owner = randomUUID();
      const amount = 900_000_000;
      await putSettings(admin!, { gateEnabled: true, gateStage: GATE_STAGE, approvalThreshold: NO_THRESHOLD });

      const res = await post(admin!, '/funds/issues', movement(owner, 'money', amount));

      await putSettings(admin!, { gateEnabled: true, gateStage: GATE_STAGE, approvalThreshold: THRESHOLD });
      const problem = await expectProblem(res, 409, 'ProviderBalanceInsufficient');
      expect(problem.detail ?? '', 'the refusal states the shortfall').toMatch(/provider balance/i);
    });

    test('AC-G2 moving a 40 deal into the gate stage with no balance, is refused 409 with shortfall 40', async () => {
      const { deal } = await orgDeal(zygosTag('g2-short'), 40);

      const res = await post(admin!, `/deals/${deal.externalId}/stage`, { stage: GATE_STAGE });

      await expectStatus(res, 409, 'a gate move with no balance');
      expect(await bodyText(res), 'the refusal names the shortfall').toContain('Shortfall: 40');
    });

    test('AC-G2 AC-G3 a 40 deal on a 60 balance moved to the gate stage, holds 40; Won settles it', async () => {
      const { org, deal } = await orgDeal(zygosTag('g3-won'), 40);
      await fundOrganization(org, 60);
      await expectStatus(await post(admin!, `/deals/${deal.externalId}/stage`, { stage: GATE_STAGE }), 200, 'move into the gate');
      const held = await balance(admin!, 'organization', org, 'money');
      expect([held?.available, held?.held], 'available 20, held 40').toEqual([20, 40]);

      const res = await post(admin!, `/deals/${deal.externalId}/stage`, { stage: 'Won' });

      await expectStatus(res, 200, 'move to Won');
      expect(((await res.json()) as Deal).fundingStatus).toBe('Settled');
      const settled = await balance(admin!, 'organization', org, 'money');
      expect([settled?.available, settled?.held], 'the hold left the organization').toEqual([20, 0]);
    });

    test('AC-G3 a 40 deal held on a 60 balance moved to Lost, releases the 40 back to the organization', async () => {
      const { org, deal } = await orgDeal(zygosTag('g3-lost'), 40);
      await fundOrganization(org, 60);
      await expectStatus(await post(admin!, `/deals/${deal.externalId}/stage`, { stage: GATE_STAGE }), 200, 'move into the gate');

      const res = await post(admin!, `/deals/${deal.externalId}/stage`, { stage: 'Lost' });

      await expectStatus(res, 200, 'move to Lost');
      expect(((await res.json()) as Deal).fundingStatus).toBe('Released');
      const released = await balance(admin!, 'organization', org, 'money');
      expect([released?.available, released?.held]).toEqual([60, 0]);
    });
  });

  test('AC-B1 a blocked user, gets 403 on the next API call; unblock lets them back in', async () => {
    const target = userId(ZYGOS_USERS.EDITOR_B);
    const reason = `e2e block ${zygosTag('b1')}`;
    const probe = `/funds/balances?ownerType=user&ownerId=${target}`;
    await expectStatus(await editor!.context.get(api(probe)), 200, 'editor-b reads before the block');

    const blocked = await post(admin!, `/access/users/${target}/block`, { reason });

    try {
      await expectStatus(blocked, 200, 'block editor-b');
      await expectStatus(await editor!.context.get(api(probe)), 403, 'a blocked user is refused');
      const audit = await admin!.context.get(api('/access/blocks'));
      await expectStatus(audit, 200, 'GET /access/blocks');
      expect(await audit.text(), 'the block is audited with its reason').toContain(reason);
    } finally {
      await post(admin!, `/access/users/${target}/unblock`, { reason: `${reason} undo` });
    }
    const again = await loginFresh(ZYGOS_USERS.EDITOR_B);
    expect(again, 'an unblocked user can sign in again').toBeTruthy();
    await expectStatus(await again!.context.get(api(probe)), 200, 'editor-b reads after unblock');
  });

  test('AC-R4 the only tenant admin, cannot drop the admin role or block themself', async () => {
    const admins = (await listUsers(admin!)).filter((u) => u.roles.includes('admin'));
    expect(admins.map((u) => u.username), 'zygos-admin must be the only admin, or this test would strip it').toEqual([ZYGOS_USERS.ADMIN]);
    const self = admins[0].id;

    const drop = await admin!.context.delete(api(`/access/users/${self}/roles/admin`), { headers: csrfHeaders() });

    await expectStatus(drop, 409, 'removing the last admin role');
    expect(await bodyText(drop)).toContain('last tenant admin');
    const block = await post(admin!, `/access/users/${self}/block`, { reason: 'e2e self block' });
    await expectStatus(block, 409, 'blocking yourself');
    expect(await bodyText(block)).toContain('cannot block yourself');
    expect((await listUsers(admin!)).find((u) => u.id === self)?.roles).toContain('admin');
  });
});
