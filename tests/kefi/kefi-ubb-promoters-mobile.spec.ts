/**
 * Kefi UBB — the ORGANIZER CREW ROSTER promoter card at phone and tablet width.
 *
 * The standalone Promoters manager table is gone (kefi-web #311): promoters
 * (teachers / ambassadors / promoters / organizers) now live ONLY in the crew
 * Roster, grouped into collapsible per-role cards. A promoter-source card is the
 * widest table in the product — SEVEN columns (name, commission, Instagram,
 * flags, personal link, staff ticket, details) — and the one call site that opts
 * into the shared kit's card-stack, below 900px (`ROSTER_STACK_BREAKPOINT_PX` in
 * `CategoryRosterCard.tsx`). Every other kefi table keeps `stackBreakpoint = 0`
 * ("never stack"), so this is the first product surface to stack at all.
 *
 * Two failure modes look identical in a screenshot and have opposite fixes:
 *   1. The stack never engages → seven columns squeezed into 375px. Detected by
 *      the HEADER ROW, which the kit renders only on its desktop path
 *      (`ui-data-table-head`, absent in the stacked branch).
 *   2. The stack engages but the promoter's actions become unreachable → the
 *      organizer cannot retire an act at the door. The actions moved into the
 *      per-person detail modal, so reachability is proven by opening that act's
 *      detail from the roster card's View action and MEASURING the Edit / Retire
 *      buttons inside it (rendered, on-screen, correctly sized, enabled).
 *
 * ── PROD SAFETY ────────────────────────────────────────────────────────────
 * Runs against the DEPLOYED kefi-web with the real UBB organizer, so READ-MOSTLY:
 *   - NEVER presses Retire/Restore — a PUT that deactivates a real act and would
 *     pull that ambassador off the public register form days before pre-sale. Its
 *     reachability is proven by MEASURING the button (rendered, on-screen,
 *     correctly sized, enabled) rather than firing it.
 *   - DOES press Edit, purely client-side — `onEdit` only lifts the row into the
 *     local form state (the edit form opens in the same modal), no request made.
 *     That is what proves the action is genuinely tappable, not merely painted.
 *   - Creates no promoter/attendee rows (asserts against externalIds the API
 *     returns; never POSTs a promoter).
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
 * The width below which the roster's promoter cards card-stack
 * (`ROSTER_STACK_BREAKPOINT_PX` in `CategoryRosterCard.tsx`). Mirrored, not
 * imported — E2E asserts the shipped BEHAVIOUR, and importing the constant would
 * make a change to it silently rewrite the expectation too.
 */
const STACK_BREAKPOINT_PX = 900;

/** The kit's header-row testID. Rendered on the desktop path only. */
const TABLE_HEAD_TEST_ID = 'ui-data-table-head';

/** The RosterSection container testID (present on the Promoters tab). */
const ROSTER_SECTION = 'organizer-crew-roster';

/**
 * Promoter-source role → roster category key (mirrors `ROSTER_CATEGORIES` in
 * `crew/utils/rosterHelpers.ts`, matched case-insensitively). A promoter-table
 * act (teacher / ambassador / promoter / organizer) lands in exactly one of
 * these collapsible per-role cards; all four carry the wide 7-column promoter
 * column set, so any of them exercises the stacking path this spec guards.
 */
const PROMOTER_ROLE_TO_CATEGORY: Readonly<Record<string, string>> = {
  teacher: 'teachers',
  ambassador: 'ambassadors',
  promoter: 'promoters',
  organizer: 'organizers',
};

/** The roster category key for a promoter role, or null if it maps to none. */
function promoterCategoryKey(role: string): string | null {
  return PROMOTER_ROLE_TO_CATEGORY[role.toLowerCase()] ?? null;
}

test.describe('Kefi UBB organizer crew roster promoter card on mobile', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@ui the promoter roster card is usable at this viewport and its row actions are reachable', async ({
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
    // (rather than scraped from the DOM) means a roster that renders the WRONG
    // rows fails here instead of quietly agreeing with itself.
    const promoterApi = new KefiPromoterClient();
    const promoters = await promoterApi.list(ops.bearer, ops.tenant.eventExternalId);
    expect(
      promoters.length,
      'the event has promoters to manage — with an empty roster this spec proves nothing',
    ).toBeGreaterThan(0);

    // The target promoter and the collapsible roster card it lands in. All four
    // promoter-source roles carry the 7-column card, so any exercises the stacking
    // path — the category is derived from the row rather than hardcoded to
    // `promoters`, since the fixture may hold only ambassadors/teachers.
    const target = promoters[0];
    const categoryKey = promoterCategoryKey(target.role);
    expect(
      categoryKey,
      `the promoter "${target.name}" (role "${target.role}") groups into a promoter roster card`,
    ).not.toBeNull();
    const cardTestId = `organizer-crew-roster-${categoryKey}`;
    // Non-empty bucket (target is in it) → the table keeps its base testID; the
    // shared table only switches to `${id}-empty` when it has zero rows.
    const tableTestId = `${cardTestId}-table`;

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
    // logs it as a console error. Reset rather than allow-list it: the text is
    // only "Failed to load resource: ... 401 ()" with NO url, so any pattern
    // broad enough to match would also swallow a real 401 raised BY the roster
    // screen — precisely the defect this guard exists to catch. Everything from
    // here on is the surface under test.
    guard.reset();

    // The organizer dashboard is an 8-tab shell (kefi-web overhaul): only the
    // ACTIVE tab's panel is mounted, so the crew roster is not on the default
    // Overview load. Select the Promoters tab to mount it — this also exercises
    // that the tab strip is reachable and tappable at this viewport, exactly the
    // mobile concern this spec exists to guard. The strip scrolls horizontally on
    // a phone; Playwright scrolls the tab into view before the click.
    const tabs = new KefiOrganizerTabsPage(page);
    await tabs.selectTab('promoters');

    const roster = page.getByTestId(ROSTER_SECTION);
    await expect(roster, 'the crew roster section is on the Promoters tab').toBeVisible();

    // ── 0. IS THE CHANGE UNDER TEST EVEN DEPLOYED? ───────────────────────────
    // Checked FIRST and separately: otherwise this spec reports the wrong defect.
    // The card-stack, the promoter columns and the detail-modal actions all
    // arrived in the same merge; against an older build the card is absent and
    // the stack assertion would read as a broken layout, not a missing deploy.
    const card = page.getByTestId(cardTestId);
    await expect(
      card,
      `The deployed kefi-web does not render the "${categoryKey}" crew roster card, so this build ` +
        'PREDATES the crew-roster merge (the same change that added the 900px card-stack and moved ' +
        'the promoter actions into the detail). Nothing below can be verified against it. This is a ' +
        'DEPLOY gap, not a layout defect — ship kefi-web, then re-run.',
    ).toHaveCount(1);
    await card.scrollIntoViewIfNeeded();

    // Expand the target's category card if collapsed — the roster starts with
    // only the first card open and a collapsed card UNMOUNTS its table.
    const table = page.getByTestId(tableTestId);
    if (!(await table.isVisible())) {
      await page.getByTestId(`${cardTestId}-toggle`).click();
    }
    await expect(table, 'the promoter roster card table rendered with rows').toBeVisible();

    // ── 1. Did the card-stack actually engage? ───────────────────────────────
    // The header row is the kit's own tell: present on the desktop path, absent
    // in the stacked branch. Scoped INSIDE this table because the roster renders
    // several tables sharing the head's fixed testID — an unscoped query would
    // read another card's header and report the opposite answer.
    const head = table.getByTestId(TABLE_HEAD_TEST_ID);

    // Diagnostics gathered BEFORE the assertion, because "the table did not
    // stack" has several very different causes and the failure message has to say
    // which one. The decisive number is `innerWidth`: the kit stacks on
    // `useWindowDimensions()` (the LAYOUT viewport). With no `<meta name=viewport>`
    // mobile Chromium defaults that to ~980px regardless of the real screen — so
    // the kit behaves correctly on wrong information, a document-level defect
    // affecting EVERY responsive rule in the app, not a bug in this table.
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
        `at ${width}px the promoter roster card must card-stack, but it still renders the desktop ` +
          'header row — so seven columns are being squeezed onto a phone. This is the change ' +
          `that shipped this stacking path: \`stackBreakpoint={900}\` is not taking effect.${widthMismatch}`,
      ).toHaveCount(0);
    } else {
      await expect(
        head,
        `at ${width}px (>= the ${STACK_BREAKPOINT_PX}px breakpoint) the card should keep the ` +
          'desktop grid, but the header row is missing — the breakpoint is off by one and ' +
          'tablets are getting the phone layout.',
      ).toHaveCount(1);
    }

    // ── 2. Does the page fit? ────────────────────────────────────────────────
    // Runs at EVERY width. Widths just under 900px are the interesting case: wide
    // enough to skip the stack yet still has to fit seven columns.
    await expectNoHorizontalOverflow(page, `the organizer crew roster at ${width}px`);
    await expectWithinViewportWidth(page, table, 'the promoter roster card table');

    // ── 3. Is the row's View action reachable and tappable? ──────────────────
    // The stacked card's only per-row control is the View action that opens the
    // detail. A stacked card that hides or clips it is worse than not stacking.
    const viewButton = tabs.promoterRosterViewButton(target.externalId);
    await viewButton.scrollIntoViewIfNeeded();
    await expect(viewButton, `the View action for "${target.name}" is rendered`).toBeVisible();
    await expectWithinViewportWidth(page, viewButton, `the View button for "${target.name}"`);
    await expectTapTargetSize(viewButton, `the View button for "${target.name}"`);

    // ── 4. The promoter's actions are reachable inside the detail modal ───────
    // The Edit / Retire actions now live in the detail (no longer in-table); the
    // modal opening is the proof the roster's View action responds to touch.
    await tabs.openPromoterDetail(target.externalId);
    const modal = tabs.promoterActionModal; // organizer-crew-detail-modal
    const editButton = modal.getByTestId(`organizer-promoter-edit-${target.externalId}`);
    const retireButton = modal.getByTestId(`organizer-promoter-toggle-active-${target.externalId}`);

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

    // Edit actually responds to a tap. Client-side only: `onEdit` loads the row
    // into the edit form (opens in the same modal) — no request is made. The
    // `cancel-edit` control renders only when editing an existing row, so its
    // presence proves the EDIT form loaded and the action is live, not painted.
    await editButton.click();
    await expect(
      modal.getByTestId('organizer-promoter-cancel-edit'),
      `pressing Edit on "${target.name}" loaded the EDIT form in the detail (cancel-edit renders ` +
        'only when editing an existing row). If this fails the action renders but does not respond to touch.',
    ).toBeVisible();

    guard.expectClean(`the organizer crew roster promoter card at ${width}px`);
  });
});
