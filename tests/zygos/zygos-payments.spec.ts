// FINREG Payments @api (P-PAY-1..11) — the deterministic, READ-ONLY tier.
//
// Every assertion keys off a `ZC-2026-*` corridor row's immutable `reference` (looked up via
// `?search=`), so it is seed-independent in the only sense that matters here: it never depends on a
// row index, a global count, or the shared demo tenant's ever-growing `ZY-2026` book. These rows
// are the seed's whole reason for existing — one per rail, one screening hold, one cross-currency,
// both non-IBAN account types — so they are the most stable thing to assert on, and creating +
// approving real payments (with maker-checker + screening side effects) is deliberately avoided.
//
// The wire fields (`rail`, `screeningDecision`, `settlement*`, `chargeBearer`, account types,
// structured remittance) are exactly what the frontend renders as badges/fields, so proving the
// API carries them correctly is the fast half of proving the UI does.
import { expect, test } from '@playwright/test';

import { CORRIDOR, findByReference, getVelocityUsage } from './zygos-payments.js';
import { loginAsDemo } from './zygos-session.js';

import type { PaymentRail } from './zygos-payments.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or demo credentials not published';

test.describe('FINREG payments @zygos-api @api', () => {
  let demo: ZygosSession | null;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    demo = await loginAsDemo();
  });

  test.beforeEach(() => {
    test.skip(!demo, SKIP_REASON);
  });

  // ── P-PAY-11 rails — each corridor row settles on the rail its currency/destination/account imply.
  const RAIL_CASES: readonly { name: string; ref: string; rail: PaymentRail }[] = [
    { name: 'SEPA Instant (EUR IBAN, instant)', ref: CORRIDOR.sepaInstant.ref, rail: 'SepaInstant' },
    { name: 'SEPA (EUR IBAN)', ref: CORRIDOR.sepaStructured.ref, rail: 'Sepa' },
    { name: 'Faster Payments (GBP sort code)', ref: CORRIDOR.fasterPayments.ref, rail: 'FasterPayments' },
    { name: 'ACH (USD routing)', ref: CORRIDOR.ach.ref, rail: 'Ach' },
    { name: 'SWIFT (cross-border)', ref: CORRIDOR.swiftDebtorFees.ref, rail: 'Swift' },
  ];

  for (const c of RAIL_CASES) {
    test(`P-PAY-11 rail: ${c.name} → ${c.rail}`, async () => {
      const row = await findByReference(demo as ZygosSession, c.ref);
      expect(row.rail, `${c.ref} should settle on ${c.rail}`).toBe(c.rail);
      // The explanation is what the badge's accessible name surfaces — a rail with no rationale is
      // a half-built feature, so it must be non-empty prose.
      expect((row.railExplanation ?? '').length, `${c.ref} has no rail explanation`).toBeGreaterThan(0);
    });
  }

  // ── P-PAY-7 beneficiary screening — the Volkov row is held on a genuine partial OFAC match.
  test('P-PAY-7 screening: Volkov Trading GmbH is on Screening-Hold with a recorded OFAC match', async () => {
    const row = await findByReference(demo as ZygosSession, CORRIDOR.screeningHold.ref);
    expect(row.status, 'the seeded hold must actually be in ScreeningHold').toBe('ScreeningHold');
    expect(row.screeningDecision, 'a partial match, not a hard block (so it is overridable)').toBe(
      'PotentialMatch',
    );
    expect(row.creditor.name).toBe('Volkov Trading GmbH');
    expect(row.screeningMatchedName ?? '', 'the matched sanctioned identity is recorded').toContain('Volkov');
    expect((row.screeningListSource ?? '').length, 'the list source is recorded').toBeGreaterThan(0);
    expect(row.screeningScore, 'a partial match carries a non-zero score').toBeGreaterThan(0);
    // A PotentialMatch is CLEARED by the 4-eyes override (→ Validated/Approved), never auto-approved.
    expect(row.allowedTransitions, 'the hold offers a checker path forward').toContain('Approved');
  });

  // ── P-PAY-10 FX cross-currency — the settlement leg carries currency, rate and computed amount.
  test('P-PAY-10 FX: the cross-currency row carries a full settlement leg', async () => {
    const row = await findByReference(demo as ZygosSession, CORRIDOR.crossCurrency.ref);
    expect(row.isCrossCurrency, 'this row is the cross-currency showcase').toBe(true);
    expect(row.currency, 'debtor-side currency').toBe('EUR');
    expect(row.settlementCurrency, 'settles in USD').toBe('USD');
    expect(row.fxRate ?? 0, 'a real FX rate is stored').toBeGreaterThan(0);
    expect(row.settlementAmount ?? 0, 'the settlement amount is computed, not blank').toBeGreaterThan(0);
    // amount × rate ≈ settlementAmount (fee/margin aside) — the number is derived, not arbitrary.
    const expected = row.amount * (row.fxRate ?? 0);
    expect(Math.abs((row.settlementAmount ?? 0) - expected)).toBeLessThan(expected * 0.05 + 1);
  });

  // ── P-PAY-3 non-IBAN account types — UK sort-code and US routing beneficiaries.
  test('P-PAY-3 account types: UK sort-code row is DomesticSortCode with a sort code, no IBAN', async () => {
    const row = await findByReference(demo as ZygosSession, CORRIDOR.fasterPayments.ref);
    expect(row.creditor.accountType).toBe('DomesticSortCode');
    expect((row.creditor.sortCode ?? '').length, 'a sort code is present').toBeGreaterThan(0);
    expect(row.creditor.accountNumber ?? '', 'a domestic account number is present').not.toBe('');
    expect(row.creditor.iban, 'a domestic account has no IBAN').toBeNull();
  });

  test('P-PAY-3/P-PAY-4 account types: US routing row is DomesticRouting with a structured address', async () => {
    const row = await findByReference(demo as ZygosSession, CORRIDOR.ach.ref);
    expect(row.creditor.accountType).toBe('DomesticRouting');
    expect((row.creditor.routingNumber ?? '').length, 'a routing number is present').toBeGreaterThan(0);
    expect(row.creditor.iban).toBeNull();
    // P-PAY-4 structured creditor address (SWIFT/CBPR+ shape).
    expect(row.creditor.structuredAddress, 'a structured postal address is captured').not.toBeNull();
    expect((row.creditor.structuredAddress?.addressLine1 ?? '').length).toBeGreaterThan(0);
    expect((row.creditor.structuredAddress?.country ?? '').length).toBeGreaterThan(0);
  });

  // ── P-PAY-6 structured remittance — purpose code + RF creditor reference.
  test('P-PAY-6 remittance: the structured row carries a purpose code and an RF creditor reference', async () => {
    const row = await findByReference(demo as ZygosSession, CORRIDOR.sepaStructured.ref);
    expect(row.remittanceKind).toBe('Structured');
    expect((row.purposeCode ?? '').length, 'a purpose code is set').toBeGreaterThan(0);
    expect(row.creditorReference ?? '', 'an ISO 11649 RF reference is set').toMatch(/^RF/);
  });

  // ── P-PAY-5 charge-bearer — SHA/OUR/BEN, surfaced as Shared/Debtor/Creditor across the corridor.
  test('P-PAY-5 charge-bearer: the corridor exercises Shared, Debtor AND Creditor', async () => {
    const [creditorFees, ach, debtorFees, creditorFees2] = await Promise.all([
      findByReference(demo as ZygosSession, CORRIDOR.fasterPayments.ref),
      findByReference(demo as ZygosSession, CORRIDOR.ach.ref),
      findByReference(demo as ZygosSession, CORRIDOR.swiftDebtorFees.ref),
      findByReference(demo as ZygosSession, CORRIDOR.swiftCreditorFees.ref),
    ]);
    expect(creditorFees.chargeBearer).toBe('Creditor');
    expect(ach.chargeBearer).toBe('Shared');
    expect(debtorFees.chargeBearer).toBe('Debtor');
    // All three bearers are represented — a single-value seed would prove nothing about the field.
    const seen = new Set([creditorFees, ach, debtorFees, creditorFees2].map((r) => r.chargeBearer));
    expect(seen, 'the corridor covers all three charge bearers').toEqual(
      new Set(['Shared', 'Debtor', 'Creditor']),
    );
  });

  // ── P-PAY-8 velocity limits — the headroom envelope the list indicator reads.
  test('P-PAY-8 velocity: the usage endpoint returns a well-formed headroom envelope', async () => {
    const usage = await getVelocityUsage(demo as ZygosSession, 'EUR');
    expect(usage.currency).toBe('EUR');
    expect(usage.windowHours, 'a rolling window is declared').toBeGreaterThan(0);
    expect(usage.tenantAmountUsed, 'used-so-far is a real, non-negative figure').toBeGreaterThanOrEqual(0);
    expect(typeof usage.tenantCountUsed).toBe('number');
    // Cap fields are nullable BY DESIGN (an uncapped tenant/currency) — assert the shape, not a value.
    for (const key of [
      'tenantDailyAmountCap',
      'tenantDailyCountCap',
      'userDailyAmountCap',
      'userDailyCountCap',
    ] as const) {
      const v = usage[key];
      expect(v === null || typeof v === 'number', `${key} must be a number or null`).toBe(true);
    }
  });
});
