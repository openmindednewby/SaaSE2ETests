// THROWAWAY VISUAL-QA SWEEP (Wave-1 demo polish) — app.finreg.dloizides.com, real Chromium.
//
// Not a regression gate: this walks every Wave-1 screen in BOTH a desktop (1280×900) and a mobile
// (390×844, touch) context, screenshots each full-page, and RECORDS — per screen — whether each
// demo-polish check renders, plus every console error and every 4xx/5xx network response seen.
// Findings are printed as a table at the end; the whole sweep always runs to completion (soft/try)
// so one broken screen never hides the state of the others. Auth reuses the harness (loginAsDemo →
// cookies, fallback checker-c) so the 5-logins/60s budget is spent at most once.
/* eslint-disable */
import fs from 'fs';
import path from 'path';

import { expect, test } from '@playwright/test';

import { ZYGOS_WEB_URL } from './zygos-helpers.js';
import { loginAsDemo, parkedCookies } from './zygos-session.js';

import type { BrowserContext, Page } from '@playwright/test';

const id = (t: string): string => `[data-testid="${t}"]`;
const url = (p: string): string => `${ZYGOS_WEB_URL}${p}`;

const SHOT_DIR = path.join('test-results', 'wave1-qa');
const SETTLE_MS = 1_500;

// ── evidence sinks (module-level so afterAll can print the combined report) ──────────────────────
interface CheckResult { screen: string; mode: string; check: string; pass: boolean | 'n/a'; detail: string; }
interface NetFail { screen: string; mode: string; status: number | string; urlText: string; }
interface ConsoleErr { screen: string; mode: string; text: string; }
const checks: CheckResult[] = [];
const netFails: NetFail[] = [];
const consoleErrs: ConsoleErr[] = [];
const shots: string[] = [];

let sessionCookies: Awaited<ReturnType<typeof parkedCookies>> = [];

test.beforeAll(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const demo = await loginAsDemo();
  if (demo) {
    const state = await demo.context.storageState();
    if (state.cookies.length) {
      sessionCookies = state.cookies as typeof sessionCookies;
      return;
    }
  }
  sessionCookies = await parkedCookies('zygos-checker-c');
});

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
function rec(screen: string, mode: string, check: string, pass: boolean | 'n/a', detail = ''): void {
  checks.push({ screen, mode, check, pass, detail });
  const mark = pass === 'n/a' ? 'N/A ' : pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${screen} · ${check}${detail ? ` — ${detail}` : ''}`);
}

async function shoot(page: Page, name: string, mode: string): Promise<void> {
  const file = path.join(SHOT_DIR, `${name}-${mode}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  shots.push(file);
}

/** Navigate to `p` and wait for `screenId`; returns true if the screen testID rendered. */
async function goScreen(page: Page, p: string, screenId: string): Promise<boolean> {
  await page.goto(url(p), { waitUntil: 'commit' }).catch(() => undefined);
  try {
    await expect(page.locator(id(screenId)).first()).toBeVisible({ timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/** Minimal row ids of a shared DataTable (`${tableId}-row-<id>`), excluding cell testIDs. */
async function rowIds(page: Page, tableId: string): Promise<string[]> {
  const prefix = `${tableId}-row-`;
  try {
    await expect(page.locator(`[data-testid^="${prefix}"]`).first()).toBeVisible({ timeout: 15_000 });
  } catch {
    return [];
  }
  const cands = (await page.locator(`[data-testid^="${prefix}"]`).evaluateAll(
    (els, pfx) => [...new Set(els.map((e) => (e.getAttribute('data-testid') ?? '').slice(pfx.length)))].filter((v) => v !== ''),
    prefix,
  )) as string[];
  return cands.filter((c) => !cands.some((o) => o !== c && c.startsWith(`${o}-`)));
}

async function count(page: Page, selector: string): Promise<number> {
  return page.locator(selector).count();
}

/** True if `testId` becomes visible within `timeout` — a race guard for AsyncSurface content.
 * Uses waitFor (which actually retries), NOT isVisible (which returns the current state at once). */
async function present(page: Page, testId: string, timeout = 12_000): Promise<boolean> {
  return page.locator(id(testId)).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
}

// ── the sweep, shared by both viewports ────────────────────────────────────────────────────────
async function sweep(page: Page, mode: string, currentScreen: { name: string }): Promise<void> {
  // 1) CRM — Contacts list (/crm)
  currentScreen.name = 'crm-contacts';
  {
    const ok = await goScreen(page, '/crm', 'zygos-contacts-screen');
    await shoot(page, 'crm-contacts', mode);
    rec('CRM Contacts', mode, 'screen renders', ok);
    if (ok) {
      const rows = await rowIds(page, 'zygos-contacts-table');
      rec('CRM Contacts', mode, 'rows present', rows.length > 0, `${rows.length} rows`);
      const avatars = await count(page, `${id('zygos-contacts-table')} [role="img"]`);
      rec('CRM Contacts', mode, 'Name cell avatars (role=img)', avatars > 0, `${avatars} avatars in table`);
    }
  }

  // 2) CRM — Contact detail (open first contact)
  currentScreen.name = 'crm-contact-detail';
  {
    let contactId: string | null = null;
    const viewBtn = page.locator('[data-testid^="contact-view-"]').first();
    if (await viewBtn.count()) {
      const tid = await viewBtn.getAttribute('data-testid');
      if (tid) contactId = tid.slice('contact-view-'.length);
    }
    if (!contactId) {
      const rows = await rowIds(page, 'zygos-contacts-table');
      contactId = rows[0] ?? null;
    }
    if (!contactId) {
      rec('Contact detail', mode, 'first contact available to open', false, 'no contact rows found');
    } else {
      const ok = await goScreen(page, `/crm/contacts/${contactId}`, 'zygos-contact-detail-screen');
      rec('Contact detail', mode, 'screen renders', ok, `contact ${contactId}`);
      if (ok) {
        // The card body (header + ContactSummary) is a DEFERRED, FADE-IN child: it mounts only after
        // useContact resolves and the FadeIn re-renders, so it FLICKERS in/out during settle. An
        // isVisible()-then-count() pair catches different instants and reads a false "absent". Wait for
        // the header, let the fade settle, THEN read every field once — matching the verified probe.
        const header = page.locator(id('zygos-contact-detail-header'));
        const headerVisible = await header.first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
        await page.waitForTimeout(2_500);
        await shoot(page, 'crm-contact-detail', mode);
        rec('Contact detail', mode, 'card header (CONTACT_DETAIL_HEADER)', headerVisible);
        const avatarCount = await count(page, `${id('zygos-contact-detail-header')} [role="img"]`);
        rec('Contact detail', mode, 'header avatar (role=img)', avatarCount > 0, `${avatarCount} in header`);
        const email = page.locator(id('zygos-contact-detail-email'));
        const emailCount = await email.count();
        const emailRole = emailCount ? await email.getAttribute('role') : null;
        rec('Contact detail', mode, 'Email field present (role=link)', emailCount > 0 && emailRole === 'link',
          emailCount ? `role=${emailRole} — NB: RN-web Pressable, mailto: opens via Linking not a DOM href` : 'absent (contact may have no email)');
        const phone = page.locator(id('zygos-contact-detail-phone'));
        const phoneCount = await phone.count();
        const phoneRole = phoneCount ? await phone.getAttribute('role') : null;
        rec('Contact detail', mode, 'Phone field present (role=link)', phoneCount > 0 ? phoneRole === 'link' : 'n/a',
          phoneCount ? `role=${phoneRole} — tel: opens via Linking not a DOM href` : 'absent (contact may have no phone)');
        const tags = page.locator(id('zygos-contact-detail-tags'));
        const tagCount = await tags.count();
        rec('Contact detail', mode, 'Tags chips (CONTACT_DETAIL_TAGS)', tagCount > 0 ? true : 'n/a',
          tagCount ? 'present' : 'absent (contact may have no tags)');
      }
    }
  }

  // 3) CRM — Activities feed (/crm/activities)
  currentScreen.name = 'crm-activities';
  {
    const ok = await goScreen(page, '/crm/activities', 'zygos-activities-screen');
    await shoot(page, 'crm-activities', mode);
    rec('Activities', mode, 'screen renders', ok);
    if (ok) {
      const rows = await rowIds(page, 'zygos-activities-table');
      const empty = await count(page, id('zygos-activities-empty'));
      rec('Activities', mode, 'rows present', rows.length > 0 ? true : 'n/a', rows.length ? `${rows.length} rows` : (empty ? 'empty state shown' : 'no rows, no empty state'));
      // Contact column shows a NAME not a GUID fragment: assert no cell text is exactly an 8-hex fragment.
      const cellTexts = (await page.locator(`${id('zygos-activities-table')} [data-testid^="zygos-activities-table-row-"]`).allInnerTexts()).join(' ');
      const guidFrag = /\b[0-9a-f]{8}\b/.test(cellTexts) && !/[A-Za-z]{3,}/.test(cellTexts.replace(/\b[0-9a-f-]+\b/g, ''));
      // more robust: look for a standalone 8-hex token surrounded by whitespace/newlines as a whole cell
      const bareGuid = /(^|\n)\s*[0-9a-f]{8}\s*($|\n)/.test(cellTexts);
      rec('Activities', mode, 'Contact column is a NAME, not a GUID fragment', !bareGuid, bareGuid ? 'a bare 8-hex fragment appears as a cell' : 'no bare 8-hex cell detected');
      const badges = await count(page, '[data-testid^="zygos-activity-type-badge-"]');
      rec('Activities', mode, 'type badge per row (ACTIVITY_TYPE_BADGE_*)', badges > 0 ? true : (rows.length ? false : 'n/a'), `${badges} badges`);
      void guidFrag;
    }
  }

  // 4) CRM — Segments (/crm/segments)
  currentScreen.name = 'crm-segments';
  {
    const ok = await goScreen(page, '/crm/segments', 'zygos-segments-screen');
    await shoot(page, 'crm-segments', mode);
    rec('Segments', mode, 'screen renders', ok);
    if (ok) {
      // Segments load async (AsyncSurface) — wait for the list or the empty state before reading.
      await page.locator(`${id('zygos-segments-list')}, ${id('zygos-segments-empty')}, [data-testid^="zygos-segment-chip-"]`)
        .first().waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined);
      const chips = await count(page, '[data-testid^="zygos-segment-chip-"]');
      const empty = await count(page, id('zygos-segments-empty'));
      rec('Segments', mode, 'chips render', chips > 0 ? true : (empty ? 'n/a' : false), chips ? `${chips} chips` : (empty ? 'empty state shown' : 'no chips, no empty state'));
    }
  }

  // 5) Payments — Dashboard + open-breaks reconciliation card.
  // NB: a full-page load of `/` intentionally REDIRECTS to /modules (the module catalogue is the
  // post-login landing). The dashboard (Routes.dashboard = '/(protected)') is reached by clicking
  // the Payments module card client-side, which is what a real operator does — so drive it that way.
  currentScreen.name = 'dashboard';
  {
    const catalogOk = await goScreen(page, '/modules', 'zygos-module-catalog-screen');
    rec('Dashboard', mode, 'module catalogue is the / landing (redirect)', catalogOk);
    let ok = false;
    if (catalogOk) {
      await page.locator(id('zygos-module-card-payments')).click().catch(() => undefined);
      ok = await page.locator(id('zygos-dashboard-screen')).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    }
    rec('Dashboard', mode, 'screen renders (via Payments module card)', ok);
    if (ok) {
      // The StatCards + card render once their queries resolve (AsyncSurface) — wait for the recon
      // card, then settle, so the SCREENSHOT captures the painted dashboard, not the blank pre-load.
      const card = page.locator(id('zygos-reconciliation-summary-card'));
      const cardVisible = await card.first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(1_500);
      await shoot(page, 'dashboard', mode);
      rec('Dashboard', mode, 'open-breaks reconciliation card present', cardVisible);
      if (cardVisible) {
        await card.first().click().catch(() => undefined);
        await page.waitForTimeout(SETTLE_MS);
        const landed = new URL(page.url()).pathname;
        rec('Dashboard', mode, 'clicking open-breaks card routes to /reconciliation', landed.startsWith('/reconciliation'), `landed at ${landed}`);
      }
    } else {
      await shoot(page, 'dashboard', mode);
    }
  }

  // 6) Payments — Reconciliation (/reconciliation)
  currentScreen.name = 'reconciliation';
  {
    const ok = await goScreen(page, '/reconciliation', 'zygos-reconciliation-screen');
    await shoot(page, 'reconciliation', mode);
    rec('Reconciliation', mode, 'screen renders', ok);
    if (ok) {
      const rows = await rowIds(page, 'zygos-reconciliation-table');
      const empty = await count(page, id('zygos-reconciliation-empty'));
      const hasTable = await count(page, id('zygos-reconciliation-table'));
      rec('Reconciliation', mode, 'breaks table OR friendly empty state', hasTable > 0 || empty > 0,
        rows.length ? `${rows.length} break rows` : (empty ? 'empty state shown (0 breaks) — PASS' : (hasTable ? 'table present, 0 rows' : 'neither table nor empty state')));
    }
  }

  // 7) Payments — Instruction detail (funding pre-check panel wired)
  currentScreen.name = 'instruction-detail';
  {
    const listOk = await goScreen(page, '/instructions', 'zygos-instructions-screen');
    let instrId: string | null = null;
    if (listOk) {
      const rows = await rowIds(page, 'zygos-instructions-table');
      instrId = rows[0] ?? null;
    }
    if (!instrId) {
      rec('Instruction detail', mode, 'first instruction available to open', 'n/a', 'no instruction rows (list may be empty)');
    } else {
      const ok = await goScreen(page, `/instructions/${instrId}`, 'zygos-instruction-detail-screen');
      await shoot(page, 'instruction-detail', mode);
      rec('Instruction detail', mode, 'screen renders without error', ok, `instruction ${instrId}`);
      if (ok) {
        const panel = await count(page, id('zygos-funding-precheck-panel'));
        rec('Instruction detail', mode, 'funding pre-check panel present in bundle', panel > 0 ? true : 'n/a',
          panel > 0 ? 'panel rendered' : 'panel not rendered (only shows on shortfall submit — expected absent here)');
      }
    }
  }

  // 8) Accounting — P&L
  currentScreen.name = 'profit-and-loss';
  {
    const ok = await goScreen(page, '/accounting/profit-and-loss', 'zygos-profit-and-loss-screen');
    await shoot(page, 'accounting-pnl', mode);
    rec('P&L', mode, 'screen renders', ok);
    if (ok) {
      const revenue = await present(page, 'zygos-profit-and-loss-revenue-table');
      rec('P&L', mode, 'Revenue section (revenue-table)', revenue);
      rec('P&L', mode, 'Expenses section (expenses-table)', await present(page, 'zygos-profit-and-loss-expenses-table'));
      const netVisible = await present(page, 'zygos-profit-and-loss-net');
      const net = page.locator(id('zygos-profit-and-loss-net'));
      const netText = netVisible ? (await net.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() : '';
      rec('P&L', mode, 'Net Profit/Loss line', netVisible, netText ? `"${netText.slice(0, 80)}"` : 'absent');
    }
  }

  // 9) Accounting — Balance Sheet
  currentScreen.name = 'balance-sheet';
  {
    const ok = await goScreen(page, '/accounting/balance-sheet', 'zygos-balance-sheet-screen');
    await shoot(page, 'accounting-balance-sheet', mode);
    rec('Balance Sheet', mode, 'screen renders', ok);
    if (ok) {
      rec('Balance Sheet', mode, 'Assets table', await present(page, 'zygos-balance-sheet-assets-table'));
      rec('Balance Sheet', mode, 'Liabilities table', await present(page, 'zygos-balance-sheet-liabilities-table'));
      rec('Balance Sheet', mode, 'Equity table', await present(page, 'zygos-balance-sheet-equity-table'));
      const indVisible = await present(page, 'zygos-balance-sheet-indicator');
      const ind = page.locator(id('zygos-balance-sheet-indicator'));
      const indText = indVisible ? (await ind.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() : '';
      rec('Balance Sheet', mode, 'Balanced/Not-balanced badge', indVisible, indText ? `"${indText.slice(0, 60)}"` : 'absent');
    }
  }

  // 10) Accounting — Trial Balance (regression)
  currentScreen.name = 'trial-balance';
  {
    const ok = await goScreen(page, '/accounting/trial-balance', 'zygos-trial-balance-screen');
    await shoot(page, 'accounting-trial-balance', mode);
    rec('Trial Balance', mode, 'screen renders', ok);
    if (ok) {
      rec('Trial Balance', mode, 'table present', await present(page, 'zygos-trial-balance-table'));
      rec('Trial Balance', mode, 'balanced indicator present', await present(page, 'zygos-trial-balance-indicator'));
    }
  }
}

// ── attach evidence listeners to a page for the given mode ───────────────────────────────────────
function wire(page: Page, mode: string, currentScreen: { name: string }): void {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrs.push({ screen: currentScreen.name, mode, text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => consoleErrs.push({ screen: currentScreen.name, mode, text: `[pageerror] ${e.message.slice(0, 300)}` }));
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400) netFails.push({ screen: currentScreen.name, mode, status: s, urlText: r.url().replace(ZYGOS_WEB_URL, '') });
  });
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText ?? 'failed';
    // ERR_ABORTED = an in-flight query cancelled when this sweep navigates to the next screen
    // (React Query unmounts and aborts it). That is a tooling artifact of walking screens fast,
    // not a product/network fault — exclude it so the report only shows real failures.
    if (err.includes('ERR_ABORTED')) return;
    netFails.push({ screen: currentScreen.name, mode, status: err, urlText: r.url().replace(ZYGOS_WEB_URL, '') });
  });
}

test.describe('Wave-1 visual QA sweep (app.finreg.dloizides.com)', () => {
  test('DESKTOP 1280×900 — full Wave-1 screen sweep', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(sessionCookies.length === 0, 'no zygos session could be minted — console unreachable');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(sessionCookies);
    const page = await context.newPage();
    const currentScreen = { name: 'boot' };
    wire(page, 'desktop', currentScreen);
    console.log('\n═══ DESKTOP SWEEP ═══');
    await sweep(page, 'desktop', currentScreen);
    await context.close();
  });

  test('MOBILE 390×844 — full Wave-1 screen sweep + drawer nav', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(sessionCookies.length === 0, 'no zygos session could be minted — console unreachable');
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addCookies(sessionCookies);
    const page = await context.newPage();
    const currentScreen = { name: 'boot' };
    wire(page, 'mobile', currentScreen);
    console.log('\n═══ MOBILE SWEEP ═══');
    await sweep(page, 'mobile', currentScreen);

    // 11) MOBILE — hamburger drawer → CRM group expand → leaf navigates (ui-nav 1.15.0 Collapse guard)
    currentScreen.name = 'mobile-drawer';
    {
      const shellOk = await goScreen(page, '/modules', 'zygos-app-shell');
      rec('Mobile drawer', 'mobile', 'app shell renders', shellOk);
      if (shellOk) {
        await page.locator(id('zygos-app-shell-menu-toggle')).tap().catch(() => undefined);
        const drawerOpen = await page.locator(id('zygos-app-shell-drawer')).isVisible().catch(() => false);
        rec('Mobile drawer', 'mobile', 'drawer opens on hamburger tap', drawerOpen);
        await shoot(page, 'mobile-drawer-open', 'mobile');
        if (drawerOpen) {
          await page.locator(id('nav-group-crm')).tap().catch(() => undefined);
          const leafVisible = await page.locator(id('nav-crm-people')).first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
          rec('Mobile drawer', 'mobile', 'CRM group expands (People leaf revealed)', leafVisible);
          if (leafVisible) {
            const before = new URL(page.url()).pathname;
            await page.locator(id('nav-crm-people')).tap().catch(() => undefined);
            await page.waitForTimeout(SETTLE_MS);
            const after = new URL(page.url()).pathname;
            rec('Mobile drawer', 'mobile', 'leaf tap NAVIGATES (not just closes)', after === '/crm/people', `${before} → ${after}`);
            await shoot(page, 'mobile-drawer-after-leaf-tap', 'mobile');
          }
        }
      }
    }
    await context.close();
  });
});

test.afterAll(async () => {
  const line = '─'.repeat(90);
  console.log(`\n${line}\nWAVE-1 VISUAL QA — RESULTS TABLE (screen × mode × check)\n${line}`);
  for (const c of checks) {
    const mark = c.pass === 'n/a' ? 'N/A ' : c.pass ? 'PASS' : 'FAIL';
    console.log(`${mark} | ${c.mode.padEnd(7)} | ${c.screen.padEnd(18)} | ${c.check}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const fails = checks.filter((c) => c.pass === false);
  console.log(`\n${line}\nSUMMARY: ${checks.length} checks — ${checks.filter((c) => c.pass === true).length} PASS, ${fails.length} FAIL, ${checks.filter((c) => c.pass === 'n/a').length} N/A`);

  console.log(`\n${line}\nCONSOLE ERRORS (${consoleErrs.length})\n${line}`);
  if (consoleErrs.length === 0) console.log('  none');
  for (const e of consoleErrs) console.log(`  [${e.mode}] ${e.screen}: ${e.text}`);

  console.log(`\n${line}\nFAILED / 4xx-5xx NETWORK (${netFails.length})\n${line}`);
  if (netFails.length === 0) console.log('  none');
  for (const n of netFails) console.log(`  [${n.mode}] ${n.screen}: ${n.status} ${n.urlText}`);

  console.log(`\n${line}\nSCREENSHOTS (${shots.length})\n${line}`);
  for (const s of shots) console.log(`  ${s}`);
  console.log(line);
});
