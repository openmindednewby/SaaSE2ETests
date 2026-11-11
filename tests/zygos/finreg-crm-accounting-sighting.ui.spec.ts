import fs from 'fs';
import path from 'path';

import { expectTextFits } from '@dloizides/game-e2e';
import { devices, expect, test } from '@playwright/test';

import {
  MASTER_IDS,
  MASTER_ROUTES,
  MERCHANTS,
  ZYGOS_WEB_URL,
  enterConsoleAs,
  id,
  masterAccount,
  openId,
  resolveDemoAccounts,
  sessionFor,
} from './zygos-master.js';

import type { BrowserContext, Page } from '@playwright/test';
import type { ZygosSession } from './zygos-session.js';

interface RouteSpec {
  readonly module: 'crm' | 'accounting';
  readonly name: string;
  readonly path: string;
  readonly screen: string;
  readonly rowPrefix?: string;
  readonly rowSuffix?: string;
  readonly recordScreens?: readonly string[];
  readonly createButton?: string;
  readonly createScreen?: string;
}

const CONTACT_ROW = 'zygos-contacts-table-row-';
const CONTACT_RECORD = 'zygos-contact-detail-screen';
const DEAL_RECORD = 'zygos-deal-detail-screen';
const CONTACT_CREATE = { createButton: 'zygos-contacts-new', createScreen: 'zygos-contact-form-screen' } as const;

const ROUTES: readonly RouteSpec[] = [
  { module: 'crm', name: 'dashboard', path: '/crm/dashboard', screen: 'zygos-crm-dashboard-screen' },
  {
    module: 'crm', name: 'contacts', path: '/crm/contacts', screen: 'zygos-contacts-screen',
    rowPrefix: CONTACT_ROW, recordScreens: [CONTACT_RECORD], ...CONTACT_CREATE,
  },
  {
    module: 'crm', name: 'people', path: '/crm/people', screen: 'zygos-crm-people-screen',
    rowPrefix: CONTACT_ROW, recordScreens: [CONTACT_RECORD], ...CONTACT_CREATE,
  },
  {
    module: 'crm', name: 'organizations', path: '/crm/organizations', screen: 'zygos-crm-organizations-screen',
    rowPrefix: CONTACT_ROW, recordScreens: [CONTACT_RECORD], ...CONTACT_CREATE,
  },
  {
    module: 'crm', name: 'deals', path: '/crm/deals', screen: 'zygos-deals-screen',
    rowPrefix: 'zygos-deal-card-', rowSuffix: '-title', recordScreens: [DEAL_RECORD],
    createButton: 'zygos-deals-new', createScreen: 'zygos-deal-form-screen',
  },
  {
    module: 'crm', name: 'tasks', path: '/crm/tasks', screen: 'zygos-tasks-screen',
    rowPrefix: 'zygos-tasks-table-row-', recordScreens: ['zygos-task-form-screen'],
    createButton: 'zygos-tasks-new', createScreen: 'zygos-task-form-screen',
  },
  {
    module: 'crm', name: 'activities', path: '/crm/activities', screen: 'zygos-activities-screen',
    rowPrefix: 'zygos-activities-table-row-', recordScreens: [CONTACT_RECORD, DEAL_RECORD],
  },
  {
    module: 'crm', name: 'segments', path: '/crm/segments', screen: 'zygos-segments-screen',
    rowPrefix: 'zygos-segment-card-open-', recordScreens: ['zygos-segment-detail-screen'],
    createButton: 'zygos-segments-new', createScreen: 'zygos-segment-form-screen',
  },
  {
    module: 'accounting', name: 'chart-of-accounts', path: '/accounting/accounts', screen: 'zygos-accounts-screen',
    rowPrefix: 'zygos-accounts-table-row-', recordScreens: ['zygos-account-detail-screen'],
    createButton: 'zygos-accounts-new', createScreen: 'zygos-account-form-screen',
  },
  {
    module: 'accounting', name: 'journals', path: '/accounting/journals', screen: 'zygos-journals-screen',
    rowPrefix: 'zygos-journals-table-row-', recordScreens: ['zygos-journal-detail-screen'],
  },
  { module: 'accounting', name: 'post-entry', path: '/accounting/journal-entries/new', screen: 'zygos-post-journal-screen' },
  { module: 'accounting', name: 'trial-balance', path: '/accounting/trial-balance', screen: 'zygos-trial-balance-screen' },
  { module: 'accounting', name: 'profit-and-loss', path: '/accounting/profit-and-loss', screen: 'zygos-profit-and-loss-screen' },
  { module: 'accounting', name: 'balance-sheet', path: '/accounting/balance-sheet', screen: 'zygos-balance-sheet-screen' },
  { module: 'accounting', name: 'cash-flow', path: '/accounting/cash-flow', screen: 'zygos-cash-flow-screen' },
  { module: 'accounting', name: 'opening-balances', path: '/accounting/opening-balances', screen: 'zygos-opening-balances-screen' },
  { module: 'accounting', name: 'periods', path: '/accounting/periods', screen: 'zygos-periods-screen' },
];

const VIEWPORTS = [
  { label: '360x640', device: { ...devices['Galaxy S5'], viewport: { width: 360, height: 640 } } },
  { label: '1280x800', device: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
] as const;

const VISIBLE_TEXT = 'body *:not([id^="a11y-hint-"])';
const SCREEN_TIMEOUT_MS = 30_000;
const HTTP_ERROR_FLOOR = 400;
const TEXT_FIT_LINES_KEPT = 6;
const SHOT_DIR = process.env.SIGHTING_DIR ?? path.join('test-results', 'finreg-crm-accounting-sighting');
const SKIP_REASON = 'FinReg console unreachable or demo accounts not published';
const ACME = MERCHANTS[0];

interface Problems {
  console: string[];
  bff: string[];
}

function watch(page: Page): Problems {
  const problems: Problems = { console: [], bff: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.console.push(`${page.url()} :: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.console.push(`${page.url()} :: pageerror ${err.message}`));
  page.on('response', (res) => {
    if (res.url().includes('/bff/') && res.status() >= HTTP_ERROR_FLOOR) {
      problems.bff.push(`${res.request().method()} ${res.url()} -> ${String(res.status())}`);
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/bff/')) problems.bff.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText ?? 'failed'}`);
  });
  return problems;
}

async function sight(page: Page, problems: Problems, shot: string): Promise<string[]> {
  const findings: string[] = [];
  try {
    await expectTextFits(page, VISIBLE_TEXT);
  } catch (err) {
    findings.push(`text-fit: ${(err as Error).message.split('\n').slice(0, TEXT_FIT_LINES_KEPT).join(' | ')}`);
  }
  findings.push(...problems.console.map((line) => `console: ${line}`), ...problems.bff.map((line) => `bff: ${line}`));
  problems.console.length = 0;
  problems.bff.length = 0;
  await page.screenshot({ path: path.join(SHOT_DIR, `${shot}.png`), fullPage: true });
  return findings.map((finding) => `${shot} ${finding}`);
}

async function expectOperatingAsAcme(page: Page): Promise<void> {
  await expect(page.locator(id(MASTER_IDS.impersonationBanner)), 'the Acme Pay impersonation was lost on navigation')
    .toContainText(`Operating as ${ACME.name}`, { timeout: SCREEN_TIMEOUT_MS });
}

async function openList(page: Page, route: RouteSpec): Promise<void> {
  await page.goto(route.path, { waitUntil: 'commit' });
  await expect(page.locator(id(route.screen)), `${route.path} did not render ${route.screen}`)
    .toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  await expectOperatingAsAcme(page);
}

async function sightRecord(page: Page, problems: Problems, route: RouteSpec, base: string): Promise<string[]> {
  if (!route.rowPrefix || !route.recordScreens) return [];
  const row = page.locator(`[data-testid^="${route.rowPrefix}"]${route.rowSuffix ? `[data-testid$="${route.rowSuffix}"]` : ''}`).first();
  if ((await row.count()) === 0) {
    test.info().annotations.push({ type: 'not-covered', description: `${route.path}: no record in the list` });
    return [];
  }
  await row.click();
  await expect(page.locator(route.recordScreens.map(id).join(', ')).first(), `${route.path} row did not open its record`)
    .toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  const findings = await sight(page, problems, `${base}-record`);
  await openList(page, route);
  return findings;
}

async function sightCreate(page: Page, problems: Problems, route: RouteSpec, base: string): Promise<string[]> {
  if (!route.createButton || !route.createScreen) return [];
  await page.locator(id(route.createButton)).first().click();
  await expect(page.locator(id(route.createScreen)), `${route.path} create did not open ${route.createScreen}`)
    .toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  return sight(page, problems, `${base}-create`);
}

for (const viewport of VIEWPORTS) {
  test.describe(`FinReg CRM + Accounting sighting at ${viewport.label} @zygos-ui @ui`, () => {
    let context: BrowserContext | undefined;
    let page: Page;
    let problems: Problems;
    let master: ZygosSession | null = null;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(180_000);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      master = await sessionFor(masterAccount(await resolveDemoAccounts()));
      if (!master) return;
      context = await browser.newContext({ ...viewport.device, baseURL: ZYGOS_WEB_URL });
      page = await context.newPage();
      problems = watch(page);
      await enterConsoleAs(page, master, MASTER_ROUTES.portfolio);
      await page.locator(id(openId(ACME.id))).click();
      await expectOperatingAsAcme(page);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    for (const route of ROUTES) {
      test(`SIGHT ${viewport.label} ${route.module} ${route.name}, list record and create render with fitting text and no errors`, async () => {
        test.skip(!master, SKIP_REASON);
        test.setTimeout(150_000);
        const base = `${viewport.label}-${route.module}-${route.name}`;

        await openList(page, route);
        const findings = [
          ...(await sight(page, problems, `${base}-list`)),
          ...(await sightRecord(page, problems, route, base)),
          ...(await sightCreate(page, problems, route, base)),
        ];

        expect(findings, `${route.path} at ${viewport.label}`).toEqual([]);
      });
    }
  });
}
