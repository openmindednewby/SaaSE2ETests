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

/** Master console + impersonation ids (#177) — mirror of finreg-web `TestIds`. */
export const MASTER_IDS = {
  shell: 'zygos-app-shell',
  overviewScreen: 'zygos-master-overview-screen',
  overviewEmpty: 'zygos-master-overview-empty',
  cardPrefix: 'zygos-master-merchant-card',
  openPrefix: 'zygos-master-merchant-open',
  impersonationBanner: 'zygos-impersonation-banner',
  impersonationExit: 'zygos-impersonation-exit',
  moduleCatalog: 'zygos-module-catalog-screen',
  resetDemoButton: 'zygos-reset-demo-button',
} as const;

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
 * The materialised demo hierarchy (#177). The master's OWN tenant carries no payment book; the three
 * merchants beneath it do. Ids drive the card/open selectors; names are the #187 assertion (a name here
 * rather than a raw GUID is the whole point of the fix).
 */
export const MASTER_TENANT = { id: 'd0000004-0000-4000-a000-000000000004', name: 'FINREG Master EMI' } as const;
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
