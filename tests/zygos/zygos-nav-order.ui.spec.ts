// FINREG console — module-group RAIL ORDER (#178). The owner reordered the sidebar module
// groups to CRM → Accounting → Payments (and the /modules catalogue cards follow the same
// order). This asserts the DOM order of the persistent rail's group headers matches, in a real
// browser — a guard that a future reorder of `MODULE_GROUPS` in `zygos/finreg-web` cannot
// silently drift the shipped order without failing here.
//
// Auth: reuses the zygos session harness (loginAsDemo → parkedCookies fallback). No passwords
// typed, so the 5-logins/60s budget is spent at most once. The DEMO tenant is preferred (seeded),
// though every group header renders regardless of tenant data.
import { expect, test } from '@playwright/test';

import { ZYGOS_WEB_URL } from './zygos-helpers.js';
import { loginAsDemo, parkedCookies } from './zygos-session.js';

const id = (testId: string): string => `[data-testid="${testId}"]`;

const IDS = {
  shell: 'zygos-app-shell',
  navGroupCrm: 'nav-group-crm',
} as const;

/** The one canonical order — mirrors `MODULE_GROUPS` / `MODULES` in zygos/finreg-web. */
const EXPECTED_GROUP_ORDER = ['nav-group-crm', 'nav-group-accounting', 'nav-group-payments'] as const;

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

test.describe('Zygos console — module rail order @zygos-ui @ui', () => {
  test('the module groups render in owner order: CRM → Accounting → Payments (#178)', async ({ browser }) => {
    test.setTimeout(120_000);
    test.skip(sessionCookies.length === 0, 'no zygos session could be minted — console unreachable');

    // Wide viewport → the PERSISTENT rail (not the mobile drawer), so the group headers are
    // present in the DOM whether or not each group is expanded.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(sessionCookies);
    const page = await context.newPage();

    await page.goto(`${ZYGOS_WEB_URL}/modules`, { waitUntil: 'commit' });
    await expect(page.locator(id(IDS.shell))).toBeVisible({ timeout: 30_000 });
    // The rail carries all three group headers; the CRM one leading confirms the rail rendered.
    await expect(page.locator(id(IDS.navGroupCrm)).first()).toBeVisible({ timeout: 15_000 });

    // Read every element whose testID begins `nav-group-` in DOM (document) order, then keep ONLY
    // the three real group headers — the rail also renders decorative `nav-group-*-tint` siblings,
    // and (if a drawer co-mounted) each header can appear twice. Filtering to the known set +
    // deduping still asserts the genuine top-to-bottom order of the three group headers.
    const knownGroups = new Set<string>(EXPECTED_GROUP_ORDER);
    const domOrder = await page
      .locator('[data-testid^="nav-group-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    const seen = new Set<string>();
    const orderedGroups = domOrder.filter((testId): testId is string => {
      if (testId === null || !knownGroups.has(testId) || seen.has(testId)) return false;
      seen.add(testId);
      return true;
    });

    expect(
      orderedGroups,
      `sidebar module groups must be CRM → Accounting → Payments (#178); got ${JSON.stringify(orderedGroups)}`,
    ).toEqual([...EXPECTED_GROUP_ORDER]);

    await context.close();
  });
});
