// Zygos instruction form — the WRAPPED field grid (Amount | Currency | Value date | Direction).
//
// ── Why this is a separate spec from zygos-form-fields.ui.spec.ts ─────────────────────────────
//
// That spec measures the same four columns at 1280px, where they share ONE row, and it explicitly
// bails the moment they wrap:
//
//     test.skip(spread > 100, 'the four columns wrapped onto separate rows — nothing to compare');
//
// That skip is right for THAT assertion — a shared `top` is meaningless across rows — but it left
// the wrapped case asserted by nothing at all. And the wrapped case is exactly where the
// `spacing: 'stack' | 'gap'` model bites: on a single row, vertical rhythm is unobservable,
// because there is no second row for a wrong gap to be wrong against. Every rhythm defect the
// spacing wave could introduce is invisible at 1280px and visible here.
//
// The measurement and the reasoning behind asserting against the grid's OWN rowGap (rather than a
// hardcoded pixel value) live in `zygos-form-grid.ts`.
import { expect, test } from '@playwright/test';

import { CONSOLE_TEST_IDS, enterConsole, gotoScreen } from './zygos-console-ui.js';
import { GAP_TOLERANCE_PX, WRAP_VIEWPORT, groupIntoRows, measureGrid } from './zygos-form-grid.js';

import type { GridGeometry } from './zygos-form-grid.js';

/** The four controls of the instruction's own fields, in render order. */
const CORE_FIELDS: readonly { name: string; testId: string }[] = [
  { name: 'Amount', testId: CONSOLE_TEST_IDS.formAmount },
  { name: 'Currency', testId: CONSOLE_TEST_IDS.formCurrency },
  { name: 'Value date', testId: CONSOLE_TEST_IDS.formValueDate },
  { name: 'Direction', testId: CONSOLE_TEST_IDS.formDirection },
];

test.describe('Zygos instruction form — wrapped grid rhythm @zygos-ui @ui', () => {
  test.beforeEach(async ({ page }) => {
    await enterConsole(page, '/');
    await gotoScreen(page, '/instructions/new', CONSOLE_TEST_IDS.formScreen);
  });

  test('🔴 WRAPPED: row two keeps the grid rhythm — no collapsed and no doubled spacing', async ({ page }) => {
    // The case the single-row assertion above explicitly SKIPS (`spread > 100`), and therefore the
    // case nothing has ever asserted. See `zygos-form-grid.ts` for why this is where the
    // `spacing: 'stack' | 'gap'` model actually bites: on one row there is no second row for a
    // wrong vertical gap to be wrong against, so every rhythm defect is invisible at 1280px.
    await page.setViewportSize(WRAP_VIEWPORT);

    const geometry = await measureGrid(page, CORE_FIELDS);
    expect(geometry, 'could not measure the field grid').not.toBeNull();
    const { columns, rowGap } = geometry as GridGeometry;

    const rows = groupIntoRows(columns);

    // Vacuity guard. If the viewport did not actually force a wrap, this test measured the
    // single-row case that is already covered and would pass for the wrong reason. That must FAIL
    // loudly and say so, not skip — a skip here would recreate exactly the blind spot this test
    // was written to close.
    expect(
      rows.length,
      `the four columns did NOT wrap at ${String(WRAP_VIEWPORT.width)}px — they occupy ${String(rows.length)} row(s), ` +
        `so the wrapped-rhythm assertion below would be vacuous. Narrow WRAP_VIEWPORT until row two ` +
        `exists; do not skip, or the wrapped case goes back to being untested.`,
    ).toBeGreaterThan(1);

    // Every column shares the `Field` shell, so heights must match even across rows.
    const tallest = Math.max(...columns.map((column) => column.height));
    const shortest = Math.min(...columns.map((column) => column.height));
    expect(
      tallest - shortest,
      `the columns differ in height by ${String(tallest - shortest)}px when wrapped ` +
        `(${columns.map((c) => `${c.name}=${String(c.height)}`).join(', ')}) — they no longer share the Field shell.`,
    ).toBeLessThanOrEqual(GAP_TOLERANCE_PX);

    // Under the gap model a column contributes NO bottom margin of its own; the grid's rowGap is
    // the only thing separating rows. A surviving `marginBottom` cancel hack or a `stack` fallback
    // both show up here first, and this names the offending column directly.
    for (const column of columns) {
      expect(
        column.marginBottom,
        `the ${column.name} column carries marginBottom=${String(column.marginBottom)}px inside a FormGrid. ` +
          `A Field inside a grid must resolve to spacing:'gap' and contribute no margin — the grid's ` +
          `rowGap does the spacing. A non-zero margin here is either a surviving cancel hack or a ` +
          `fallback to spacing:'stack', and it DOUBLES the gap between wrapped rows.`,
      ).toBeCloseTo(0, 1);
    }

    // The measurement that catches both failure directions at once.
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      const previousBottom = Math.max(...previous.map((column) => column.bottom));
      const currentTop = Math.min(...current.map((column) => column.top));
      const measuredGap = currentTop - previousBottom;

      const direction = measuredGap < rowGap ? 'COLLAPSED' : 'DOUBLED';
      expect(
        Math.abs(measuredGap - rowGap),
        `row ${String(index + 1)} (${current.map((c) => c.name).join(', ')}) sits ${String(measuredGap)}px below ` +
          `row ${String(index)} (${previous.map((c) => c.name).join(', ')}), but the grid's own rowGap is ` +
          `${String(rowGap)}px ⇒ ${direction} spacing.\n\n` +
          (direction === 'COLLAPSED'
            ? `COLLAPSED means a "marginBottom: 0" cancel hack survived the move to the gap model — it is ` +
              `now cancelling a margin the gap model had already removed.`
            : `DOUBLED means a Field fell back to spacing:'stack' inside the grid, so its container margin ` +
              `is being added on TOP of the grid's rowGap.`),
      ).toBeLessThanOrEqual(GAP_TOLERANCE_PX);
    }

    // Within each row the columns must still share a top — the original alignment property, now
    // asserted per-row so it holds in the wrapped layout too.
    for (const row of rows) {
      const tops = row.map((column) => column.top);
      expect(
        Math.max(...tops) - Math.min(...tops),
        `the columns on one wrapped row (${row.map((c) => c.name).join(', ')}) do not share a top edge.`,
      ).toBeLessThanOrEqual(GAP_TOLERANCE_PX);
    }
  });

});
