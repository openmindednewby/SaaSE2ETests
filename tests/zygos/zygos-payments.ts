// FINREG Payments (P-PAY-1..11) E2E support — the typed shapes, deterministic seed fixtures, form
// testID literals and the DEMO-tenant browser entry the payment specs share. A sibling to
// `zygos-console-ui.ts` / `zygos-helpers.ts`; same transport rules, same login budget.
//
// ── Two things make this file necessary ────────────────────────────────────────────────────────
//
// 1. The existing `InstructionDto` (zygos-client.ts) is the PRE-payments subset — it has no
//    `rail`, `screeningDecision`, `settlement*`, account-type or structured-remittance fields. The
//    `ZygosApi.list()/get()` transport already returns the FULL row on the wire; this file just
//    supplies the fuller TYPE (`PaymentInstructionDetailDto`) taken from the deployed staging
//    payload (the source of truth, verified 2026-08-04), never from finreg-web's TypeScript.
//
// 2. 🔴 THE `ZC-2026-*` CORRIDOR ROWS LIVE IN THE **DEMO** TENANT. The @ui suite's `enterConsole`
//    logs in as `zygos-checker-c` (a DIFFERENT tenant), which by tenant isolation cannot see them.
//    So the payment @ui specs that assert on seeded corridor data enter as the DEMO user via
//    `enterConsoleAsDemo` — the same real, server-issued session the @api tier uses, injected into
//    the browser (the parked-cookie pattern, not a fake).
import { expect } from '@playwright/test';

import { id } from './zygos-console-ui.js';
import { ZYGOS_API_PREFIX, ZYGOS_WEB_URL, bodyJson } from './zygos-helpers.js';
import { loginAsDemo } from './zygos-session.js';

import type { ZygosSession } from './zygos-session.js';
import type { Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────── wire shapes (staging = truth)
/** `BankAccountType` — verbatim enum names on the wire. */
export type BankAccountType = 'Iban' | 'Bban' | 'DomesticSortCode' | 'DomesticRouting';

/** `PaymentRail` — verbatim enum names on the wire (server-derived, read-only on the record). */
export type PaymentRail = 'Sepa' | 'SepaInstant' | 'FasterPayments' | 'Ach' | 'Swift';

/** `ScreeningDecision` — verbatim enum names. `NotScreened` until the submit-for-approval gate. */
export type ScreeningDecision = 'NotScreened' | 'Clear' | 'PotentialMatch' | 'Confirmed';

/** `ChargeBearer` — SHA / OUR / BEN on the wire as Shared / Debtor / Creditor. */
export type ChargeBearer = 'Shared' | 'Debtor' | 'Creditor';

export interface StructuredAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  townName: string | null;
  postCode: string | null;
  countrySubDivision: string | null;
  country: string | null;
}

export interface CounterpartyDetail {
  name: string | null;
  accountType: BankAccountType;
  iban: string | null;
  accountNumber: string | null;
  sortCode: string | null;
  routingNumber: string | null;
  bic: string | null;
  agentName: string | null;
  country: string | null;
  address: string | null;
  structuredAddress: StructuredAddress | null;
}

/** The FULL payment-instruction row the deployed API returns — the payment fields the subset lacks. */
export interface PaymentInstructionDetailDto {
  externalId: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  valueDate: string;
  direction: 'Outgoing' | 'Incoming';
  chargeBearer: ChargeBearer;
  debtor: CounterpartyDetail;
  creditor: CounterpartyDetail;
  rail: PaymentRail;
  railExplanation: string | null;
  preferInstant: boolean;
  remittanceInfo: string | null;
  remittanceKind: 'Unstructured' | 'Structured';
  purposeCode: string | null;
  creditorReference: string | null;
  isCrossCurrency: boolean;
  settlementCurrency: string | null;
  fxRate: number | null;
  settlementAmount: number | null;
  fxMargin: number | null;
  screeningDecision: ScreeningDecision;
  screeningScore: number;
  screeningMatchedName: string | null;
  screeningListSource: string | null;
  screeningReason: string | null;
  duplicateAcknowledged: boolean;
  allowedTransitions: string[];
}

export interface PagedDetail {
  items: PaymentInstructionDetailDto[];
  totalCount: number;
}

/** `VelocityUsage` (P-PAY-8) — the headroom envelope the list screen reads. */
export interface VelocityUsage {
  currency: string;
  windowHours: number;
  tenantAmountUsed: number;
  tenantCountUsed: number;
  userAmountUsed: number;
  userCountUsed: number;
  tenantDailyAmountCap: number | null;
  tenantDailyCountCap: number | null;
  userDailyAmountCap: number | null;
  userDailyCountCap: number | null;
}

/** A tenant has a cap iff at least one of the four cap fields is set — the indicator's own gate. */
export function hasAnyCap(usage: VelocityUsage): boolean {
  return (
    usage.tenantDailyAmountCap !== null ||
    usage.tenantDailyCountCap !== null ||
    usage.userDailyAmountCap !== null ||
    usage.userDailyCountCap !== null
  );
}

// ───────────────────────────────────────────────── deterministic DEMO-tenant corridor fixtures
//
// 🔴 MEASURED against staging 2026-08-04 (`GET /payment-instructions?search=<ref>` → exactly one
// row). These are the `ZC-2026-*` "corridor showcase" instructions, deliberately covering every
// rail, a screening hold, a cross-currency payment and both non-IBAN account types — the whole
// point of the seed. Assertions key off the immutable `reference`, never a row index or a global
// count (the tenant is shared and append-only; see `zygosTag` in zygos-helpers).
export const CORRIDOR = {
  sepaInstant: { ref: 'ZC-2026-0000001', rail: 'SepaInstant' as PaymentRail },
  sepaStructured: { ref: 'ZC-2026-0000002', rail: 'Sepa' as PaymentRail },
  fasterPayments: { ref: 'ZC-2026-0000003', rail: 'FasterPayments' as PaymentRail },
  ach: { ref: 'ZC-2026-0000004', rail: 'Ach' as PaymentRail },
  swiftDebtorFees: { ref: 'ZC-2026-0000005', rail: 'Swift' as PaymentRail },
  swiftCreditorFees: { ref: 'ZC-2026-0000006', rail: 'Swift' as PaymentRail },
  crossCurrency: { ref: 'ZC-2026-0000007', rail: 'Swift' as PaymentRail },
  screeningHold: { ref: 'ZC-2026-0000008', rail: 'Sepa' as PaymentRail },
} as const;

/** The human rail labels the badge renders (finreg-web `instructions.rail.<Rail>`). */
export const RAIL_LABEL: Record<PaymentRail, string> = {
  Sepa: 'SEPA',
  SepaInstant: 'SEPA Instant',
  FasterPayments: 'Faster Payments',
  Ach: 'ACH',
  Swift: 'SWIFT',
};

// ───────────────────────────────────────────────────────── form + surface testIDs (literals)
//
// The per-field form ids are NOT in finreg-web's central registry — they are built from the
// `testIdPrefix` each <PartyFieldset> is handed (`instruction-form-debtor` / `-creditor`) and from
// literal strings inside <CrossCurrencyFields> / <RemittanceFields> / <InstructionCoreFields>. So,
// like the existing CONSOLE_TEST_IDS, they live here. The registry ids (screening/velocity/etc.)
// are mirrored in E2ETests/shared/testIds.ts (the `ZYGOS_*` block) as the parity record.
const creditor = 'instruction-form-creditor';
export const PAYMENT_FORM_IDS = {
  screen: 'zygos-instruction-form-screen',
  submit: 'zygos-instruction-form-submit',
  creditorAccountType: `${creditor}-accountType`,
  creditorIban: `${creditor}-iban`,
  creditorBic: `${creditor}-bic`,
  creditorSortCode: `${creditor}-sortCode`,
  creditorRoutingNumber: `${creditor}-routingNumber`,
  creditorAccountNumber: `${creditor}-accountNumber`,
  creditorName: `${creditor}-name`,
  amount: 'instruction-form-amount',
  crossCurrencyToggle: 'instruction-form-cross-currency',
  settlementCurrency: 'instruction-form-settlement-currency',
  fxRate: 'instruction-form-fx-rate',
  settlementAmount: 'instruction-form-settlement-amount',
} as const;

export const SCREEN_IDS = {
  shell: 'zygos-app-shell',
  instructions: 'zygos-instructions-screen',
  velocityUsage: 'zygos-instructions-velocity-usage',
  detail: 'zygos-instruction-detail-screen',
  screeningBadge: 'zygos-screening-badge',
  screeningOverride: 'zygos-screening-override',
} as const;

/** `${accountType-testid}-option-<Value>` — the ModalDropdown option, same shape as the currency box. */
export const accountTypeOption = (fieldTestId: string, value: BankAccountType): string =>
  `${fieldTestId}-option-${value}`;

/** The per-row rail badge on the list (`instruction-rail-<externalId>`). */
export const railRowBadgeId = (externalId: string): string => `instruction-rail-${externalId}`;

/** The rail badge on the detail header (`instruction-detail-rail-<externalId>`). */
export const railDetailBadgeId = (externalId: string): string => `instruction-detail-rail-${externalId}`;

// ─────────────────────────────────────────────────────────────────────────── @api helpers
/** Look one corridor row up by its immutable reference. THROWS if the seed row is missing. */
export async function findByReference(
  session: ZygosSession,
  reference: string,
): Promise<PaymentInstructionDetailDto> {
  const res = await session.context.get(
    `${ZYGOS_API_PREFIX}/payment-instructions?search=${encodeURIComponent(reference)}&pageSize=5`,
  );
  expect(res.status(), `list?search=${reference} failed (HTTP ${res.status()})`).toBe(200);
  const body = await bodyJson<PagedDetail>(res);
  const row = (body?.items ?? []).find((i) => i.reference === reference);
  expect(
    row,
    `seed row ${reference} is missing on staging — the ZC-2026 corridor showcase must be re-seeded ` +
      `(demo tenant). This is a seed/env problem, not a UI assertion to weaken.`,
  ).toBeTruthy();
  return row as PaymentInstructionDetailDto;
}

/** `GET /payment-instructions/limits/usage?currency=` — the P-PAY-8 headroom envelope. */
export async function getVelocityUsage(session: ZygosSession, currency: string): Promise<VelocityUsage> {
  const res = await session.context.get(
    `${ZYGOS_API_PREFIX}/payment-instructions/limits/usage?currency=${encodeURIComponent(currency)}`,
  );
  expect(res.status(), `velocity usage for ${currency} failed (HTTP ${res.status()})`).toBe(200);
  return (await res.json()) as VelocityUsage;
}

// ─────────────────────────────────────────────────────────────────────────── @ui helpers
/** The demo user's real, server-issued session cookies, ready to inject into a browser context. */
async function demoCookies(session: ZygosSession): Promise<Awaited<ReturnType<ZygosSession['context']['storageState']>>['cookies']> {
  const state = await session.context.storageState();
  return state.cookies;
}

/**
 * Enter the console as the DEMO user (the tenant that owns the ZC-2026 corridor rows) and wait for
 * the shell. Returns null when the console/demo is unreachable — a legitimate `test.skip` reason,
 * exactly like `loginAsDemo`. Mirrors `enterConsole`, but for the seeded-data tenant.
 */
export async function enterConsoleAsDemo(page: Page, path = '/'): Promise<ZygosSession | null> {
  const session = await loginAsDemo();
  if (!session) return null;

  const cookies = await demoCookies(session);
  expect(cookies.length, 'no session cookie could be minted for the demo user').toBeGreaterThan(0);
  await page.context().clearCookies();
  await page.context().addCookies(cookies);

  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(SCREEN_IDS.shell))).toBeVisible({ timeout: 30_000 });
  return session;
}

/** Navigate within an already-entered console and wait for `screenTestId`. */
export async function gotoScreen(page: Page, path: string, screenTestId: string): Promise<void> {
  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(screenTestId))).toBeVisible({ timeout: 30_000 });
}

/** `[data-testid="x"]` — re-exported so specs need only import from here. */
export { id };

/** The deployed console origin under test (default staging). */
export { ZYGOS_WEB_URL };
