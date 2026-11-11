import { expect, test } from '@playwright/test';

import {
  MASTER_IDS,
  MASTER_ROUTES,
  MASTER_TENANT,
  ZYGOS_API_PREFIX,
  enterConsoleAs,
  id,
  masterAccount,
  resolveDemoAccounts,
  sessionFor,
} from './zygos-master.js';

import type { PortfolioTenant } from './zygos-master.js';
import type { ZygosSession } from './zygos-session.js';
import type { Page } from '@playwright/test';

interface ReportTenant extends PortfolioTenant {
  readonly failedCount: number;
}

interface ExpectedRow {
  readonly tenantId: string;
  readonly total: string;
  readonly pending: string;
  readonly failed: string;
}

const DESKTOP = { width: 1280, height: 800 };
const SKIP_REASON = 'FinReg console unreachable or demo accounts not published';
const REVEAL_TIMEOUT_MS = 30_000;
const TABLE = MASTER_IDS.reportingMerchantsTable;
const HEAD = 'ui-data-table-head';
const ROW_ID_PATTERN = `^${TABLE}-row-([0-9a-f-]{36})$`;

async function readSummary(master: ZygosSession): Promise<ReportTenant[]> {
  const res = await master.context.get(`${ZYGOS_API_PREFIX}/portfolio/summary`);
  expect(res.ok(), `GET /portfolio/summary answered ${String(res.status())}`).toBe(true);
  return ((await res.json()) as { tenants: ReportTenant[] }).tenants;
}

function pendingDescThenName(a: ReportTenant, b: ReportTenant): number {
  if (b.pendingApprovalCount !== a.pendingApprovalCount) return b.pendingApprovalCount - a.pendingApprovalCount;
  return (a.name ?? a.tenantId).localeCompare(b.name ?? b.tenantId);
}

async function renderedRowIds(page: Page): Promise<string[]> {
  return page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    return [...document.querySelectorAll('[data-testid]')]
      .map((el) => re.exec(el.getAttribute('data-testid') ?? '')?.[1])
      .filter((tenantId): tenantId is string => tenantId !== undefined);
  }, ROW_ID_PATTERN);
}

async function headerTexts(page: Page): Promise<string[]> {
  const head = page.locator(`${id(TABLE)} ${id(HEAD)}`);
  return head.evaluate((el) => [...el.children].map((c) => (c.textContent ?? '').trim()).filter((t) => t !== ''));
}

async function renderedRow(page: Page, tenantId: string): Promise<ExpectedRow> {
  const cell = async (key: string): Promise<string> =>
    (await page.locator(id(`${TABLE}-row-${tenantId}-${key}`)).innerText()).trim();
  return { tenantId, total: await cell('total'), pending: await cell('pending'), failed: await cell('failed') };
}

test.describe('FINREG-REPORT-1 master reporting characterization @zygos-ui @ui', () => {
  test('AC7 master opens /master/reporting at 1280x800, both donuts and the merchant table match today, own tenant hidden', async ({ page }) => {
    test.setTimeout(150_000);
    const master = await sessionFor(masterAccount(await resolveDemoAccounts()));
    test.skip(!master, SKIP_REASON);
    await page.setViewportSize(DESKTOP);
    const tenants = await readSummary(master!);
    expect(tenants.map((t) => t.tenantId), 'the wire still returns the master tenant, so its absence below is a UI rule')
      .toContain(MASTER_TENANT.id);
    const merchants = tenants.filter((t) => t.tenantId !== MASTER_TENANT.id).sort(pendingDescThenName);
    const expectedRows: ExpectedRow[] = merchants.map((t) => ({
      tenantId: t.tenantId,
      total: String(t.totalCount),
      pending: String(t.pendingApprovalCount),
      failed: String(t.failedCount),
    }));
    const expectedHeaders = ['Merchant', 'Payments', 'Pending', 'Failed'];

    await enterConsoleAs(page, master!, MASTER_ROUTES.reporting);

    await expect(page.locator(id(MASTER_IDS.reportingScreen)), 'reporting screen did not render').toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(page.locator(id(MASTER_IDS.reportingCurrencyChart)), 'currency donut missing').toBeVisible();
    await expect(page.locator(id(MASTER_IDS.reportingStatusChart)), 'status donut missing').toBeVisible();
    await expect(page.locator(id(TABLE)), 'merchants table missing').toBeVisible();
    expect(await headerTexts(page), 'merchant table columns changed').toEqual(expectedHeaders);
    const rowIds = await renderedRowIds(page);
    expect(rowIds, 'the master own tenant must stay hidden').not.toContain(MASTER_TENANT.id);
    expect(rowIds, 'rows are not sorted pending desc, then name').toEqual(expectedRows.map((r) => r.tenantId));
    const rendered = await Promise.all(rowIds.map(async (tenantId) => renderedRow(page, tenantId)));
    expect(rendered, 'Payments / Pending / Failed cells differ from /portfolio/summary').toEqual(expectedRows);
  });
});
