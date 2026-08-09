// FINREG master console — the new master PAGES @ui (#190).
//
// #190 gave the master four pages beyond the Portfolio home: a cross-merchant Approvals queue, a
// Reporting roll-up (currency + status charts + per-merchant table), an impersonation Audit log, and a
// route guard that keeps a master (no merchant selected) off the operational routes. This file proves
// each of those RENDERS; the wire behind them is proven in `zygos-master-console.spec.ts` (@api).
//
// Split out of `zygos-master-console.ui.spec.ts` on the 300-line cap — that file owns login + Portfolio
// + shell mode; this owns the four pages + the guard. Sessions are REAL server-issued cookies injected
// into the browser context. The Audit test mints ONE bounded, auto-expiring impersonation grant so a
// row is guaranteed to exist — the same self-cleaning write the @api tier makes (nothing to delete).
import { expect, test } from '@playwright/test';

import { jsonCsrfHeaders } from './zygos-helpers.js';
import {
  MASTER_IDS,
  MASTER_ROUTES,
  MERCHANTS,
  ZYGOS_API_PREFIX,
  approvalOpenId,
  enterConsoleAs,
  id,
  masterAccount,
  openId,
  resolveDemoAccounts,
  sessionFor,
} from './zygos-master.js';

import type { DemoAccount, MasterApproval } from './zygos-master.js';
import type { ZygosSession } from './zygos-session.js';

/** The browser-form instruction-detail route (the `(protected)` group segment is stripped in the URL). */
const instructionPath = (externalId: string): string => `/instructions/${externalId}`;

const DESKTOP = { width: 1280, height: 900 };
const SKIP_REASON = 'Zygos console unreachable or demo accounts not published';
const REVEAL_TIMEOUT_MS = 30_000;
const GRANT_DURATION_MINUTES = 60;

test.describe('FINREG master pages @zygos-ui @ui', () => {
  let accounts: DemoAccount[];
  let master: ZygosSession | null;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    accounts = await resolveDemoAccounts();
    master = await sessionFor(masterAccount(accounts));
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(DESKTOP);
  });

  test('the Approvals page renders the cross-merchant queue', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.approvals);
    await expect(page.locator(id(MASTER_IDS.approvalsScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    // The queue table renders and carries rows from more than one merchant (it is the whole subtree).
    const table = page.locator(id(MASTER_IDS.approvalsTable));
    await expect(table).toBeVisible();
    await expect(table).toContainText(MERCHANTS[0].name);
    await expect(table).toContainText(MERCHANTS[1].name);
  });

  test('an Approvals Open ▸ deep-links to the instruction detail, NOT /modules (#190)', async ({ page }) => {
    test.skip(!master, SKIP_REASON);

    // Read the queue on the wire first, so the test knows a REAL externalId to click and to assert in
    // the destination URL (the row testID + the deep-link both key off it). No write here.
    const res = await (master as ZygosSession).context.get(`${ZYGOS_API_PREFIX}/portfolio/approvals`);
    expect(res.ok(), 'the approvals queue must be readable to drive this test').toBe(true);
    const items = ((await res.json()) as { items: MasterApproval[] }).items;
    expect(items.length, 'the seeded subtree must have a pending approval to open').toBeGreaterThan(0);
    const first = items[0];

    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.approvals);
    await expect(page.locator(id(MASTER_IDS.approvalsTable))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    // Click that row's Open ▸ — it must impersonate the owning merchant AND deep-link to the instruction.
    await page.locator(id(approvalOpenId(first.externalId))).click();

    // THE REGRESSION: the URL becomes the instruction detail route — never /modules, never stuck on the
    // approvals queue. (The pre-#190/048c6d3 bug hung on /master/approvals or bounced to /modules.)
    await expect(page).toHaveURL(new RegExp(`${instructionPath(first.externalId)}(?:$|[/?#])`), {
      timeout: REVEAL_TIMEOUT_MS,
    });
    expect(page.url(), 'the Approvals Open ▸ must NOT land on the /modules catalogue').not.toContain('/modules');

    // Operating mode is active — the banner names the merchant that owns the instruction (#187).
    const banner = page.locator(id(MASTER_IDS.impersonationBanner));
    await expect(banner).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(banner).toContainText(first.tenantName);

    // Exit returns to the master console (the Portfolio home), leaving Operating mode.
    await page.locator(id(MASTER_IDS.impersonationExit)).click();
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(banner).toBeHidden();
  });

  test('a Portfolio Open ▸ lands on the merchant home /modules, not an item (#190 regression)', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    const acme = MERCHANTS[0];

    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.portfolio);
    await expect(page.locator(id(openId(acme.id)))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    await page.locator(id(openId(acme.id))).click();

    // A plain merchant open has no specific item, so it lands on the merchant HOME — the module
    // catalogue — NOT a deep link. This is the case the Approvals deep-link must NOT regress.
    await expect(page.locator(id(MASTER_IDS.moduleCatalog))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    expect(page.url(), 'a Portfolio Open ▸ lands on /modules').toContain('/modules');
    expect(page.url(), 'a Portfolio Open ▸ is NOT a deep link to an instruction').not.toContain('/instructions/');
    await expect(page.locator(id(MASTER_IDS.impersonationBanner))).toBeVisible();
  });

  test('the Reporting page renders the currency + status charts and the per-merchant table', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.reporting);
    await expect(page.locator(id(MASTER_IDS.reportingScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    await expect(page.locator(id(MASTER_IDS.reportingCurrencyChart))).toBeVisible();
    await expect(page.locator(id(MASTER_IDS.reportingStatusChart))).toBeVisible();

    const table = page.locator(id(MASTER_IDS.reportingMerchantsTable));
    await expect(table).toBeVisible();
    for (const merchantTenant of MERCHANTS) {
      await expect(table).toContainText(merchantTenant.name);
    }
  });

  test('the Audit page renders the impersonation history after an impersonation', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    const acme = MERCHANTS[0];

    // Guarantee a row: mint one bounded, auto-expiring grant (self-cleaning — it ages out on its own).
    const mint = await (master as ZygosSession).context.post(`${ZYGOS_API_PREFIX}/platform/impersonation`, {
      headers: jsonCsrfHeaders(),
      data: { targetTenantId: acme.id, reason: 'E2E #190 audit render', durationMinutes: GRANT_DURATION_MINUTES },
    });
    expect(mint.ok(), 'the master can mint a grant to guarantee an audit row').toBe(true);

    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.audit);
    await expect(page.locator(id(MASTER_IDS.auditScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    const table = page.locator(id(MASTER_IDS.auditTable));
    await expect(table).toBeVisible();
    // The just-minted grant names the merchant it targeted — the table shows it by NAME (#187).
    await expect(table).toContainText(acme.name);
    // The empty-state must NOT show when there is history.
    await expect(page.locator(id(MASTER_IDS.auditEmpty))).toHaveCount(0);
  });

  test('an operational route is route-guarded back to the master Portfolio (#190)', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    // A master with no merchant selected cannot reach an operational route by hand-typing it — the
    // ConsoleModeGuard sends it back to the Portfolio home. `/instructions` is a real operational route
    // (unlike `/payments`, which is not a route at all and 404s), so it exercises the guard, not the 404.
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.portfolio);
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    await page.goto(MASTER_ROUTES.instructions, { waitUntil: 'commit' });
    // The guard redirects to the Portfolio — the master home renders, not the operational screen.
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
  });
});
