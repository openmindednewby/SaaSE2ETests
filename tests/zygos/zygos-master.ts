// FINREG master console (#177/#189) — the master/merchant helper shared by the @api and @ui tiers.
//
// This is the master-account analogue of `zygos-payments.ts`'s `enterConsoleAsDemo`: it resolves the
// PUBLISHED demo accounts from `/bff/config` (never hardcodes a password, so a rotation can't turn the
// tier red against a healthy deployment — same rule `loginAsDemo` follows), mints a real server session
// for each, and injects the session cookie into a browser context for the @ui specs.
//
// The testID literals below MIRROR finreg-web `src/shared/testIds.ts` (master console + impersonation)
// and `@dloizides/auth-web`'s `AuthTestIds` (the public-demo credentials panel, `zygos-` prefixed on
// this product). They also live in `E2ETests/shared/testIds.ts` as the parity record; they are repeated
// here as raw strings because the whole zygos suite reads its ids co-located with the specs (see the
// `CONSOLE_TEST_IDS` convention in `zygos-console-ui.ts`).
import { expect } from '@playwright/test';

import { ZYGOS_API_PREFIX, ZYGOS_WEB_URL } from './zygos-helpers.js';
import { anonymousContext, loginAs } from './zygos-session.js';

import type { Page } from '@playwright/test';
import type { ZygosSession } from './zygos-session.js';

/** `[data-testid="x"]` — the selector form the rest of the zygos @ui suite uses. */
export const id = (testId: string): string => `[data-testid="${testId}"]`;

/**
 * Master console + impersonation ids (#177/#190) — mirror of finreg-web `TestIds`.
 *
 * #190 turned the single master "overview" into a mode-based shell with five master pages, so the old
 * `zygos-master-overview-screen` id is gone (the Portfolio home is now `zygos-master-portfolio-screen`)
 * and four more pages + their tables/charts joined it. These mirror finreg-web `src/shared/testIds.ts`
 * (Master console block) and the shared ui-nav rail (nav-group-* headers, `nav-guide`).
 */
export const MASTER_IDS = {
  shell: 'zygos-app-shell',
  moduleCatalog: 'zygos-module-catalog-screen',
  resetDemoButton: 'zygos-reset-demo-button',

  // Master-mode nav leaves (the section keys ARE the testIDs). Guide reuses the shared `nav-guide`.
  navPortfolio: 'zygos-master-nav-portfolio',
  navMerchants: 'zygos-master-nav-merchants',
  navApprovals: 'zygos-master-nav-approvals',
  navReporting: 'zygos-master-nav-reporting',
  navAudit: 'zygos-master-nav-audit',
  navGuide: 'nav-guide',

  // Operational module GROUP headers — present for a merchant, ABSENT in master mode (asserted).
  navGroupCrm: 'nav-group-crm',
  navGroupAccounting: 'nav-group-accounting',
  navGroupPayments: 'nav-group-payments',

  // Portfolio (master home) — own tenant excluded.
  portfolioScreen: 'zygos-master-portfolio-screen',
  overviewEmpty: 'zygos-master-overview-empty',
  cardPrefix: 'zygos-master-merchant-card',
  openPrefix: 'zygos-master-merchant-open',

  // Merchants page.
  merchantsScreen: 'zygos-master-merchants-screen',
  merchantsTable: 'zygos-master-merchants-table',
  merchantsEmpty: 'zygos-master-merchants-empty',
  detailsPrefix: 'zygos-master-merchant-details',
  detailModal: 'zygos-master-merchant-detail-modal',
  detailClose: 'zygos-master-merchant-detail-close',

  // Approvals page — cross-merchant pending queue (read-only).
  approvalsScreen: 'zygos-master-approvals-screen',
  approvalsTable: 'zygos-master-approvals-table',
  approvalsEmpty: 'zygos-master-approvals-empty',
  approvalsTruncated: 'zygos-master-approvals-truncated',
  approvalOpenPrefix: 'zygos-master-approval-open',

  // Reporting page — currency + status charts + per-merchant table.
  reportingScreen: 'zygos-master-reporting-screen',
  reportingEmpty: 'zygos-master-reporting-empty',
  reportingCurrencyChart: 'zygos-master-reporting-currency-chart',
  reportingStatusChart: 'zygos-master-reporting-status-chart',
  reportingMerchantsTable: 'zygos-master-reporting-merchants-table',

  // Audit page — impersonation history, newest first.
  auditScreen: 'zygos-master-audit-screen',
  auditTable: 'zygos-master-audit-table',
  auditEmpty: 'zygos-master-audit-empty',

  // The persistent "Operating as <merchant>" banner + its Exit control.
  impersonationBanner: 'zygos-impersonation-banner',
  impersonationExit: 'zygos-impersonation-exit',
} as const;

/** The master-mode routes (browser form). */
export const MASTER_ROUTES = {
  portfolio: '/master',
  merchants: '/master/merchants',
  approvals: '/master/approvals',
  reporting: '/master/reporting',
  audit: '/master/audit',
  /** An operational route — a master hand-typing this is route-guarded back to the Portfolio (#190). */
  instructions: '/instructions',
  modules: '/modules',
} as const;

/** A merchant "Details" action id derives from the prefix + the tenant id. */
export const detailsId = (tenantId: string): string => `${MASTER_IDS.detailsPrefix}-${tenantId}`;
/** An Approvals-row "Open ▸" id derives from the prefix + the row's externalId (mirrors source). */
export const approvalOpenId = (externalId: string): string => `${MASTER_IDS.approvalOpenPrefix}-${externalId}`;

/** Public-demo credential panel ids — mirror of `@dloizides/auth-web` `AuthTestIds`, `zygos-` prefixed. */
export const DEMO_CRED_IDS = {
  hint: 'zygos-auth-demo-credentials-hint',
  toggle: 'zygos-auth-demo-credentials-toggle',
  accountLabel: 'zygos-auth-demo-credentials-account-label',
  username: 'zygos-auth-demo-credentials-username',
  password: 'zygos-auth-demo-credentials-password',
  use: 'zygos-auth-demo-credentials-use',
} as const;

/** A card / open-button id derives from the prefix + the tenant id. */
export const cardId = (tenantId: string): string => `${MASTER_IDS.cardPrefix}-${tenantId}`;
export const openId = (tenantId: string): string => `${MASTER_IDS.openPrefix}-${tenantId}`;
/** Per-account demo-row ids get the account's index suffixed (`-0`, `-1`) when >1 account is published. */
export const accountLabelId = (index: number): string => `${DEMO_CRED_IDS.accountLabel}-${String(index)}`;
export const usernameId = (index: number): string => `${DEMO_CRED_IDS.username}-${String(index)}`;
export const useId = (index: number): string => `${DEMO_CRED_IDS.use}-${String(index)}`;

/**
 * The materialised demo hierarchy (#177/#190). The master's OWN tenant carries no payment book; the
 * three merchants beneath it do. Ids drive the card/open selectors; the merchant `name`s are the #187
 * assertion (a name rather than a raw GUID is the whole point of that fix).
 *
 * The master's own tenant is still returned by `/portfolio/summary` (the endpoint returns the whole
 * subtree) but #190 EXCLUDES it from every rendered list — so its id is used here to assert ABSENCE of
 * a self-card, and its name is deliberately NOT asserted. (Its wire name is still "FINREG Master EMI":
 * `DemoTreeSeeder` is create-only, so the `bbc3b29` EMI→"FINREG Master" rename never touched the
 * existing row — which is exactly why the own card MUST be excluded rather than relabelled.)
 */
export const MASTER_TENANT = { id: 'd0000004-0000-4000-a000-000000000004' } as const;
export const MERCHANTS = [
  { id: '7fa9403d-3478-4cbe-8b67-98dc28854a25', name: 'Acme Pay' },
  { id: 'd0000005-0000-4000-a000-000000000005', name: 'Nordic FX' },
  { id: 'd0000006-0000-4000-a000-000000000006', name: 'Volta' },
] as const;

/** The short-id GUID fallback the UI shows ONLY when a name is absent — asserted to be ABSENT here. */
const SHORT_ID_LENGTH = 8;
export function shortId(tenantId: string): string {
  return tenantId.slice(0, SHORT_ID_LENGTH).toUpperCase();
}

/** One published demo account, as `/bff/config` serves it. */
export interface DemoAccount {
  label: string;
  username: string;
  password: string;
}

/** One tenant's portfolio roll-up (subset of the wire the master overview renders). */
export interface PortfolioTenant {
  tenantId: string;
  name: string | null;
  lines: readonly { status: string; currency: string; count: number; totalAmount: number }[];
  totalCount: number;
  pendingApprovalCount: number;
}
export interface PortfolioSummary {
  tenants: readonly PortfolioTenant[];
  tenantsResolved: number;
}
/** One row of the cross-merchant approvals queue (`GET /portfolio/approvals`, #190). */
export interface MasterApproval {
  externalId: string;
  tenantId: string;
  tenantName: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  makerUserId?: string;
  beneficiaryName?: string;
}

/** One row of the impersonation audit log (`GET /platform/impersonation/audit`, #190). */
export interface MasterAuditRow {
  actorUserId: string;
  actorTenantId: string;
  targetTenantId: string;
  targetTenantName: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
  durationMinutes: number;
}

/** The grant `POST /platform/impersonation` returns. */
export interface ImpersonationGrant {
  grantId: string;
  targetTenantId: string;
  token: string;
  expiresAt: string;
}

const CONFIG_TIMEOUT_MS = 20_000;

/**
 * Resolve the PUBLISHED demo accounts from `/bff/config`. Empty when the console is unreachable or no
 * demo block is published — both legitimate `test.skip` reasons (matches `loginAsDemo`).
 */
export async function resolveDemoAccounts(): Promise<DemoAccount[]> {
  const anon = await anonymousContext();
  try {
    const res = await anon.get('/bff/config', { timeout: CONFIG_TIMEOUT_MS });
    if (!res.ok()) return [];
    const config = (await res.json()) as { demo: { publishedAccounts?: DemoAccount[] } | null };
    return config.demo?.publishedAccounts ?? [];
  } catch {
    return [];
  } finally {
    await anon.dispose();
  }
}

function pick(accounts: readonly DemoAccount[], matcher: RegExp): DemoAccount | undefined {
  return accounts.find((a) => matcher.test(a.label) || matcher.test(a.username));
}

/** The master/reseller account (label or username mentions "master"). */
export function masterAccount(accounts: readonly DemoAccount[]): DemoAccount | undefined {
  return pick(accounts, /master/i);
}
/** The merchant account (label "Merchant" or the seeded `demo` username). */
export function merchantAccount(accounts: readonly DemoAccount[]): DemoAccount | undefined {
  return pick(accounts, /merchant|^demo$/i);
}

/**
 * A REAL, server-issued session for one published account, reusing the shared session cache/park so the
 * whole tier shares one login per user (5 logins/60s per IP — see `zygos-session.ts`). Null when the
 * account is absent or the credentials are rejected.
 */
export async function sessionFor(account: DemoAccount | undefined): Promise<ZygosSession | null> {
  if (!account) return null;
  return loginAs(account.username, account.password);
}

const SHELL_TIMEOUT_MS = 30_000;

async function injectSession(page: Page, session: ZygosSession): Promise<void> {
  const state = await session.context.storageState();
  expect(state.cookies.length, 'no session cookie could be injected for the console').toBeGreaterThan(0);
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
}

/**
 * Enter the authenticated console under `session` at `path` and wait for the shell — the readiness
 * signal (it renders only behind the protected-route guard, so nothing to poll and no sleep).
 */
export async function enterConsoleAs(page: Page, session: ZygosSession, path = '/'): Promise<void> {
  await injectSession(page, session);
  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(MASTER_IDS.shell))).toBeVisible({ timeout: SHELL_TIMEOUT_MS });
}

/** Navigate within an already-entered console and wait for `screenTestId` to render. */
export async function gotoScreen(page: Page, path: string, screenTestId: string): Promise<void> {
  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(screenTestId))).toBeVisible({ timeout: SHELL_TIMEOUT_MS });
}

/** The BFF prefix + origin, re-exported so specs import everything master-related from here. */
export { ZYGOS_API_PREFIX, ZYGOS_WEB_URL };
