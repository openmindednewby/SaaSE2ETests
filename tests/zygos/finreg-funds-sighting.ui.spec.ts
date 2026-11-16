import fs from 'fs';
import path from 'path';

import { expectTextFits } from '@dloizides/game-e2e';
import { devices, expect, test } from '@playwright/test';

import { MASTER_IDS, MASTER_ROUTES, MERCHANTS, ZYGOS_WEB_URL, enterConsoleAs, id, masterAccount, merchantAccount, openId, resolveDemoAccounts, sessionFor } from './zygos-master.js';
import { ZYGOS_API_PREFIX } from './zygos-helpers.js';

const SHOT_DIR = process.env.SIGHTING_DIR ?? path.join('test-results', 'finreg-funds-sighting');
const ACME = MERCHANTS[0];
const ROUTES = [
  ['funds', '/funds'], ['funds-settings', '/funds/settings'], ['access-users', '/access/users'],
  ['access-permissions', '/access/permissions'], ['access-blocks', '/access/blocks'], ['commission', '/commission'],
  ['org-detail', '/crm/organizations'],
] as const;
const VIEWPORTS = [
  { label: '360x640', device: { ...devices['Galaxy S5'], viewport: { width: 360, height: 640 } } },
  { label: '1280x800', device: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
] as const;

const MODAL_CANCEL = '[data-testid$="-edit-modal-cancel"]';
const TAB_LIMIT = 80;

async function rowOpens(page: import('@playwright/test').Page, shot: string): Promise<string> {
  const cancel = page.locator(MODAL_CANCEL).first();
  await page.keyboard.press('Escape');
  if (await cancel.isVisible()) await cancel.click();
  const closedFirst = await cancel.waitFor({ state: 'hidden', timeout: 5_000 }).then(() => true, () => false);
  const table = page.locator('[data-testid$="-table"]:has([data-testid*="-table-row-"])').first();
  const row = table.locator('[data-testid*="-table-row-"]:not([data-testid*="fade"])').first();
  if ((await row.count()) === 0) return `closedFirst=${closedFirst} rowCheck=NO ROW`;
  const rowId = await row.getAttribute('data-testid');
  const cursor = await row.evaluate((el) => getComputedStyle(el).cursor);
  const clicked = await row.locator(':scope > *').first().click({ timeout: 5_000 }).then(() => 'ok', (e: Error) => e.message.split('\n')[0].slice(0, 80));
  const clickOpens = await cancel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
  if (clickOpens) await page.screenshot({ path: shot });
  await page.keyboard.press('Escape');
  const escapeCloses = await cancel.waitFor({ state: 'hidden', timeout: 5_000 }).then(() => true, () => false);
  if (!escapeCloses && (await cancel.isVisible())) await cancel.click();
  let tabReached = false;
  for (let i = 0; i < TAB_LIMIT && !tabReached; i++) {
    await page.keyboard.press('Tab');
    tabReached = await row.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
  }
  let enterOpens = false;
  if (tabReached) {
    await page.keyboard.press('Enter');
    enterOpens = await cancel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    await page.keyboard.press('Escape');
  }
  return `closedFirst=${closedFirst} row=${rowId} click=${clicked} rowClickOpens=${clickOpens} escapeCloses=${escapeCloses} cursor=${cursor} tabReachesRow=${tabReached} enterOpens=${enterOpens}`;
}

test('SIGHT tenant user without access.users.read gets 403 on GET /access/users @zygos-ui', async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const demo = await sessionFor(merchantAccount(await resolveDemoAccounts()));
  test.skip(!demo, 'no demo merchant session');

  const res = await demo!.context.get(`${ZYGOS_API_PREFIX}/access/users`);

  const body = (await res.text()).slice(0, 300).replace(/\s+/g, ' ');
  fs.appendFileSync(path.join(SHOT_DIR, 'findings.txt'), `demo GET /access/users -> ${res.status()} ${body}\n`);
  expect(res.status(), `a tenant user must be refused, not crash; body: ${body}`).toBe(403);
});

for (const vp of VIEWPORTS) {
  test(`SIGHT funds screens ${vp.label} @zygos-ui`, async ({ browser }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const master = await sessionFor(masterAccount(await resolveDemoAccounts()));
    test.skip(!master, 'no demo session');
    const context = await browser.newContext({ ...vp.device, baseURL: ZYGOS_WEB_URL });
    const page = await context.newPage();
    const errs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => errs.push(`pageerror ${e.message.slice(0, 160)}`));
    page.on('response', (r) => { if (r.url().includes('/bff/') && r.status() >= 400) errs.push(`${r.request().method()} ${r.url().replace(ZYGOS_WEB_URL, '')} -> ${r.status()}`); });
    await enterConsoleAs(page, master!, MASTER_ROUTES.portfolio);
    await page.locator(id(openId(ACME.id))).click();
    await expect(page.locator(id(MASTER_IDS.impersonationBanner))).toContainText(`Operating as ${ACME.name}`, { timeout: 30_000 });
    const lines: string[] = [];
    try {
      for (const [name, route] of ROUTES) {
        errs.length = 0;
        await page.goto(route, { waitUntil: 'commit' });
        await expect(page.locator(id(MASTER_IDS.shell))).toBeVisible({ timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        if (name === 'org-detail') {
          const row = page.locator('[data-testid^="zygos-contacts-table-row-"]').first();
          if ((await row.count()) > 0) { await row.click(); await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined); }
          else lines.push('org-detail: NO ROW');
        }
        await page.waitForTimeout(1500);
        let fit = 'ok';
        try { await expectTextFits(page, 'body *:not([id^="a11y-hint-"])'); } catch (e) { fit = (e as Error).message.split('\n').slice(0, 4).join(' | ').slice(0, 400); }
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const sw = document.documentElement.scrollWidth;
          const small: string[] = [];
          document.querySelectorAll('button,a,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],input,select,[tabindex="0"]').forEach((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            const cs = getComputedStyle(el as HTMLElement);
            if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') return;
            if (r.width < 44 || r.height < 44) small.push(`${(el as HTMLElement).dataset.testid ?? el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
          });
          const empty = (document.querySelector('main') ?? document.body).innerText.trim().length;
          return { vw, sw, small: small.length, smallList: small.slice(0, 6).join(','), textLen: empty, url: location.pathname };
        });
        const x = await page.evaluate(() => {
          const keys = (document.body.innerText.match(/accessAdmin\.[\w.]+/g) ?? []).slice(0, 4).join(',');
          const sw = Array.from(document.querySelectorAll('input[role="switch"]')).map((el) => {
            let a: HTMLElement | null = el as HTMLElement; let row = '';
            const inner = (el as HTMLElement).closest('[data-testid$="-switch"]') as HTMLElement | null;
            const rowEl = inner ? document.querySelector(`[data-testid="${inner.dataset.testid!.replace(/-switch$/, '')}"]`) as HTMLElement | null : null;
            if (rowEl) { const r = rowEl.getBoundingClientRect(); row = `${rowEl.dataset.testid}:${Math.round(r.width)}x${Math.round(r.height)}`; }
            for (let i = 0; i < 6 && a && !row; i++) { a = a.parentElement; if (a && (getComputedStyle(a).cursor === 'pointer' || a.tabIndex >= 0)) { const r = a.getBoundingClientRect(); row = `${a.dataset.testid ?? a.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`; break; } }
            const r = el.getBoundingClientRect();
            return `input ${Math.round(r.width)}x${Math.round(r.height)} row=${row || 'none'}`;
          }).join(' | ');
          return { keys, sw };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-${name}.png`), fullPage: true });
        const bottom = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('*')).filter((e) => { const cs = getComputedStyle(e); return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 20; }) as HTMLElement[];
          els.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
          const c = els[0]; if (!c) return 'no-scroller';
          const h = `${c.scrollHeight}/${c.clientHeight}`; c.scrollTop = c.scrollHeight; return h;
        });
        if (bottom !== 'no-scroller') { await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-${name}-bottom.png`) }); }
        let roles = '';
        if (name === 'access-users') {
          const users = await page.locator('[data-testid*="-edit-"]:not([data-testid*="-edit-modal"])').count();
          const edit = page.locator('[data-testid*="-edit-"]:not([data-testid*="-edit-modal"])').first();
          if (users > 0) {
            await edit.click(); await page.waitForTimeout(1500);
            if ((await page.locator('[data-testid*="-edit-modal-role-option-"]').count()) === 0) { const rf = page.locator('[data-testid$="-edit-modal-role"]').first(); if ((await rf.count()) > 0) { await rf.click(); await page.waitForTimeout(800); } }
            roles = await page.evaluate((n) => {
              const opts = Array.from(document.querySelectorAll('[data-testid*="-edit-modal-role-option-"]')).map((e) => (e as HTMLElement).dataset.testid!.replace(/.*-role-option-/, ''));
              const names = Array.from(document.querySelectorAll('td,[role="cell"]')).map((e) => (e as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 12).join('/').slice(0, 200);
              return `editButtons=${n} opts=${opts.join('/')} fundsSettings=${opts.includes('funds-settings')} master=${opts.some((o) => /master/i.test(o))} cells=${names}`;
            }, users);
            await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-${name}-edit.png`) });
            await page.keyboard.press('Escape'); await page.waitForTimeout(300);
            const cancel = page.locator('[data-testid$="-edit-modal-cancel"]').first();
            if (await cancel.isVisible()) await cancel.click();
          } else roles = 'NO USER ROW (0 edit buttons)';
          roles += ` ${await rowOpens(page, path.join(SHOT_DIR, `${vp.label}-access-users-row-open.png`))}`;
        }
        lines.push(`${vp.label} ${name} url=${m.url} sw=${m.sw}/${m.vw} small=${m.small} [${m.smallList}] text=${m.textLen} fit=${fit} keys=[${x.keys}] switches=[${x.sw}] scroll=${bottom} roles=[${roles}] errs=${errs.join(' ; ') || 'none'}`);
      }
    } finally {
      fs.appendFileSync(path.join(SHOT_DIR, 'findings.txt'), lines.join('\n') + '\n');
      await context.close();
    }
  });
}
