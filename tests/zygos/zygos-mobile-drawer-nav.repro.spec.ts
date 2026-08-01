// 🔴 REPRODUCE-ONLY (user bug, live FINREG) — the shared `@dloizides/ui-nav` MobileDrawer.
//
// The report: on app.finreg.dloizides.com at a PHONE viewport, opening the hamburger nav drawer
// and TAPPING a leaf / sub-item (e.g. CRM → "People", or "Dashboard") makes the drawer close
// WITHOUT navigating — the route never changes, the drawer just vanishes.
//
// Why this file exists as a SEPARATE, real-browser repro rather than a unit test:
//
//   The jsdom unit tests for this exact interaction PASS, because they wire the drawer's `onClose`
//   to an inert `jest.fn()` and fire `fireEvent.click` (a synthetic click, not a real pointer/touch
//   gesture). The bug only appears under real pointer semantics on a touch-enabled viewport, where
//   the leaf's press and the drawer's dismiss compete. So this spec:
//     * builds its OWN Chromium context at 390×844 with `hasTouch:true, isMobile:true`, and
//     * drives the leaf with `.tap()` (real pointer events), never `.click()`.
//
// It is deliberately EVIDENCE-GATHERING: every observable (URL before/after, drawer visibility,
// the framenavigated log, console + page errors) is captured and printed, and the final diagnosis
// is a `expect.soft` so the whole sequence always runs to completion even when the bug reproduces.
//
// Auth: reuses the zygos session harness (parkedCookies / loginAsDemo) — no passwords typed, the
// 5-logins/60s budget is spent at most once (a parked cookie is reused). The DEMO tenant is
// preferred because it is seeded with CRM data (so the CRM group and its People leaf exist).
import { expect, test } from '@playwright/test';

import { ZYGOS_WEB_URL } from './zygos-helpers.js';
import { loginAsDemo, parkedCookies } from './zygos-session.js';

import type { BrowserContext, Page } from '@playwright/test';

const id = (testId: string): string => `[data-testid="${testId}"]`;

const IDS = {
  shell: 'zygos-app-shell',
  menuToggle: 'zygos-app-shell-menu-toggle',
  drawer: 'zygos-app-shell-drawer',
  scrim: 'zygos-app-shell-drawer-scrim',
  navGroupCrm: 'nav-group-crm',
  navPeople: 'nav-crm-people',
  navDashboard: 'nav-dashboard',
} as const;

/** How long to let the tap settle before reading URL / drawer state (evidence window, not a race fix). */
const SETTLE_MS = 2_000;

/**
 * A console session cookie jar, minted ONCE and reused. Prefers the DEMO tenant (seeded CRM data);
 * falls back to the permanent checker-c fixture. Returns [] only when the console is unreachable.
 */
let sessionCookies: Awaited<ReturnType<typeof parkedCookies>> = [];

test.beforeAll(async () => {
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

/** Inject the minted cookies into a fresh context and land on `path`, waiting for the shell. */
async function enter(context: BrowserContext, path: string): Promise<Page> {
  await context.clearCookies();
  await context.addCookies(sessionCookies);
  const page = await context.newPage();
  await page.goto(`${ZYGOS_WEB_URL}${path}`, { waitUntil: 'commit' });
  await expect(page.locator(id(IDS.shell))).toBeVisible({ timeout: 30_000 });
  return page;
}

test.describe('🔴 REPRO: mobile nav drawer leaf tap (ui-nav MobileDrawer)', () => {
  test('MOBILE — tapping CRM > People in the drawer', async ({ browser }) => {
    test.setTimeout(120_000);
    test.skip(sessionCookies.length === 0, 'no zygos session could be minted — console unreachable');

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    // Evidence sinks — attached BEFORE any tap.
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const navPathnames: string[] = [];

    const page = await enter(context, '/modules');

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) {
        try {
          navPathnames.push(new URL(f.url()).pathname);
        } catch {
          navPathnames.push(f.url());
        }
      }
    });

    const urlAfterLanding = page.url();
    console.log(`[REPRO] landed at: ${urlAfterLanding}`);

    // 1) Open the drawer.
    await page.locator(id(IDS.menuToggle)).tap();
    await expect(page.locator(id(IDS.drawer)), 'drawer should open after tapping the hamburger').toBeVisible({
      timeout: 10_000,
    });
    console.log('[REPRO] drawer opened via hamburger tap');

    // 2) Expand the CRM group (A1 fix — group-header tap must NOT close the drawer). Confirm it holds.
    await page.locator(id(IDS.navGroupCrm)).tap();
    await expect(
      page.locator(id(IDS.navPeople)),
      'CRM group should expand and reveal the People leaf (drawer stays open — the A1 behaviour)',
    ).toBeVisible({ timeout: 10_000 });
    const drawerStillOpenAfterGroupTap = await page.locator(id(IDS.drawer)).isVisible();
    console.log(`[REPRO] after CRM group tap → People leaf visible; drawer still open: ${drawerStillOpenAfterGroupTap}`);

    // 3) THE FAILURE POINT — tap the People leaf with a REAL pointer event.
    const urlBeforeLeafTap = page.url();
    const navCountBeforeLeafTap = navPathnames.length;
    console.log(`[REPRO] URL before leaf tap: ${urlBeforeLeafTap}`);

    await page.locator(id(IDS.navPeople)).screenshot().catch(() => undefined); // best-effort, ignore
    await page.screenshot({ path: 'test-results/zygos-mobile-drawer-open.png' }).catch(() => undefined);

    await page.locator(id(IDS.navPeople)).tap();

    // Evidence window — let any navigation / close animation settle.
    await page.waitForTimeout(SETTLE_MS);

    const urlAfterLeafTap = page.url();
    const drawerVisibleAfterLeafTap = await page.locator(id(IDS.drawer)).isVisible();
    const navsDuringLeafTap = navPathnames.slice(navCountBeforeLeafTap);

    await page.screenshot({ path: 'test-results/zygos-mobile-drawer-after-leaf-tap.png' }).catch(() => undefined);

    console.log('───────────────────────────────────────────────────────────────');
    console.log('[REPRO] MOBILE LEAF-TAP EVIDENCE');
    console.log(`  URL before leaf tap : ${urlBeforeLeafTap}`);
    console.log(`  URL after  leaf tap : ${urlAfterLeafTap}`);
    console.log(`  URL changed         : ${urlBeforeLeafTap !== urlAfterLeafTap}`);
    console.log(`  pathname is /crm/people: ${new URL(urlAfterLeafTap).pathname === '/crm/people'}`);
    console.log(`  drawer visible after : ${drawerVisibleAfterLeafTap}`);
    console.log(`  framenavigated during tap (pathnames): ${JSON.stringify(navsDuringLeafTap)}`);
    console.log(`  ALL framenavigated pathnames so far  : ${JSON.stringify(navPathnames)}`);
    console.log(`  console errors during flow: ${JSON.stringify(consoleErrors.slice(0, 10))}`);
    console.log(`  page errors during flow   : ${JSON.stringify(pageErrors.slice(0, 10))}`);
    console.log('───────────────────────────────────────────────────────────────');

    // Permanent regression guard (HARD assertion): a mobile-drawer leaf tap MUST navigate.
    // This is the real end-to-end guard for the ui-nav 1.13.1 deferred-close fix — jsdom
    // cannot reproduce the native-listener/React-dispatch race, so a soft assertion here would
    // let the bug silently return (green-by-omission). Fail loudly instead.
    expect(new URL(urlAfterLeafTap).pathname, 'tapping People in the mobile drawer must navigate to /crm/people (ui-nav 1.13.1 deferred-close fix)').toBe('/crm/people');

    await context.close();
  });

  test('DESKTOP CONTROL — clicking the persistent rail People leaf navigates', async ({ browser }) => {
    test.setTimeout(120_000);
    test.skip(sessionCookies.length === 0, 'no zygos session could be minted — console unreachable');

    // No touch, wide viewport — the persistent rail, not the drawer.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    const page = await enter(context, '/modules');
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const urlBefore = page.url();

    // Expand CRM group on the rail, then click (not tap) the leaf.
    await page.locator(id(IDS.navGroupCrm)).click();
    await expect(page.locator(id(IDS.navPeople))).toBeVisible({ timeout: 10_000 });
    await page.locator(id(IDS.navPeople)).click();
    await page.waitForTimeout(SETTLE_MS);

    const urlAfter = page.url();
    console.log('───────────────────────────────────────────────────────────────');
    console.log('[REPRO] DESKTOP CONTROL EVIDENCE');
    console.log(`  URL before rail click: ${urlBefore}`);
    console.log(`  URL after  rail click: ${urlAfter}`);
    console.log(`  pathname is /crm/people: ${new URL(urlAfter).pathname === '/crm/people'}`);
    console.log(`  console errors: ${JSON.stringify(consoleErrors.slice(0, 10))}`);
    console.log(`  page errors   : ${JSON.stringify(pageErrors.slice(0, 10))}`);
    console.log('───────────────────────────────────────────────────────────────');

    expect
      .soft(new URL(urlAfter).pathname, 'clicking People on the desktop rail should navigate to /crm/people')
      .toBe('/crm/people');

    await context.close();
  });
});
