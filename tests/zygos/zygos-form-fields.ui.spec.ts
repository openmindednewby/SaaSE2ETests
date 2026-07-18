// Zygos instruction form — field alignment + the newly-surfaced validation errors (UX-6a).
//
// ── What the wave changed ─────────────────────────────────────────────────────────────────────
//
// `currency` and `direction` used to be BARE `ModalDropdown`s. Two consequences, one cosmetic and
// one not:
//
//   1. No label row and no container bottom margin ⇒ their boxes started a label-row HIGHER than
//      the `FormField` siblings beside them, and wrapped rows lost their vertical rhythm. That is
//      the misalignment the user originally complained about.
//   2. 🔴 A REAL BUG: their `<Controller>`s destructured only react-hook-form's `field` and never
//      `fieldState`. The schema has ALWAYS produced `currencyInvalid` ("Choose a currency.") and
//      `directionInvalid` ("Choose a direction.") — the form silently discarded both. There was
//      nowhere to render them, so nothing looked wrong.
//
// Both are now fixed by routing the dropdowns through the shared `Field` — the exact shell
// `FormField` composes internally, so the four columns cannot drift apart again.
//
// ── 🔴 AN HONEST LIMIT ON WHAT CAN BE ASSERTED, STATED UP FRONT ───────────────────────────────
//
// The brief asked for a test that drives the form into the currency/direction error state and
// asserts the messages are VISIBLE. **That state is not reachable through the shipped UI**, and
// this was verified in the source rather than assumed:
//
//   * `emptyFormValues()` seeds `currency: DEFAULT_CURRENCY` ('EUR') and `direction:
//     DEFAULT_DIRECTION` — both already valid, so a fresh form never starts invalid.
//   * every option the dropdowns offer is schema-valid by construction: `SUPPORTED_CURRENCIES`
//     is five 3-letter codes (the schema demands `.length(3)`) and `PAYMENT_DIRECTIONS` is
//     exactly the two values `isPaymentDirection` accepts.
//   * `ModalDropdown` has no clear/deselect affordance, so a chosen value cannot be removed.
//
// An operator therefore CANNOT produce either message. Writing a test that claimed to "drive the
// form into that state" would mean faking it. So the coverage is split honestly instead:
//
//   * the error LINE is proven to render in this grid, using the `amount` error — reachable,
//     real, and rendered by the same `Field` shell the dropdowns now use (`FormField` composes
//     `Field`; the error is the same `role="alert"` node in both).
//   * the UNREACHABILITY itself is pinned as an invariant: every offered option is schema-valid.
//     If someone adds a 2-letter currency to `SUPPORTED_CURRENCIES`, the error becomes reachable
//     and that test fails, saying so — which is the moment the wiring needs re-verifying.
//
// The `fieldState` wiring is covered where it CAN be covered honestly: `instructionSchema.test.ts`
// asserts the schema produces both keys and that both resolve to real English.
import { expect, test } from '@playwright/test';

import { CONSOLE_TEST_IDS, enterConsole, gotoScreen, id } from './zygos-console-ui.js';
import {
  BIG_SCROLL_PX,
  DETACH_TOLERANCE_PX,
  SHORT_VIEWPORT,
  SMALL_SCROLL_PX,
  menuOffsetFromTrigger,
  scrollFormBy,
} from './zygos-form-scroll.js';

import type { Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };

/** The four controls of the instruction's own fields, in render order. */
const CORE_FIELDS: readonly { name: string; testId: string; label: string }[] = [
  { name: 'Amount', testId: CONSOLE_TEST_IDS.formAmount, label: 'Amount' },
  { name: 'Currency', testId: CONSOLE_TEST_IDS.formCurrency, label: 'Currency' },
  { name: 'Value date', testId: CONSOLE_TEST_IDS.formValueDate, label: 'Value date' },
  { name: 'Direction', testId: CONSOLE_TEST_IDS.formDirection, label: 'Direction' },
];

/**
 * The bounding box of a control's GRID COLUMN — the labelled container, not the control itself.
 *
 * That distinction is the whole point: the old bug was that a bare dropdown's column had no label
 * row, so measuring the CONTROL would compare an input against a dropdown trigger (different
 * heights by nature, and never equal) while measuring the COLUMN compares like with like.
 *
 * The column is found structurally rather than by testID because `InstructionCoreFields` puts
 * `styles.field` on each control's own `containerStyle` — there is deliberately ONE node per
 * column and it carries no testID of its own. So: climb from the control until the parent is the
 * flex-wrap grid, and that node IS the column.
 */
async function columnRect(
  page: Page,
  testId: string,
): Promise<{ top: number; height: number; bottom: number } | null> {
  return await page.evaluate((id_) => {
    const control = document.querySelector(`[data-testid="${id_}"]`);
    if (control === null) return null;

    let node: HTMLElement | null = control as HTMLElement;
    while (node !== null && node.parentElement !== null) {
      const parentStyle = window.getComputedStyle(node.parentElement);
      if (parentStyle.flexWrap === 'wrap' && parentStyle.flexDirection === 'row') {
        const rect = node.getBoundingClientRect();
        // Include the column's bottom margin — the second half of the original defect was the
        // MISSING container margin, which a bare content rect would not see.
        const margin = Number.parseFloat(window.getComputedStyle(node).marginBottom) || 0;
        return { top: rect.top, height: rect.height, bottom: rect.bottom + margin };
      }
      node = node.parentElement;
    }
    return null;
  }, testId);
}

test.describe('Zygos instruction form — fields @zygos-ui @ui', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await enterConsole(page, '/');
    await gotoScreen(page, '/instructions/new', CONSOLE_TEST_IDS.formScreen);
  });

  test('🔴 all four core controls render a visible label', async ({ page }) => {
    // The dropdowns had NO label at all before this wave — an operator saw two unlabelled boxes
    // between Amount and Value date. This is the plainest possible statement of the fix.
    const form = page.locator(id(CONSOLE_TEST_IDS.formScreen));

    for (const field of CORE_FIELDS) {
      await expect(
        page.locator(id(field.testId)),
        `the ${field.name} control is missing from the form`,
      ).toBeVisible();

      // NB the trailing `\s*\*?`: `Field` renders the label Text as `[label, requiredMark]`, so
      // every one of these four (all `required`) has its asterisk inside the SAME element and an
      // `exact: true` match on the bare word finds nothing. Anchored at both ends regardless, so
      // this cannot accidentally match a longer string that merely starts with the label.
      await expect(
        form.getByText(new RegExp(`^${field.label}\\s*\\*?$`)).first(),
        `the ${field.name} control renders no visible "${field.label}" label ⇒ it is not wrapped in Field`,
      ).toBeVisible();
    }
  });

  test('🔴 the four columns are aligned — same top, same height, same bottom edge', async ({ page }) => {
    // The user's original complaint, encoded as a measurement. At 1280px all four columns
    // (flexBasis 200) sit on ONE row, so they must share a top; and because they now share the
    // `Field` shell they must also share a height and therefore a bottom edge.
    const rects = [];
    for (const field of CORE_FIELDS) {
      const rect = await columnRect(page, field.testId);
      expect(rect, `could not measure the ${field.name} column`).not.toBeNull();
      rects.push({ name: field.name, ...(rect as { top: number; height: number; bottom: number }) });
    }

    // Sanity: this assertion only means anything if the four really are on one row.
    const tops = rects.map((rect) => rect.top);
    const spread = Math.max(...tops) - Math.min(...tops);
    test.skip(spread > 100, 'the four columns wrapped onto separate rows at this width — nothing to compare');

    // 1px tolerance for sub-pixel layout; the defect was a whole label-row (~20px+), so this is
    // nowhere near tight enough to flake yet far tighter than the bug it catches.
    const TOLERANCE = 1;
    const reference = rects[0];
    for (const rect of rects.slice(1)) {
      expect(
        Math.abs(rect.top - reference.top),
        `${rect.name} starts at y=${String(rect.top)} but ${reference.name} starts at y=${String(reference.top)} — ` +
          `the columns are not aligned (this is the "dropdown sits a label-row higher" defect).`,
      ).toBeLessThanOrEqual(TOLERANCE);

      expect(
        Math.abs(rect.height - reference.height),
        `${rect.name} is ${String(rect.height)}px tall but ${reference.name} is ${String(reference.height)}px — ` +
          `the columns no longer share the Field shell.`,
      ).toBeLessThanOrEqual(TOLERANCE);

      expect(
        Math.abs(rect.bottom - reference.bottom),
        `${rect.name} ends at y=${String(rect.bottom)} but ${reference.name} ends at y=${String(reference.bottom)} — ` +
          `the container bottom margins differ, so a wrapped row would lose its rhythm.`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  test('🔴 a validation error renders VISIBLY inside the field grid', async ({ page }) => {
    // Proves the error line the dropdowns were given actually appears in this layout. `amount` is
    // used because it is the one core-field error an operator can genuinely reach — see the file
    // header for why `currencyInvalid` / `directionInvalid` cannot be.
    const amount = page.locator(id(CONSOLE_TEST_IDS.formAmount));
    await amount.fill('not-a-number');
    await amount.blur();

    await page.locator(id(CONSOLE_TEST_IDS.formSubmit)).click();

    // `Field` renders its error as a `role="alert"` Text — the canonical readiness signal, so
    // there is nothing to sleep on. Both `FormField` and the `Field`-wrapped dropdowns emit it.
    const alert = page.locator(id(CONSOLE_TEST_IDS.formScreen)).locator('[role="alert"]').first();
    await expect(alert, 'submitting an invalid amount produced no visible error line').toBeVisible();
    await expect(alert).toHaveText(/amount/i);

    // The form must NOT have navigated away — a validation failure that still submits is worse
    // than one that shows no message.
    await expect(page.locator(id(CONSOLE_TEST_IDS.formScreen))).toBeVisible();
  });

  test('🔴 an open dropdown does not DETACH from its trigger when the page scrolls (ui-layout 1.10.0)', async ({
    page,
  }) => {
    // The scroll-detach defect: `ModalDropdown` portals its menu to the document root and
    // positioned it ONCE, from the trigger's rect at open time. Scrolling then moved the trigger
    // while the menu stayed nailed to the old viewport coordinates — so the options floated over
    // unrelated content, visually attached to nothing. 1.10.0 repositions on scroll/resize and
    // closes the menu once the trigger leaves the viewport.
    //
    // Both halves are asserted, because "closes on scroll" alone would also be satisfied by the
    // BUG plus an unrelated dismiss, and "repositions" alone would miss the close.
    await page.setViewportSize(SHORT_VIEWPORT);

    const trigger = page.locator(id(CONSOLE_TEST_IDS.formCurrency));
    await trigger.click();

    const menu = page.locator(id(`${CONSOLE_TEST_IDS.formCurrency}-menu`));
    await expect(menu, 'the currency menu did not open').toBeVisible();

    const offsetBefore = await menuOffsetFromTrigger(page);
    expect(offsetBefore, 'could not measure the menu against its trigger').not.toBeNull();

    // A SMALL scroll — the trigger stays on screen, so the menu must FOLLOW it, not stay put.
    const smallScroll = await scrollFormBy(page, SMALL_SCROLL_PX);
    expect(smallScroll.scrolled, 'the form did not scroll, so nothing was actually tested').toBeGreaterThan(0);

    // The readiness signal is the geometric relationship itself: poll until the menu has caught up
    // with its trigger, which is exactly the property under test. No sleep.
    await expect
      .poll(async () => (await menuOffsetFromTrigger(page)) ?? Number.MAX_SAFE_INTEGER, { timeout: 10_000 })
      .toBeLessThanOrEqual((offsetBefore ?? 0) + DETACH_TOLERANCE_PX);

    // Now scroll far enough that the trigger leaves the viewport entirely — the menu must close
    // outright rather than linger over whatever scrolled into its place.
    const bigScroll = await scrollFormBy(page, BIG_SCROLL_PX);
    expect(
      bigScroll.triggerTop,
      `the trigger is still on screen at y=${String(bigScroll.triggerTop)} after scrolling, so the ` +
        `close-on-out-of-view behaviour was never exercised`,
    ).toBeLessThan(0);

    await expect(
      menu,
      'the menu stayed open after its trigger scrolled out of view — the ui-layout 1.10.0 ' +
        'scroll-detach fix is not in effect (menu is floating detached over unrelated content).',
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('the currency + direction dropdowns offer ONLY schema-valid options', async ({ page }) => {
    // 🔴 THIS TEST IS THE REASON `currencyInvalid` / `directionInvalid` ARE UNREACHABLE, pinned as
    // an invariant rather than left as a comment. It guards two things at once:
    //   * the operator cannot pick a value the server would reject; and
    //   * the day someone adds an option that IS rejectable, this fails — and whoever sees it
    //     knows the `fieldState` error wiring now has a reachable path and must be verified in a
    //     browser rather than trusted.
    const CURRENCY_LENGTH = 3;
    const VALID_DIRECTIONS = ['Outgoing', 'Incoming'];

    await page.locator(id(CONSOLE_TEST_IDS.formCurrency)).click();
    const currencyOptions = await page
      .locator(`[data-testid^="${CONSOLE_TEST_IDS.formCurrency}-option-"]`)
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace(/^.*-option-/, '')),
      );

    expect(currencyOptions.length, 'the currency dropdown offered no options').toBeGreaterThan(0);
    for (const currency of currencyOptions) {
      expect(
        currency.length,
        `the currency dropdown offers "${currency}", which is ${String(currency.length)} characters — the schema ` +
          `demands exactly ${String(CURRENCY_LENGTH)}, so an operator can now select a value that renders ` +
          `"Choose a currency." Verify the Field error wiring renders it.`,
      ).toBe(CURRENCY_LENGTH);
    }

    await page.keyboard.press('Escape');

    await page.locator(id(CONSOLE_TEST_IDS.formDirection)).click();
    const directionOptions = await page
      .locator(`[data-testid^="${CONSOLE_TEST_IDS.formDirection}-option-"]`)
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace(/^.*-option-/, '')),
      );

    expect(directionOptions.length, 'the direction dropdown offered no options').toBeGreaterThan(0);
    for (const direction of directionOptions) {
      expect(
        VALID_DIRECTIONS,
        `the direction dropdown offers "${direction}", which isPaymentDirection rejects — an operator can now ` +
          `select a value that renders "Choose a direction." Verify the Field error wiring renders it.`,
      ).toContain(direction);
    }
  });
});
