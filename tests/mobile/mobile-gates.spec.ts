import { expect, test, type TestInfo } from '@playwright/test';

import {
  MIN_TARGET_PX,
  PORTAL_ROUTES,
  expectNoHorizontalOverflow,
  expectTouchTargets,
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
 * AC-4 negative control, run 2026-09-20 and REMOVED after both observations
 * (a control kept in the suite plants a violation on every run):
 *  - overflow gate: nextgame `/` at 360x640 green -> inject a 900px absolute
 *    div -> RED (`scrollWidth=900 vs visualViewport=360`) -> remove it -> green.
 *  - touch-target gate: a synthetic page with one 48x48 labelled button green
 *    -> inject a 28x44 `cursor:pointer` div with an onclick and no role/name
 *    -> RED (undersized AND unlabelled) -> remove it -> green.
 */

test.describe('mobile gates', () => {
  test('no horizontal overflow, on load AND after navigating', async ({ page }, testInfo) => {
    const portal = portalFromProjectName(testInfo.project.name);
    const routes = PORTAL_ROUTES[portal];
    expect(routes, `no PORTAL_ROUTES entry for "${portal}"`).toBeTruthy();
    skipUnconfigured(testInfo, portal);

    for (const path of routes) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);
      await expectNoHorizontalOverflow(page, `${portal} ${path} (on load)`);
    }

    // The defect this gate exists for does not exist until the visitor TAPS:
    // a transition layer widens the layout viewport permanently, and only a
    // post-navigation reading can see it.
    await page.goto(routes[0], { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
    const inAppLink = page.locator('a[href^="/"]:visible, [role="link"]:visible, [role="button"]:visible').first();
    if (await inAppLink.count() > 0) {
      await inAppLink.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(NAV_SETTLE_MS);
      await expectNoHorizontalOverflow(page, `${portal} after in-app navigation from ${routes[0]}`);
    }
  });

  test(`every pressable is at least ${String(MIN_TARGET_PX)}px and carries a role or a name`, async ({ page }, testInfo) => {
    const portal = portalFromProjectName(testInfo.project.name);
    const routes = PORTAL_ROUTES[portal];
    expect(routes, `no PORTAL_ROUTES entry for "${portal}"`).toBeTruthy();
    skipUnconfigured(testInfo, portal);

    for (const path of routes) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);
      await expectTouchTargets(page, `${portal} ${path}`);
    }
  });
});
