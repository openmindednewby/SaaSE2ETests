// Zygos accounting @api (FINREG A-01) — the general ledger: a chart of accounts, balanced
// double-entry journals, the trial balance, and periods that lock a month against back-dating.
//
// This module's whole reason to exist is an invariant: debits equal credits, per currency, always.
// So the assertions that matter here are refusals — an unbalanced entry, an unknown account, a
// posting into a closed month — and the trial balance that proves the books never left balance.
//
// Seed-independent like the rest of the suite: every account this test creates carries a run-unique
// code, journals are posted into run-unique far-future months (so a prior run's closed period cannot
// collide), and no assertion pins a global count or "the first row" in the shared demo tenant.
import { expect, test } from '@playwright/test';

import { ModulesApi } from './zygos-console-modules.js';
import { bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAsDemo } from './zygos-session.js';

import type {
  AccountDto,
  JournalDto,
  JournalLineBody,
  Paged,
  PeriodDto,
  TrialBalanceDto,
} from './zygos-console-modules.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or demo credentials not published';
const DEFAULT_PAGE_SIZE = 50;
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
const CENTS = 100;
const SECONDS = 1000;
const YEAR_SPREAD = 300;
const YEAR_BASE = 2200;
const MONTHS = 12;

/** Round a decimal-as-number to integer cents, to compare money without float drift. */
function cents(n: number | undefined): number {
  return Math.round((n ?? 0) * CENTS);
}

/**
 * A run-unique, far-future month code (`YYYY-MM`) for the closed-period test. Well beyond any real
 * demo data, and spread by the run clock so a rerun does not land on a month a previous run already
 * closed (which would turn the first post into an unexpected 409).
 */
function uniqueFutureMonth(): string {
  const secs = Math.floor(Date.now() / SECONDS);
  const year = YEAR_BASE + (secs % YEAR_SPREAD);
  const month = ((secs % MONTHS) + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/** A balanced two-line entry: one debit and one credit of equal value in one currency. */
function balancedLines(debitCode: string, creditCode: string, amount = 100, currency = 'EUR'): JournalLineBody[] {
  return [
    { accountCode: debitCode, direction: 'Debit', amount, currency },
    { accountCode: creditCode, direction: 'Credit', amount, currency },
  ];
}

test.describe('Zygos accounting @zygos-api @api', () => {
  let demo: ZygosSession | null;
  let api: ModulesApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    demo = await loginAsDemo();
    if (demo) api = new ModulesApi(demo);
  });

  test.beforeEach(() => {
    test.skip(!demo, SKIP_REASON);
  });

  /** Create a chart-of-accounts head with a run-unique code. Returns its DTO. */
  async function createAccount(label: string, type: AccountDto['type']): Promise<AccountDto> {
    const code = zygosTag(label);
    const res = await api.createAccount({ code, name: `${label} ${code}`, type });
    expect(res.status(), `create account failed: ${await bodyText(res)}`).toBe(201);
    const dto = (await res.json()) as AccountDto;
    expect(dto.code, 'the created account keeps its code').toBe(code);
    expect(dto.isActive, 'a new account starts active').toBe(true);
    return dto;
  }

  test('GET /accounts returns a well-formed paged envelope', async () => {
    const res = await api.listAccounts();
    const body = await bodyJson<Paged<AccountDto>>(res);
    expect(res.status(), `list failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(body?.items), 'items must be an array').toBe(true);
    expect(body?.page).toBe(1);
    expect(body?.pageSize, 'the documented default page size').toBe(DEFAULT_PAGE_SIZE);
    expect(body?.totalCount ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('accounts pageSize above the cap is rejected with 400', async () => {
    const res = await api.listAccounts('?pageSize=101');
    expect(res.status(), `over-cap pageSize must be 400; body: ${await bodyText(res)}`).toBe(400);
  });

  test('POST /accounts creates an account; a duplicate code is refused with 409', async () => {
    const code = zygosTag('acct-dup');
    const first = await api.createAccount({ code, name: `Cash ${code}`, type: 'Asset' });
    expect(first.status(), `first create must be 201: ${await bodyText(first)}`).toBe(201);
    const dto = (await first.json()) as AccountDto;
    expect(dto.type).toBe('Asset');
    expect(dto.externalId, 'a created account carries a server-assigned id').toBeTruthy();

    // The code is unique per tenant — the same code again is a conflict, not a second row.
    const dup = await api.createAccount({ code, name: `Cash again ${code}`, type: 'Asset' });
    expect(dup.status(), `a duplicate account code must be 409; body: ${await bodyText(dup)}`).toBe(409);
  });

  test('POST /journal-entries posts a balanced entry; it then loads by id, and a bogus id is 404', async () => {
    const cash = await createAccount('jrnl-cash', 'Asset');
    const revenue = await createAccount('jrnl-rev', 'Income');
    const tag = zygosTag('jrnl-post');

    const res = await api.postJournalEntry({
      entryDate: new Date().toISOString().slice(0, 10),
      lines: balancedLines(cash.code, revenue.code),
      reference: tag,
      description: `Balanced test entry ${tag}`,
    });
    const journal = await bodyJson<JournalDto>(res);
    expect(res.status(), `post journal failed: ${await bodyText(res)}`).toBe(201);
    expect(journal?.externalId, 'a posted journal carries an id').toBeTruthy();
    expect(journal?.lines.length, 'both legs are recorded').toBe(2);
    expect(journal?.periodId, 'a posted journal belongs to a period').toBeTruthy();

    const detail = await bodyJson<JournalDto>(await api.getJournal(journal!.externalId));
    expect(detail?.externalId, 'the journal loads on the detail endpoint').toBe(journal!.externalId);
    expect(detail?.description).toBe(`Balanced test entry ${tag}`);

    const missing = await api.getJournal(UNKNOWN_ID);
    expect(missing.status(), `an unknown journal must be 404; body: ${await bodyText(missing)}`).toBe(404);
  });

  test('🔴 an UNBALANCED journal is refused with 400 (does not balance)', async () => {
    const cash = await createAccount('unbal-cash', 'Asset');
    const revenue = await createAccount('unbal-rev', 'Income');

    // 100 debit, 50 credit — same currency, both positive, so the per-line rules pass and the
    // balance rule is the one that fires. This is the mistake the whole module exists to catch.
    const res = await api.postJournalEntry({
      entryDate: new Date().toISOString().slice(0, 10),
      lines: [
        { accountCode: cash.code, direction: 'Debit', amount: 100, currency: 'EUR' },
        { accountCode: revenue.code, direction: 'Credit', amount: 50, currency: 'EUR' },
      ],
    });
    const body = await bodyText(res);
    expect(res.status(), `an unbalanced entry must be 400; body: ${body}`).toBe(400);
    expect(body.toLowerCase(), 'the 400 names the balance violation').toContain('does not balance');
  });

  test('a journal naming an UNKNOWN account is refused with 400', async () => {
    const cash = await createAccount('unknown-acct-cash', 'Asset');
    const ghost = zygosTag('ghost-code'); // never created ⇒ no such account

    // Balanced on purpose, so it passes the request validator and reaches the handler's account
    // check — that is the code path under test, not the balance rule.
    const res = await api.postJournalEntry({
      entryDate: new Date().toISOString().slice(0, 10),
      lines: balancedLines(ghost, cash.code),
    });
    const body = await bodyText(res);
    expect(res.status(), `an unknown account must be 400; body: ${body}`).toBe(400);
    expect(body.toLowerCase(), 'the 400 names the unknown account').toContain('unknown or inactive');
  });

  test('🔴 a journal dated inside a CLOSED period is refused with 409', async () => {
    const cash = await createAccount('closed-cash', 'Asset');
    const revenue = await createAccount('closed-rev', 'Income');
    const month = uniqueFutureMonth();

    // Open the month with a first posting, then close it. A rerun that lands on an
    // already-closed month gets a 409 here — which is itself the behaviour under test — so both
    // branches converge on the definitive assertion below.
    const opening = await api.postJournalEntry({
      entryDate: `${month}-15`,
      lines: balancedLines(cash.code, revenue.code),
    });
    if (opening.status() === 201) {
      const periodId = ((await opening.json()) as JournalDto).periodId;
      const close = await api.closePeriod(periodId);
      expect(close.status(), `closing the period failed: ${await bodyText(close)}`).toBe(200);
      expect(((await close.json()) as PeriodDto).status, 'the period is now Closed').toBe('Closed');
    } else {
      expect(opening.status(), `unexpected status opening ${month}: ${await bodyText(opening)}`).toBe(409);
    }

    // ── The assertion that matters: a posting into the now-closed month is refused with 409. ──
    const refused = await api.postJournalEntry({
      entryDate: `${month}-20`,
      lines: balancedLines(cash.code, revenue.code),
    });
    const body = await bodyText(refused);
    expect(refused.status(), `a posting into a closed period must be 409; body: ${body}`).toBe(409);
    expect(body.toLowerCase(), 'the 409 names the closed period').toContain('is closed');
  });

  test('GET /journals returns a well-formed paged envelope', async () => {
    const res = await api.listJournals();
    const body = await bodyJson<Paged<JournalDto>>(res);
    expect(res.status(), `list failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(body?.items), 'items must be an array').toBe(true);
    expect(body?.page).toBe(1);
    expect(body?.pageSize, 'the documented default page size').toBe(DEFAULT_PAGE_SIZE);
    expect(body?.totalCount ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('🔴 GET /trial-balance is balanced: totalDebits == totalCredits and isBalanced is true', async () => {
    const res = await api.getTrialBalance();
    const tb = await bodyJson<TrialBalanceDto>(res);
    expect(res.status(), `trial balance failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(tb?.rows), 'the trial balance carries per-account rows').toBe(true);

    // The books must balance — every journal that produced these lines balanced at posting time,
    // so their sum does too. Compared in integer cents to avoid float drift.
    expect(cents(tb?.totalDebits), 'total debits must equal total credits').toBe(cents(tb?.totalCredits));
    expect(tb?.isBalanced, 'the server-computed balance flag agrees the books balance').toBe(true);
  });

  test('GET /periods returns the tenant’s accounting periods', async () => {
    const res = await api.listPeriods();
    const periods = await bodyJson<PeriodDto[]>(res);
    expect(res.status(), `list periods failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(periods), 'periods is a bare array, not a paged envelope').toBe(true);

    for (const period of periods ?? []) {
      expect(period.code, 'every period has a YYYY-MM code').toMatch(/^\d{4}-\d{2}$/);
      expect(['Open', 'Closed']).toContain(period.status);
      expect(period.externalId, 'every period carries an id').toBeTruthy();
    }
  });
});
