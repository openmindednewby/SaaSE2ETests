// Zygos pagination parity (UX-6a) — the shared `Pager` config on BOTH paged screens.
//
// `InstructionsScreen` and `ApprovalsScreen` now pass `rowsVariant="dropdown"` + `responsive` +
// `showFirstLast`. "Parity" is the actual requirement: the two screens drifting apart is the
// regression, so every assertion here runs against both pagers from one table rather than being
// written once for instructions and forgotten for approvals.
//
// 🔴 THE NARROW-VIEWPORT COLLAPSE IS THE POINT OF THIS FILE. Desktop behaviour was already
// confirmed by hand in the visual-QA pass; the mobile collapse was NOT — that tool's viewport
// resize was broken, so `responsive` shipped with nobody having ever seen it work. Playwright can
// set a viewport, so this is the one place the collapse can actually be proven.
//
// The contract comes from the shipped component, not from guesswork
// (`@dloizides/ui-tables` → `isCompact = responsive && width < stackBreakpoint`, default 640;
// `showJumps = showFirstLast && !isCompact`; the rows control is behind the same `!isCompact`):
//
//   ≥ 640px → rows-per-page dropdown + First/Last + Prev/Next + count line
//   < 640px → Prev/Next + count line ONLY (rows control and the jumps are gone)
//
// NO hard waits anywhere. Every step waits on a canonical signal: the screen's own testID, or the
// count line's text changing to the value the action must produce.
import { expect, test } from '@playwright/test';

import {
  CONSOLE_TEST_IDS,
  PAGER_TEST_IDS,
  enterConsole,
  gotoScreen,
  id,
  sizeOption,
  sizeTrigger,
} from './zygos-console-ui.js';

import type { Locator, Page } from '@playwright/test';

/** `PAGE_SIZE_OPTIONS` from `zygos-web/src/domain/instructionQuery.ts`. */
const SMALL_PAGE_SIZE = 25;

/** `CARD_STACK_BREAKPOINT` — the shared default the screens do not override. */
const STACK_BREAKPOINT = 640;
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** The two paged screens, driven by the same assertions. */
const PAGED_SCREENS: readonly {
  name: string;
  path: string;
  screenTestId: string;
  pagerTestId: string;
  emptyTestId: string;
}[] = [
  {
    name: 'instructions',
    path: '/instructions',
    screenTestId: CONSOLE_TEST_IDS.instructionsScreen,
    pagerTestId: CONSOLE_TEST_IDS.instructionsPager,
    emptyTestId: CONSOLE_TEST_IDS.instructionsEmpty,
  },
  {
    name: 'approvals',
    path: '/approvals',
    screenTestId: CONSOLE_TEST_IDS.approvalsScreen,
    pagerTestId: CONSOLE_TEST_IDS.approvalsPager,
    emptyTestId: CONSOLE_TEST_IDS.approvalsEmpty,
  },
];

/**
 * Parse `Showing 1–25 of 137 instructions` into its three numbers.
 *
 * Tolerates an en-dash or a hyphen and any surrounding words, because the count line is assembled
 * from `infoPrefix` + `unitLabel` and both are translated — pinning the exact sentence would make
 * this spec fail on a copy change that harms nobody.
 */
function parseInfo(text: string): { from: number; to: number; total: number } | null {
  const match = /([\d,\s]+)[–-]([\d,\s]+)\s+of\s+([\d,]+)/.exec(text);
  if (match === null) return null;
  const digits = (value: string): number => Number(value.replace(/[,\s]/g, ''));
  return { from: digits(match[1]), to: digits(match[2]), total: digits(match[3]) };
}

/** Read the pager's count line, failing with the raw text when it cannot be parsed. */
async function readInfo(pager: Locator): Promise<{ from: number; to: number; total: number }> {
  const raw = (await pager.locator(id(PAGER_TEST_IDS.info)).innerText()).trim();
  const parsed = parseInfo(raw);
  expect(parsed, `could not parse the pager count line: "${raw}"`).not.toBeNull();
  return parsed as { from: number; to: number; total: number };
}

/** Is this nav button disabled? `NavButton` sets `accessibilityState={{ disabled }}` ⇒ aria-disabled. */
async function isDisabled(pager: Locator, part: string): Promise<boolean> {
  const button = pager.locator(id(part));
  const aria = await button.getAttribute('aria-disabled');
  const native = await button.getAttribute('disabled');
  return aria === 'true' || native !== null;
}

/** Enter a paged screen at a fixed viewport. */
async function openPagedScreen(
  page: Page,
  screen: (typeof PAGED_SCREENS)[number],
  viewport: { width: number; height: number },
): Promise<Locator> {
  await page.setViewportSize(viewport);
  await enterConsole(page, '/');
  await gotoScreen(page, screen.path, screen.screenTestId);

  // 🔴 AN EMPTY LIST HAS NO PAGER, AND THAT IS CORRECT — assert it, then skip.
  //
  // Both screens render `EmptyListState` INSTEAD of the filters + pager. The approvals QUEUE is
  // also shared, mutable state: the maker-checker specs in this same suite approve and reject
  // instructions, so by the time these tests run the queue can legitimately be empty. Running the
  // pager specs alone, it had 31 rows; running the FULL suite, this test hard-failed with
  // "approvals has no pager" — a test-isolation artifact reported as a product defect, which is
  // precisely the false alarm this suite exists to avoid.
  //
  // Distinguishing the two states is what makes it honest: empty-state present ⇒ skip (nothing to
  // paginate); empty-state ABSENT and still no pager ⇒ a real failure, and it still fails.
  const emptyState = page.locator(id(screen.emptyTestId));
  if ((await emptyState.count()) > 0) {
    test.skip(true, `the ${screen.name} list is empty (EmptyListState shown), so there is no pager to exercise`);
  }

  const pager = page.locator(id(screen.pagerTestId));
  await expect(
    pager,
    `${screen.name} rendered neither a pager NOR the empty state — the list has rows but the Pager did not render`,
  ).toBeVisible();
  return pager;
}

test.describe('Zygos pagination parity @zygos-ui @ui', () => {
  for (const screen of PAGED_SCREENS) {
    test.describe(`${screen.name} pager`, () => {
      test(`🔴 rows-per-page is a real dropdown and re-pages the ${screen.name} grid`, async ({ page }) => {
        const pager = await openPagedScreen(page, screen, DESKTOP);
        const info = pager.locator(id(PAGER_TEST_IDS.info));
        const before = await readInfo(pager);

        // Nothing to page through — assert the pager is honest about that and stop. A tenant with
        // few rows is a legitimate state, not a failure, and forcing rows here would make the spec
        // depend on seed volume it does not control.
        test.skip(
          before.total <= SMALL_PAGE_SIZE,
          `only ${String(before.total)} row(s) on ${screen.name} — fewer than one page, nothing to paginate`,
        );

        // `rowsVariant="dropdown"`: a trigger that opens a menu, NOT the default row of pills.
        const trigger = pager.locator(id(sizeTrigger(screen.pagerTestId)));
        await expect(trigger, 'no size trigger ⇒ rowsVariant="dropdown" was not applied').toBeVisible();
        await trigger.click();

        // 🔴 THE OPEN MENU IS **NOT** INSIDE THE PAGER. `RowsControl` renders it with a
        // `position: fixed` overlay anchored to the trigger's measured rect, so it lands OUTSIDE
        // the pager's subtree. Scoping the option lookup to `pager` (the obvious thing to write,
        // and what this spec did first) finds nothing and fails with "the 25 rows-per-page option
        // is not offered" while the menu is plainly open on screen — the trigger even reports
        // `aria-expanded="true"`. Verified by dumping the DOM: the trigger is inside the pager,
        // the menu and every option are not. So options are located from `page`.
        const option = page.locator(id(sizeOption(screen.pagerTestId, SMALL_PAGE_SIZE)));
        await expect(option, `the ${String(SMALL_PAGE_SIZE)} rows-per-page option is not offered`).toBeVisible();
        await option.click();

        // The canonical readiness signal: the count line itself must report the new window.
        // Waiting on the TEXT (not a timer) is what makes this deterministic.
        await expect(info).toHaveText(new RegExp(`1\\s*[–-]\\s*${String(SMALL_PAGE_SIZE)}\\b`));

        const after = await readInfo(pager);
        expect(after.from, 'changing page size must return to the first page').toBe(1);
        expect(after.to).toBe(SMALL_PAGE_SIZE);
        expect(after.total, 'the total must not change when only the page size changed').toBe(before.total);
      });

      test(`🔴 First/Last jump to the ends of the ${screen.name} grid and disable correctly`, async ({ page }) => {
        const pager = await openPagedScreen(page, screen, DESKTOP);
        const info = pager.locator(id(PAGER_TEST_IDS.info));
        const start = await readInfo(pager);

        test.skip(
          start.total <= start.to,
          `only ${String(start.total)} row(s) on ${screen.name} — a single page, so First/Last cannot move`,
        );

        // `showFirstLast` — both jumps must exist at desktop width.
        await expect(pager.locator(id(PAGER_TEST_IDS.first)), 'no First button ⇒ showFirstLast missing').toBeVisible();
        await expect(pager.locator(id(PAGER_TEST_IDS.last)), 'no Last button ⇒ showFirstLast missing').toBeVisible();

        // On page one, backwards navigation must already be dead.
        expect(await isDisabled(pager, PAGER_TEST_IDS.first), 'First is enabled on page 1').toBe(true);
        expect(await isDisabled(pager, PAGER_TEST_IDS.prev), 'Prev is enabled on page 1').toBe(true);

        await pager.locator(id(PAGER_TEST_IDS.last)).click();
        await expect(info).toHaveText(new RegExp(`[–-]\\s*${String(start.total).replace(/(\d)(?=(\d{3})+$)/g, '$1,?')}\\b`));

        const end = await readInfo(pager);
        expect(end.to, 'Last must land on the final row').toBe(end.total);
        expect(end.from, 'Last must move the window off page 1').toBeGreaterThan(start.from);
        expect(await isDisabled(pager, PAGER_TEST_IDS.next), 'Next is still enabled on the last page').toBe(true);
        expect(await isDisabled(pager, PAGER_TEST_IDS.last), 'Last is still enabled on the last page').toBe(true);

        // …and First brings it all the way back to the opening window.
        await pager.locator(id(PAGER_TEST_IDS.first)).click();
        await expect(info).toHaveText(/\b1\s*[–-]/);

        const back = await readInfo(pager);
        expect(back.from).toBe(1);
        expect(back.to, 'First must restore the original window exactly').toBe(start.to);
      });

      test(`the ${screen.name} rows trigger has a DESCRIPTIVE accessible name (ui-tables 1.12.0)`, async ({
        page,
      }) => {
        // ui-tables 1.11.0 gave this control `aria-label="50"` — a screen reader announced "button,
        // 50", which says nothing about what the 50 means or what pressing it does. 1.12.0 replaced
        // it with `uiTables.pager.rowsTriggerLabel` ("Rows per page, currently {{p1}}").
        //
        // Asserted as a POSITIVE property (it names rows-per-page AND carries the current value)
        // plus an explicit NOT for the old bare-number form, so a silent revert to 1.11.0 behaviour
        // fails here rather than quietly degrading accessibility again. Deliberately NOT asserting
        // the exact sentence — that is copy, and pinning it would break on a harmless reword.
        const pager = await openPagedScreen(page, screen, DESKTOP);
        const trigger = pager.locator(id(sizeTrigger(screen.pagerTestId)));
        await expect(trigger).toBeVisible();

        const label = (await trigger.getAttribute('aria-label')) ?? '';
        expect(label, 'the rows trigger has no accessible name at all').not.toBe('');
        expect(
          /^\d+$/.test(label),
          `the rows trigger's accessible name is the bare number "${label}" — that is the ui-tables ` +
            `1.11.0 behaviour the 1.12.0 upgrade replaced. A screen reader announces "button, ${label}".`,
        ).toBe(false);
        expect(
          label.toLowerCase(),
          `the rows trigger's accessible name "${label}" does not mention rows per page`,
        ).toContain('rows per page');

        // It must still carry the CURRENT page size — a label that never changes is not describing
        // state.
        //
        // Taken from the trigger's OWN rendered text, which is `pageSize` verbatim. An earlier
        // version derived it from the count line as `to - from + 1` and failed with 'the accessible
        // name "Rows per page, currently 50" omits the current page size (13)' — because that
        // computes rows DISPLAYED (13, the whole result set) not the page SIZE (50). The label was
        // right and the test was wrong; reading the same source the label reads removes the
        // discrepancy entirely.
        const shownSize = (await trigger.innerText()).trim().replace(/\D+/g, '');
        expect(shownSize, 'the rows trigger renders no page size').not.toBe('');
        expect(
          label,
          `the accessible name "${label}" omits the page size it displays (${shownSize})`,
        ).toContain(shownSize);
      });

      test(`🔴 the ${screen.name} pager COLLAPSES below ${String(STACK_BREAKPOINT)}px instead of overflowing`, async ({
        page,
      }) => {
        // The assertion the visual-QA pass could not make. `responsive` is meaningless unless the
        // compact layout is real, and "it looks fine on my 1280px screen" is not evidence.
        const pager = await openPagedScreen(page, screen, MOBILE);

        // The count line and Prev/Next survive — a collapsed pager is still a pager.
        await expect(pager.locator(id(PAGER_TEST_IDS.info)), 'the count line vanished when collapsed').toBeVisible();
        await expect(pager.locator(id(PAGER_TEST_IDS.prev)), 'Prev vanished when collapsed').toBeVisible();
        await expect(pager.locator(id(PAGER_TEST_IDS.next)), 'Next vanished when collapsed').toBeVisible();

        // …and exactly the three space-hungry parts are gone.
        await expect(
          pager.locator(id(sizeTrigger(screen.pagerTestId))),
          'the rows-per-page control is still rendered on a narrow viewport ⇒ `responsive` is not collapsing',
        ).toHaveCount(0);
        await expect(
          pager.locator(id(PAGER_TEST_IDS.first)),
          'the First jump survives the collapse ⇒ showJumps ignored isCompact',
        ).toHaveCount(0);
        await expect(pager.locator(id(PAGER_TEST_IDS.last)), 'the Last jump survives the collapse').toHaveCount(0);

        // 🔴 The user-visible failure the collapse exists to prevent: a pager wider than the phone,
        // dragging the whole document into a horizontal scroll. Asserted on the DOCUMENT, because
        // that is what the operator's thumb actually feels.
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `the document scrolls horizontally at ${String(MOBILE.width)}px ` +
            `(${String(overflow.scrollWidth)}px of content in ${String(overflow.clientWidth)}px) — the collapsed ` +
            `pager, or something beside it, still overflows.`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      });
    });
  }
});
