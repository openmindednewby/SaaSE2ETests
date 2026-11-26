/**
 * UI-ZINDEX-SCALE-1 "Shared overlay z-index scale" + KEFI-DOOR-DESKTOP-1 "door comp row desktop layout"
 * authenticated SIGHTING on the deployed kefi-web organizer. The zindex sightings are READ-ONLY: they open
 * the Edit Attendee dialog, pick a dropdown option (form state only), then CANCEL. Copy = clipboard only.
 * The door comp row block seeds one staff comp and one STAFF-pass EUR 0 guest on the `e2e` fixture event
 * and deletes them again in afterAll.
 */
import { test, expect, devices, type Page } from '@playwright/test';
import * as fs from 'node:fs';

import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { bffLogin, proofOrganizer } from '../../helpers/kefi/kefiBrowserLogin.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { resolveEventExternalId } from '../../helpers/kefi/kefiCrewRosterSeed.js';
import { KefiPromoterClient, type DoorCompSeed } from '../../helpers/kefi/kefiPromoterClient.js';

const OUT = process.env.SIGHT_OUT ?? 'qa-screenshots/zindex-sighting';
const VIEWPORTS = [
  { tag: '360', ctx: { ...devices['Galaxy S5'], viewport: { width: 360, height: 640 } } },
  { tag: '1280', ctx: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
];
const tid = (p: string): string => `[data-testid^="${p}"]`;

async function openTab(page: Page, web: string, key: string): Promise<void> {
  await page.goto(`${web}/organizer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('organizer-event-header').waitFor({ timeout: 45_000 });
  const menu = page.getByTestId('organizer-menu');
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.getByTestId(`organizer-tab-${key}`).click();
  await page.waitForTimeout(2500);
}

async function switchTab(page: Page, key: string): Promise<void> {
  const menu = page.getByTestId('organizer-menu');
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.getByTestId(`organizer-tab-${key}`).click();
  await page.waitForTimeout(1200);
}

/** Which element paints at the centre of `sel`? */
async function topmost(page: Page, sel: string): Promise<Record<string, unknown>> {
  return page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const zs: string[] = [];
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const z = getComputedStyle(n).zIndex;
      if (z !== 'auto') zs.push(`${n.getAttribute('data-testid') ?? n.tagName}:${z}:${getComputedStyle(n).position}`);
    }
    return {
      found: true,
      w: Math.round(r.width),
      h: Math.round(r.height),
      onTop: !!hit && (el === hit || el.contains(hit)),
      hitTid: hit?.closest('[data-testid]')?.getAttribute('data-testid') ?? hit?.tagName,
      zs: zs.slice(0, 4).join(' | '),
    };
  }, sel);
}

async function boxOf(page: Page, sel: string): Promise<string> {
  const b = await page.locator(sel).first().boundingBox().catch(() => null);
  return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : 'absent';
}

async function geo(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const cs = [...document.querySelectorAll('[data-testid^="organizer-door-staff-card-"]')].map((c) =>
      c.parentElement!.getBoundingClientRect(),
    );
    return {
      lefts: [...new Set(cs.map((r) => Math.round(r.left)))],
      widths: cs.slice(0, 2).map((r) => Math.round(r.width)),
      scrollOver: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

async function probeDropdown(page: Page, field: string, copied: boolean, out: string): Promise<unknown> {
  const trig = page.getByTestId(field);
  if (!(await trig.count())) return 'absent';
  await trig.scrollIntoViewIfNeeded();
  const before = (await trig.innerText()).trim();
  await trig.click();
  await page.waitForTimeout(600);
  const opts = page.locator(tid(`${field}-`));
  const n = await opts.count();
  const probe = n ? await topmost(page, tid(`${field}-`)) : { found: false };
  const heights = await opts.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  const toast = copied ? await topmost(page, '[data-testid*="toast"]') : 'n/a';
  await page.screenshot({ path: out });
  let after = before;
  let focusAfter: string | null = null;
  if (n >= 2) {
    await opts.nth(1).click();
    await page.waitForTimeout(500);
    after = (await trig.innerText()).trim();
    focusAfter = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null,
    );
  } else if (n === 1) await page.keyboard.press('Escape');
  const menuClosed = (await opts.count()) === 0;
  return { options: n, heights, probe, toast, before: before.slice(0, 50), after: after.slice(0, 50), menuClosed, focusAfter };
}

for (const vp of VIEWPORTS) {
  test(`zindex sighting @ ${vp.tag}`, async ({ browser }) => {
    fs.mkdirSync(OUT, { recursive: true });
    const web = getKefiUrls().webUrl;
    const ctx = await browser.newContext({
      ...vp.ctx,
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
    });
    const R: Record<string, unknown> = { vp: vp.tag, web, at: new Date().toISOString() };
    try {
      await page.goto(`${web}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await bffLogin(page, proofOrganizer());

      // 2. Door comp cards
      await openTab(page, web, 'door');
      R.compCards = await page.locator(tid('organizer-door-staff-card-')).count();
      R.compGeo = await geo(page);
      if (R.compCards) await page.getByTestId('organizer-door-staff-comps').scrollIntoViewIfNeeded();
      const sc = '[data-testid="organizer-door-staff-comps"] ';
      R.compTicketBtn = await boxOf(page, sc + tid('organizer-attendee-ticket-open-'));
      R.compCopyBtn = await boxOf(page, sc + tid('organizer-attendee-ticket-copy-'));
      R.anyTicketBtn = await boxOf(page, tid('organizer-attendee-ticket-open-'));
      R.anyCopyBtn = await boxOf(page, tid('organizer-attendee-ticket-copy-'));
      await page.screenshot({ path: `${OUT}/door-${vp.tag}.png` });
      if (vp.tag === '1280') {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.waitForTimeout(800);
        R.compGeo768 = await geo(page);
        await page.screenshot({ path: `${OUT}/door-768.png` });
        await page.setViewportSize({ width: 1280, height: 800 });
      }

      // 1 + 3. Copy (toast) -> Attendees -> Edit dialog -> dropdowns
      const copy = page.locator(tid('organizer-attendee-ticket-copy-')).first();
      let copied = false;
      if (await copy.count()) {
        await copy.click();
        copied = true;
      }
      R.toastNodesAfterDoorCopy = await page.locator('[data-testid*="toast"]').count();
      await switchTab(page, 'attendees');
      const overflow = page.locator('[data-testid$="-overflow"]');
      await overflow.first().waitFor({ timeout: 25_000 }).catch(() => undefined);
      R.overflowTriggers = await overflow.count();
      R.overflowTriggerBox = await boxOf(page, '[data-testid$="-overflow"]');
      const rowCopy = page.locator(tid('organizer-attendee-ticket-copy-')).first();
      if (await rowCopy.isVisible().catch(() => false)) {
        await rowCopy.click();
        copied = true;
      }
      R.toastNodesAfterRowCopy = await page.locator('[data-testid*="toast"]').count();
      R.editInline = await page.locator(tid('organizer-attendee-edit-')).count();
      if (!R.editInline && (await overflow.count())) {
        await overflow.first().click();
        await page.waitForTimeout(500);
        R.rowMoreMenu = await topmost(page, '[data-testid$="-overflow-menu"]');
        await page.screenshot({ path: `${OUT}/row-more-menu-${vp.tag}.png` });
      }
      R.editButtons = await page.locator(tid('organizer-attendee-edit-')).count();
      const edit = page.locator(tid('organizer-attendee-edit-')).first();
      if (await edit.count()) {
        await edit.click();
        await page.getByTestId('organizer-attendee-form-modal').waitFor({ timeout: 15_000 });
        R.toastOverDialog = copied ? await topmost(page, '[data-testid*="toast"]') : 'no-copy-button';
        await page.screenshot({ path: `${OUT}/edit-dialog-${vp.tag}.png` });
        for (const field of ['organizer-attendee-price-tier', 'organizer-attendee-pass-code'])
          R[field] = await probeDropdown(page, field, copied, `${OUT}/dropdown-${field}-${vp.tag}.png`);
        await page.getByTestId('organizer-attendee-form-cancel').click();
      }
      R.moreInsideDialogDom = await page.locator('[aria-modal="true"] [data-testid*="more"]').count();
    } catch (e) {
      R.failure = String(e).slice(0, 400);
      await page.screenshot({ path: `${OUT}/failure-${vp.tag}.png` }).catch(() => undefined);
    }
    R.errors = [...new Set(errors)].slice(0, 15);
    fs.writeFileSync(`${OUT}/result-${vp.tag}.json`, JSON.stringify(R, null, 2));
    await ctx.close();
  });
}

const MIN_TARGET_PX = 44;
const DOOR_VIEWPORTS = [
  { tag: '390', ctx: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } }, wide: false },
  { tag: '1280', ctx: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, wide: true },
];

test.describe('KEFI-DOOR-DESKTOP-1 door comp row', () => {
  const promoters = new KefiPromoterClient();
  let bearer = '';
  let seed: DoorCompSeed | undefined;

  test.beforeAll(async ({ browser }) => {
    const organizer = proofOrganizer();
    bearer = await new KefiAdminClient().getTenantOwnerBearer({ email: organizer.username, password: organizer.password });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(`${getKefiUrls().webUrl}/login`, { waitUntil: 'domcontentloaded' });
    await bffLogin(page, organizer);
    const eventExternalId = await resolveEventExternalId(page);
    await ctx.close();
    seed = await promoters.seedDoorComps(bearer, eventExternalId, Date.now().toString(36));
  });

  test.afterAll(async () => {
    if (seed === undefined) return;
    expect(await promoters.removeDoorComps(bearer, seed), 'every seeded door comp row was deleted').toEqual([]);
  });

  for (const vp of DOOR_VIEWPORTS) {
    test(`AC-1 AC-2 door comp row at ${vp.tag}, ${vp.wide ? 'two' : 'one'} column cards and 44px Ticket/Copy boxes`, async ({ browser }) => {
      const comps = seed as DoorCompSeed;
      const ctx = await browser.newContext({ ...vp.ctx, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await page.goto(`${getKefiUrls().webUrl}/login`, { waitUntil: 'domcontentloaded' });
      await bffLogin(page, proofOrganizer());

      await openTab(page, getKefiUrls().webUrl, 'door');

      const section = page.getByTestId('organizer-door-staff-comps');
      const staffCard = page.getByTestId(`organizer-door-staff-card-${comps.staffAttendeeExternalId}`);
      const guestCard = page.getByTestId(`organizer-door-staff-card-${comps.guestAttendeeExternalId}`);
      await expect(staffCard, 'the seeded staff comp card renders on the door tab').toBeVisible();
      await expect.soft(guestCard, 'the seeded STAFF-pass EUR 0 guest card renders on the door tab').toBeVisible();
      await section.scrollIntoViewIfNeeded();
      const sectionBox = await section.boundingBox();
      const cardWidths = await page.locator(tid('organizer-door-staff-card-')).evaluateAll((els) =>
        els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().width));
      const share = Math.max(...cardWidths) / (sectionBox?.width ?? 1);
      if (vp.wide) expect.soft(share, `comp card share of the ${Math.round(sectionBox?.width ?? 0)}px row at 1280 (two-column grid, about 49%)`).toBeLessThan(0.6);
      else expect.soft(share, 'comp card share of the row at 390 (one column)').toBeGreaterThan(0.9);
      for (const kind of ['open', 'copy']) {
        const box = await section.locator(tid(`organizer-attendee-ticket-${kind}-`)).first().boundingBox();
        expect.soft(box?.height ?? 0, `Ticket ${kind} button box height in the comp row at ${vp.tag}`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
        expect.soft(box?.width ?? 0, `Ticket ${kind} button box width in the comp row at ${vp.tag}`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      }
      const scrollOver = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect.soft(scrollOver, `no horizontal scroll on the door tab at ${vp.tag}`).toBeLessThanOrEqual(0);
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/door-comps-${vp.tag}.png` });
      await ctx.close();
    });
  }
});
