// Geometry of the instruction form's field GRID, for the WRAPPED case.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────────────
//
// `zygos-form-fields.ui.spec.ts` measures the four columns at 1280px, where they sit on ONE row,
// and it explicitly `test.skip`s the moment they wrap:
//
//     test.skip(spread > 100, 'the four columns wrapped onto separate rows — nothing to compare');
//
// That skip is correct for THAT assertion (a shared `top` is meaningless across rows), but it left
// the wrapped case never asserted by anything — and the wrapped case is precisely where the
// spacing model bites. On one row, vertical rhythm is invisible: there is no second row for a
// wrong gap to be wrong against. Everything the `spacing: 'stack' | 'gap'` change can break is
// only observable once row two exists.
//
// ── The two failure modes this measures ───────────────────────────────────────────────────────
//
// A `Field` inside a `FormGrid`/`FormSection` must resolve to `spacing: 'gap'`, i.e. contribute NO
// bottom margin of its own and let the grid's own `rowGap` do the spacing. Two ways that goes
// wrong, and they fail in OPPOSITE directions, which is why the assertion is an equality against
// the grid's own declared `rowGap` rather than a one-sided bound:
//
//   * a SURVIVING `marginBottom: 0` cancel hack under the gap model  ⇒  COLLAPSED spacing
//     (measured gap < rowGap: the hack cancels a margin that the gap model already removed, and
//     in some shells also eats into the row box).
//   * a `Field` that fell back to `spacing: 'stack'` inside the grid  ⇒  DOUBLED spacing
//     (measured gap ≈ rowGap + the stack margin: grid gap AND container margin both apply).
//
// Asserting `measuredGap === rowGap` catches both without needing to know which one happened, and
// the failure message reports the direction so the reader knows which of the two they are looking
// at.
//
// ── Why rowGap is read from the DOM, not hardcoded ────────────────────────────────────────────
//
// A literal expected-pixel value would encode today's theme spacing token and fail on every
// legitimate design-token change, which is how a test earns a reputation for crying wolf and gets
// deleted. The grid's own computed `rowGap` IS the contract: "the space between rows is the grid's
// gap and nothing else". Reading it keeps the assertion true across token changes and false only
// when the spacing MODEL is wrong — which is the thing under test.

import type { Page } from '@playwright/test';

export interface GridColumn {
  readonly name: string;
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
  /** The column's own bottom margin. Under the gap model this must be 0. */
  readonly marginBottom: number;
}

export interface GridGeometry {
  readonly columns: readonly GridColumn[];
  /** The grid container's computed row-gap — the ONLY thing that may separate two rows. */
  readonly rowGap: number;
}

/** A viewport narrow enough that the four flexBasis-200 columns must wrap onto two rows. */
export const WRAP_VIEWPORT = { width: 620, height: 900 } as const;

/** Columns whose tops differ by less than this are treated as being on the same row. */
export const SAME_ROW_TOLERANCE_PX = 4;

/** Sub-pixel layout tolerance. The defects this catches are a whole margin (8px+) wide. */
export const GAP_TOLERANCE_PX = 1.5;

/**
 * Measure every named control's GRID COLUMN plus the grid's own row-gap, in one pass.
 *
 * The column is located structurally — climb from the control until the parent is the flex-wrap
 * row — for the same reason the single-row spec does it: there is deliberately one node per column
 * and it carries no testID. Measuring the CONTROL instead would compare an input against a
 * dropdown trigger, which differ by nature and would never be equal.
 */
export async function measureGrid(
  page: Page,
  fields: readonly { name: string; testId: string }[],
): Promise<GridGeometry | null> {
  return await page.evaluate((specs) => {
    let grid: HTMLElement | null = null;
    const columns: GridColumn[] = [];

    for (const spec of specs) {
      const control = document.querySelector(`[data-testid="${spec.testId}"]`);
      if (control === null) return null;

      let node: HTMLElement | null = control as HTMLElement;
      while (node !== null && node.parentElement !== null) {
        const parentStyle = window.getComputedStyle(node.parentElement);
        if (parentStyle.flexWrap === 'wrap' && parentStyle.flexDirection === 'row') {
          grid = node.parentElement;
          const rect = node.getBoundingClientRect();
          const marginBottom = Number.parseFloat(window.getComputedStyle(node).marginBottom) || 0;
          columns.push({
            name: spec.name,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            marginBottom,
          });
          break;
        }
        node = node.parentElement;
      }
    }

    if (grid === null || columns.length !== specs.length) return null;

    const gridStyle = window.getComputedStyle(grid);
    // `rowGap` computes to "normal" on a flex container that never set it; that means 0.
    const parsedRowGap = Number.parseFloat(gridStyle.rowGap);
    const rowGap = Number.isNaN(parsedRowGap) ? 0 : parsedRowGap;

    return { columns, rowGap };
  }, fields as { name: string; testId: string }[]);
}

/** Group measured columns into visual rows by their top coordinate. */
export function groupIntoRows(columns: readonly GridColumn[]): GridColumn[][] {
  const rows: GridColumn[][] = [];

  for (const column of [...columns].sort((a, b) => a.top - b.top)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].top - column.top) <= SAME_ROW_TOLERANCE_PX);
    if (row) row.push(column);
    else rows.push([column]);
  }

  return rows;
}
