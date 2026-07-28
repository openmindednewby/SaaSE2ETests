// Zygos commission @api (FINREG P-06) — rules-as-data, and a pool split that conserves every cent.
//
// A commission rule is tenant policy (a rate + a leftover-cent policy), not a payment: onboarding a
// new rate is an upsert, never a deploy. The calculate endpoint splits a pool across recipients from
// those rules and the allocations MUST re-sum to the pool exactly. These specs prove the rule surface
// round-trips and validates, and that a calculation conserves the pool to the cent.
import { expect, test } from '@playwright/test';

import { ConsoleApi } from './zygos-console-client.js';
import { ZYGOS_USERS, bodyJson, bodyText } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { CommissionResultDto, CommissionRuleDto } from './zygos-console-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';
/** Two arbitrary recipient party ids — calculate splits by weight, it does not resolve the parties. */
const RECIPIENT_A = '11111111-1111-1111-1111-111111111111';
const RECIPIENT_B = '22222222-2222-2222-2222-222222222222';

test.describe('Zygos commission @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let api: ConsoleApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    makerA = await loginAs(ZYGOS_USERS.MAKER_A);
    if (makerA) api = new ConsoleApi(makerA);
  });

  test.beforeEach(() => {
    test.skip(!makerA, SKIP_REASON);
  });

  test('GET /commission-rules returns the tenant rule set', async () => {
    const res = await api.listCommissionRules();
    const body = await bodyJson<{ rules: CommissionRuleDto[] }>(res);
    expect(res.status(), `list rules failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(body?.rules), 'rules must be an array (possibly empty)').toBe(true);
  });

  test('PUT /commission-rules/{key} upserts a rule that then appears in the list', async () => {
    // A euro rule at 150 bps (1.5%), largest-remainder rounding. Idempotent by key — re-running the
    // suite replaces the same row rather than accumulating, so this is safe to repeat.
    const put = await api.upsertCommissionRule('EUR', { rateBps: 150, remainderAllocation: 'LargestRemainder', isActive: true });
    const body = await bodyJson<CommissionRuleDto>(put);
    expect([200, 201], `upsert failed: ${await bodyText(put)}`).toContain(put.status());
    expect(body?.key, 'the rule is keyed by the currency in the path').toBe('EUR');
    expect(body?.rateBps).toBe(150);

    const list = await bodyJson<{ rules: CommissionRuleDto[] }>(await api.listCommissionRules());
    expect(list?.rules.some((r) => r.key === 'EUR' && r.rateBps === 150), 'the upserted rule is listed').toBe(true);
  });

  test('an upsert with a non-currency key is rejected with 400', async () => {
    // The key must be a 3-letter ISO code or the literal 'default'. "not-a-currency" is neither.
    const res = await api.upsertCommissionRule('not-a-currency', { rateBps: 100, remainderAllocation: 'LargestRemainder' });
    expect(res.status(), `a bad key must be 400; body: ${await bodyText(res)}`).toBe(400);
  });

  test('🔴 POST /commission/calculate returns allocations that re-sum to the pool exactly', async () => {
    // Ensure a euro rule exists so the pool is non-zero, then split across two recipients.
    await api.upsertCommissionRule('EUR', { rateBps: 150, remainderAllocation: 'LargestRemainder', isActive: true });

    const res = await api.calculateCommission({
      currency: 'EUR',
      bases: [
        { recipientId: RECIPIENT_A, baseAmount: 100 },
        { recipientId: RECIPIENT_B, baseAmount: 200 },
      ],
    });
    const result = await bodyJson<CommissionResultDto>(res);

    expect(res.status(), `calculate failed: ${await bodyText(res)}`).toBe(200);
    expect(result?.allocations.length, 'one allocation per input recipient, in order').toBe(2);
    expect(result?.allocations[0]?.recipientId, 'input order is preserved').toBe(RECIPIENT_A);
    expect(result?.sourceTotal.currency, 'the pool is stamped with the run currency').toBe('EUR');

    // 🔴 Conservation to the cent: the allocations re-sum to the distributed pool exactly. Compared
    // in integer cents to avoid float drift — this is the whole reason the calculator exists.
    const cents = (n: number | undefined): number => Math.round((n ?? 0) * 100);
    const allocated = result!.allocations.reduce((sum, alloc) => sum + cents(alloc.amount.amount), 0);
    expect(allocated, 'the allocations must re-sum to the pool, not lose or invent a cent').toBe(cents(result?.sourceTotal.amount));
  });

  test('calculate with no recipient bases is rejected with 400', async () => {
    const res = await api.calculateCommission({ currency: 'EUR', bases: [] });
    expect(res.status(), `an empty bases list must be 400; body: ${await bodyText(res)}`).toBe(400);
  });
});
