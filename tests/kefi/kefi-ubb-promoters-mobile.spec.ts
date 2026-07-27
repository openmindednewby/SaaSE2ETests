/**
 * Kefi UBB — the ORGANIZER PROMOTER TABLE at phone and tablet width.
 *
 * This is the least-verified change in the UBB pre-sale batch. The table grew to
 * SEVEN columns (name, role, status, headcount, instagram, flags, actions) and
 * was opted into the shared kit's card-stack below 768px by setting
 * `PROMOTERS_STACK_BREAKPOINT = 768`. Every other kefi table keeps
 * `stackBreakpoint = 0`, which means "never stack" — so this call site is the
 * first in the product to use the stacking path at all, and it had never been
 * opened in a browser at any width when these tests were written.
 *
 * Two failure modes are worth distinguishing, because they look identical in a
 * screenshot and have opposite fixes:
 *
 *   1. The stack never engages (the prop does not reach the kit, the width
 *      source is wrong) → seven columns squeezed into 375px. Detected here by
 *      the HEADER ROW, which the kit renders only on its desktop path
 *      (`ui-data-table-head`, absent in the stacked branch).
 *   2. The stack engages but the Actions column's real buttons end up clipped
 *      or thumb-sized-wrong → the organizer cannot retire an act at the door.
 *      Detected by measuring each button's box.
 *
 * ── PROD SAFETY ────────────────────────────────────────────────────────────
 * This spec runs against the DEPLOYED kefi-web with the real UBB organizer, so
 * it is deliberately READ-MOSTLY:
 *
 *   - It NEVER presses Retire/Restore. That is a PUT that deactivates a real
 *     act, which would pull that ambassador off the public register form days
 *     before pre-sale. Its reachability is proven by MEASURING the button
 *     (rendered, on-screen, correctly sized, enabled) rather than firing it.
 *   - It DOES press Edit, which is purely client-side — `onEdit` only lifts the
 *     row into the local form state. No request is made. That is what proves
 *     the Actions column is genuinely tappable and not merely painted.
 *   - It creates no attendee rows.
 *
 * ⚠️ RUN THE THREE DEVICE PROJECTS SERIALLY (`--workers=1`). Each one signs in
 * as the SAME real UBB organizer over ROPC, and running them in parallel has
 * already produced a transient `invalid_grant` 401 from Keycloak's brute-force
 * protection. On a live account days before pre-sale, a lockout is a far worse
 * outcome than a slow test run.
 */

import { test, expect } from '@playwright/test';

import { attachConsoleGuard } from '../../helpers/consoleGuard.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiOrganizerPage } from '../../pages/kefi/KefiOrganizerPage.js';
import { KefiOrganizerTabsPage } from '../../pages/kefi/KefiOrganizerTabsPage.js';
import { KefiPromoterClient } from '../../helpers/kefi/kefiPromoterClient.js';
import {
  expectNoHorizontalOverflow,
  expectTapTargetSize,
  expectWithinViewportWidth,
} from '../../helpers/kefi/mobileLayout.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

/**
 * The width below which the promoters table card-stacks
 * (`PROMOTERS_STACK_BREAKPOINT` in the component). Mirrored, not imported —
 * E2E asserts the shipped BEHAVIOUR, and importing the constant would make a
 * change to it silently rewrite the expectation too.
 */
const STACK_BREAKPOINT_PX = 768;

/** The kit's header-row testID. Rendered on the desktop path only. */
const TABLE_HEAD_TEST_ID = 'ui-data-table-head';

const PROMOTERS_SECTION = 'organizer-promoters-manager';
const PROMOTERS_TABLE = 'organizer-promoters-manager-table';

test.describe('Kefi UBB organizer promoter table on mobile', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui the promoter table is usable at this viewport and its row actions are reachable', async ({
    page,
  }, testInfo) => {
    const guard = attachConsoleGuard(page);
    const ops = await openEventOps();

    const viewport = page.viewportSize();
    expect(viewport, 'the test runs with a real device viewport').not.toBeNull();
    const width = viewport!.width;
    const shouldStack = width < STACK_BREAKPOINT_PX;
    testInfo.annotations.push({
      type: 'viewport',
      description: `${width}×${viewport!.height} — expected ${shouldStack ? 'CARD STACK' : 'desktop grid'}`,
    });

    // Read the roster server-side first: the row-action testIDs are keyed by
    // promoter externalId, and asserting against ids obtained from the API
    // (rather than scraped from the DOM) means a table that renders the WRONG
    // rows fails here instead of quietly agreeing with itself.
    const promoterApi = new KefiPromoterClient();
    const promoters = await promoterApi.list(ops.bearer, ops.tenant.eventExternalId);
    expect(
      promoters.length,
      'the UBB event has promoters to manage — with an empty roster this spec proves nothing',
    ).toBeGreaterThan(0);

    const login = new KefiLoginPage(page);
    await login.goto();
    await login.signIn({
      email: ops.tenant.organizerEmail,
      password: ops.tenant.organizerPassword,
    });

    const organizer = new KefiOrganizerPage(page);
    await organizer.gotoEvent(ops.tenant.eventExternalId);
    await organizer.waitForTerminalState();
    await organizer.expectRendered();

    // Reaching an organizer screen REQUIRES loading the app unauthenticated
    // first, and the session probe `GET /bff/me` answers 401 by design at that
    // moment (verified directly: unauthenticated /bff/me -> 401). The browser
    // logs every failed fetch as a console error, so this spec would otherwise
    // inherit a guaranteed 401 from the sign-in it had to perform.
    //
    // Reset rather than allow-list it: the console text is only "Failed to load
    // resource: the server responded with a status of 401 ()" with NO url, so
    // any pattern broad enough to match would also swallow a real 401 raised BY
    // the promoters screen — precisely the defect this guard exists to catch.
    // Everything from here on is the surface under test.
    guard.reset();

    // The organizer dashboard became an 8-tab shell (kefi-web overhaul): only
    // the ACTIVE tab's panel is mounted, so the promoters manager is not on the
    // default Overview load. Select the Promoters tab to mount it — this also
    // exercises that the tab strip is reachable and tappable at this viewport,
    // which is exactly the mobile concern this spec exists to guard. The strip
    // scrolls horizontally on a phone; Playwright scrolls the tab into view
    // before the click.
    const tabs = new KefiOrganizerTabsPage(page);
    await tabs.selectTab('promoters');

    const section = page.getByTestId(PROMOTERS_SECTION);
    await expect(
      section,
      'the promoters manager section is on the organizer dashboard',
    ).toBeVisible();
    await section.scrollIntoViewIfNeeded();

    const table = page.getByTestId(PROMOTERS_TABLE);
    await expect(table, 'the promoters table rendered with rows').toBeVisible();

    // ── 0. IS THE CHANGE UNDER TEST EVEN DEPLOYED? ───────────────────────────
    // Checked FIRST and separately, because otherwise this spec reports the
    // wrong defect. The card-stack, the seventh column and the row actions all
    // arrived in the same commit; against a build that predates it the stack
    // assertion below fails with "the table did not stack", which reads as a
    // broken layout when the truth is that the layout is not in production yet.
    // Those two need completely different responses — deploy vs fix — so the
    // suite must never confuse them.
    const target = promoters[0];
    const editButton = page.getByTestId(`organizer-promoter-edit-${target.externalId}`);
    const retireButton = page.getByTestId(`organizer-promoter-toggle-active-${target.externalId}`);

    await expect(
      editButton,
      'The deployed kefi-web does not have the promoter row actions, so this build PREDATES the ' +
        'promoters-are-editable change (the same commit that added the 768px card-stack and the ' +
        'seventh column). Nothing below this point can be verified against it. This is a DEPLOY ' +
        'gap, not a layout defect — ship kefi-web, then re-run.',
    ).toHaveCount(1);

    // ── 1. Did the card-stack actually engage? ───────────────────────────────
    // The header row is the kit's own tell: it exists on the desktop path and
    // is absent in the stacked branch. Scoped INSIDE this table because the
    // organizer dashboard renders several tables and they all share the head's
    // fixed testID — an unscoped query would read another table's header and
    // report the opposite answer.
    const head = table.getByTestId(TABLE_HEAD_TEST_ID);

    // Diagnostics gathered BEFORE the assertion, because "the table did not
    // stack" has several very different causes and the failure message has to
    // say which one. The decisive number is `innerWidth`: the kit stacks on
    // `useWindowDimensions()`, which reads the LAYOUT viewport. If the document
    // has no `<meta name="viewport">`, mobile Chromium defaults that to ~980px
    // regardless of the device's real 320px screen — so the kit is told it has
    // a desktop and behaves correctly on wrong information. That is a document
    // -level defect affecting EVERY responsive rule in the app, not a bug in
    // this table.
    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      viewportMeta:
        document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
    }));
    testInfo.annotations.push({
      type: 'layout',
      description:
        `device=${width}px innerWidth=${layout.innerWidth}px ` +
        `viewportMeta=${layout.viewportMeta ?? 'MISSING'}`,
    });

    const widthMismatch =
      layout.innerWidth !== width
        ? `\n    ⚠️ The app sees innerWidth=${layout.innerWidth}px on a ${width}px device, and the ` +
          `page's viewport meta is ${layout.viewportMeta === null ? 'MISSING' : `"${layout.viewportMeta}"`}. ` +
          'The kit stacks on useWindowDimensions(), which reads that width — so the table is ' +
          'behaving correctly on wrong information, and EVERY responsive rule in the app is ' +
          'equally affected. Fix the document viewport, not this table.\n'
        : '';

    if (shouldStack) {
      await expect(
        head,
        `at ${width}px the promoters table must card-stack, but it still renders the desktop ` +
          'header row — so seven columns are being squeezed onto a phone. This is the change ' +
          `that was shipped unverified: \`stackBreakpoint={768}\` is not taking effect.${widthMismatch}`,
      ).toHaveCount(0);
    } else {
      await expect(
        head,
        `at ${width}px (>= the ${STACK_BREAKPOINT_PX}px breakpoint) the table should keep the ` +
          'desktop grid, but the header row is missing — the breakpoint is off by one and ' +
          'tablets are getting the phone layout.',
      ).toHaveCount(1);
    }

    // ── 2. Does the page fit? ────────────────────────────────────────────────
    // Runs at EVERY width, including the tablet. 768px is the interesting case:
    // it is wide enough to skip the stack yet still has to fit seven columns.
    await expectNoHorizontalOverflow(page, `the organizer dashboard at ${width}px`);
    await expectWithinViewportWidth(page, table, 'the promoters table');

    // ── 3. Are the row actions reachable and tappable? ───────────────────────
    // The Actions column holds the only controls on this surface. A stacked
    // card that hides or clips them is worse than not stacking at all.
    await editButton.scrollIntoViewIfNeeded();
    await expect(editButton, `the Edit action for "${target.name}" is rendered`).toBeVisible();
    await expect(retireButton, `the Retire action for "${target.name}" is rendered`).toBeVisible();

    await expectWithinViewportWidth(page, editButton, `the Edit button for "${target.name}"`);
    await expectWithinViewportWidth(page, retireButton, `the Retire button for "${target.name}"`);
    await expectTapTargetSize(editButton, `the Edit button for "${target.name}"`);
    await expectTapTargetSize(retireButton, `the Retire button for "${target.name}"`);

    // Retire is measured but NEVER pressed — see the prod-safety note in the
    // header. `toBeEnabled` is the strongest claim available without firing a
    // PUT that would pull a real ambassador off the public register form.
    await expect(
      retireButton,
      `the Retire action for "${target.name}" is enabled (not pressed here — it would ` +
        'deactivate a real act days before pre-sale)',
    ).toBeEnabled();

    // ── 4. Edit actually responds to a tap ───────────────────────────────────
    // Client-side only: `onEdit` opens the one-at-a-time row-action modal
    // (kefi-web overhaul) with the edit form loaded — no request is made.
    // Pressing it is what separates "the button is painted at the right size"
    // from "the button works". The modal appearing (centered in the viewport) is
    // the proof the Actions column responds to touch; the `cancel-edit` control
    // inside it renders only when editing an existing row.
    await editButton.click();
    const actionModal = page.getByTestId('organizer-promoter-action-modal');
    await expect(
      actionModal,
      `pressing Edit on "${target.name}" opens the row-action modal. If this fails the Actions ` +
        'column renders but does not respond to touch.',
    ).toBeVisible();
    await expect(
      actionModal.getByTestId('organizer-promoter-cancel-edit'),
      `the modal loaded the EDIT form for "${target.name}" (cancel-edit renders only when editing)`,
    ).toBeVisible();

    guard.expectClean(`the organizer promoters manager at ${width}px`);
  });
});
