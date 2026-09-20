import { expect, test, type TestInfo } from '@playwright/test';

import {
  MIN_TARGET_PX,
  PORTAL_ROUTES,
  type RouteAudit,
  type RouteOverflow,
  auditRoute,
  expectNoHorizontalOverflowAcrossRoutes,
  expectTouchTargetsAcrossRoutes,
  measureHorizontalOverflow,
  portalFromProjectName,
} from '../../fixtures/mobile-gates.js';

/**
 * MOBILE-STD-1 "mobile gates and the shared breakpoint module" - AC-2/AC-3.
 *
 * ONE spec, run by one project per portal per device class. The portal is read
 * from the project name at RUN time (`mobile-gates-<portal>-<floor|pixel5>`)
 * and the routes come from `PORTAL_ROUTES`, so adding a portal is a project
 * entry plus a routes entry, never a copy of this file.
 *
 * Read-only: navigates public routes and measures. It never signs in, submits
 * a form, or writes anything.
 */

const NAV_SETTLE_MS = 400;
const LOAD_TIMEOUT_MS = 45_000;

test.describe.configure({ mode: 'serial' });

/** A portal with no deployed host for this E2E_TARGET is UNRUN, not green. */
function skipUnconfigured(testInfo: TestInfo, portal: string): void {
  const baseURL = testInfo.project.use.baseURL ?? '';
  test.skip(baseURL.includes('unconfigured.invalid'), `${portal}: no deployed host configured for this target`);
}

/**
 * AC-4 negative controls. Every one below was RUN and then REMOVED - a control
 * left in the suite plants a violation on every run. The procedure is recorded
 * here so the next reader can re-plant it in two minutes.
 *
 * 2026-09-20:
 *  - overflow gate: nextgame `/` at 360x640 green -> inject a 900px absolute
 *    div -> RED (`scrollWidth=900 vs visualViewport=360`) -> remove -> green.
 *  - touch-target gate: synthetic page, one 48x48 labelled button green ->
 *    inject a 28x44 `cursor:pointer` div with an onclick and no role/name ->
 *    RED (undersized AND unlabelled) -> remove -> green.
 *
 * 2026-09-21, for the two claims that were UNREACHABLE while the gate asserted
 * early (and unreachable precisely when there were findings):
 *  - unlabelled-only element WITH undersized findings already present: agora
 *    `/` 3 of 6 under 44px + 0 unlabelled -> 3 of 7 + 1, both in the SAME
 *    message; erevna `/` 31 of 42 + 3 -> 31 of 43 + 4.
 *  - blank route WITH other routes reporting findings: cleared `document.body`
 *    on nextgame `/age` only; the portal still reported all three routes.
 *
 * 2026-09-21, overflow early-exit (this change). `PLANT_OVERFLOW=1` injected a
 * 900px div on nextgame's LAST route (`/privacy`) only, so the plant sits
 * BEHIND two clean routes:
 *    nextgame: 4 reading(s), 1 scroll horizontally; worst overflow 540px
 *      / (on load): ok - scrollWidth=360 vs visualViewport=360
 *      /age (on load): ok - scrollWidth=360 vs visualViewport=360
 *      /privacy (on load): OVERFLOWS by 540px - scrollWidth=900 vs visualViewport=360
 *      after in-app navigation from / -> /age: ok - scrollWidth=360 vs visualViewport=360
 *  The two earlier routes and the post-navigation reading are all still
 *  reported in the same failure - the old per-route `expect` printed `/privacy`
 *  alone and never measured the navigation reading at all.
 *
 * 2026-09-21, PROBE controls (`PLANT_TARGETS=1`), on nextgame `/`:
 *  - a genuinely pressable 28x44 div, no role, no name, real `onclick`
 *    -> CAUGHT: total 6 -> 7, undersized 0 -> 1, unlabelled 0 -> 1
 *       (`div[planted-pressable] 28x44 via=handler name=""`).
 *  - a decorative 120x120 `aria-hidden="true"` div with `cursor:pointer` and an
 *    onclick -> IGNORED: it appears in neither column and does not move `total`.
 *  Both observed in one run, so the probe is neither role-blind nor
 *  cursor-credulous.
 */
test.describe('mobile gates', () => {
  test('no horizontal overflow, on load AND after navigating', async ({ page }, testInfo) => {
    const portal = portalFromProjectName(testInfo.project.name);
    const routes = PORTAL_ROUTES[portal];
    expect(routes, `no PORTAL_ROUTES entry for "${portal}"`).toBeTruthy();
    skipUnconfigured(testInfo, portal);

    // Measure EVERY route first, assert once per portal. Asserting inside this
    // loop meant the FIRST overflowing route hid every route after it, and the
    // post-navigation reading below was never taken at all.
    const readings: RouteOverflow[] = [];
    for (const path of routes) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);
      const r = await measureHorizontalOverflow(page, `${path} (on load)`);
      // A PASS that prints nothing is unreadable: the numbers are the evidence,
      // not the tick. One line per route, on green as well as red.
      console.log(`[gate] ${portal} ${path} overflow=${String(r.reading.overflowPx)}px`
        + ` scrollWidth=${String(r.reading.scrollWidth)} visualViewport=${String(Math.ceil(r.reading.visualViewportWidth))}`
        + ` drift=${String(r.reading.layoutViewportDrift)}`);
      readings.push(r);
    }

    // The defect this gate exists for does not exist until the visitor TAPS:
    // a transition layer widens the layout viewport permanently, and only a
    // post-navigation reading can see it.
    await page.goto(routes[0], { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
    const inAppLink = page.locator('a[href^="/"]:visible, [role="link"]:visible, [role="button"]:visible').first();
    if (await inAppLink.count() > 0) {
      await inAppLink.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(NAV_SETTLE_MS);
      const landed = new URL(page.url()).pathname;
      readings.push(await measureHorizontalOverflow(page, `after in-app navigation from ${routes[0]} -> ${landed}`));
    }

    expectNoHorizontalOverflowAcrossRoutes(readings, portal);
  });

  test(`every pressable is at least ${String(MIN_TARGET_PX)}px and carries a role or a name`, async ({ page }, testInfo) => {
    const portal = portalFromProjectName(testInfo.project.name);
    const routes = PORTAL_ROUTES[portal];
    expect(routes, `no PORTAL_ROUTES entry for "${portal}"`).toBeTruthy();
    skipUnconfigured(testInfo, portal);

    // Measure EVERY route first, assert once per portal. Asserting inside the
    // loop meant a portal whose `/` had findings never measured the routes
    // after it - nextgame `/age` and `/privacy` had never been read at all.
    const readings: RouteAudit[] = [];
    for (const path of routes) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);
      const a = await auditRoute(page, path);
      console.log(`[gate] ${portal} ${path} targets=${String(a.audit.total)}`
        + ` undersized=${String(a.audit.undersized.length)} unlabelled=${String(a.audit.unlabelled.length)}`
        + ` funnel=${String(a.audit.probe.raw)}/${String(a.audit.probe.afterWrapper)}/${String(a.audit.probe.kept)}`);
      readings.push(a);
    }
    expectTouchTargetsAcrossRoutes(readings, portal);
  });
});
