import fs from 'fs';
import path from 'path';

import { expectTextFits } from '@dloizides/game-e2e';
import { devices, expect, test } from '@playwright/test';

import {
  MASTER_IDS,
  MASTER_ROUTES,
  ZYGOS_WEB_URL,
  enterConsoleAs,
  id,
  masterAccount,
  resolveDemoAccounts,
  sessionFor,
} from './zygos-master.js';

import type { Locator, Page } from '@playwright/test';

interface Box {
  readonly kind: string;
  readonly top: number;
  readonly height: number;
  readonly width: number;
}

const ACTION_KINDS = ['rename', 'disable', 'delete', 'details', 'open'] as const;
const ROW_ACTIONS_PREFIX = 'zygos-master-merchant-actions-';
const ALIGN_TOLERANCE_PX = 1;
const MIN_HIT_PX = 44;
const SCREEN_TIMEOUT_MS = 30_000;
const SHOT_DIR = process.env.SIGHTING_DIR ?? path.join('test-results', 'finreg-merchant-row-actions');
const ROW_COLUMN_COUNT = 5;
const ROW_MARK = 'data-e2e-merchant-row';
const SKIP_REASON = 'FinReg console unreachable or demo accounts not published';

const VIEWPORTS = [
  { label: '360x640', touch: true, device: { ...devices['Galaxy S5'], viewport: { width: 360, height: 640 } } },
  { label: '1280x800', touch: false, device: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
] as const;

async function measure(actions: Locator, tenantId: string): Promise<Box[]> {
  const boxes: Box[] = [];
  for (const kind of ACTION_KINDS) {
    const action = actions.page().locator(id(`zygos-master-merchant-${kind}-${tenantId}`));
    await expect(action, `row action ${kind} is missing for ${tenantId}`).toBeVisible();
    const box = await action.boundingBox();
    if (!box) throw new Error(`row action ${kind} has no bounding box`);
    boxes.push({ kind, top: box.y, height: box.height, width: box.width });
  }
  return boxes;
}

interface Rect {
  readonly kind: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface RowGeometry {
  readonly cell: Rect | null;
  readonly totalsText: Rect | null;
  readonly actions: Rect[];
}

async function rowGeometry(page: Page, tenantId: string): Promise<RowGeometry> {
  return page.evaluate(
    ({ kinds, tenant, columns, mark }) => {
      const toRect = (kind: string, r: DOMRect) => ({ kind, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      const actions = kinds.map((kind) => {
        const host = document.querySelector(`[data-testid="zygos-master-merchant-${kind}-${tenant}"]`)!;
        return toRect(kind, (host.firstElementChild ?? host).getBoundingClientRect());
      });
      let cell: Element | null = document.querySelector(`[data-testid="zygos-master-merchant-open-${tenant}"]`);
      while (cell && (cell.parentElement?.childElementCount ?? 0) < columns) cell = cell.parentElement;
      if (!cell?.parentElement || !cell.previousElementSibling) return { cell: null, totalsText: null, actions };
      cell.parentElement.setAttribute(mark, 'true');
      const range = document.createRange();
      range.selectNodeContents(cell.previousElementSibling);
      return {
        cell: toRect('actions-cell', cell.getBoundingClientRect()),
        totalsText: toRect('totals-text', range.getBoundingClientRect()),
        actions,
      };
    },
    { kinds: [...ACTION_KINDS], tenant: tenantId, columns: ROW_COLUMN_COUNT, mark: ROW_MARK },
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right - ALIGN_TOLERANCE_PX && b.left < a.right - ALIGN_TOLERANCE_PX && a.top < b.bottom && b.top < a.bottom;
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

for (const viewport of VIEWPORTS) {
  test.describe(`FinReg merchant row actions at ${viewport.label} @zygos-ui @ui`, () => {
    test(`AC-2 AC-3 merchants first row at ${viewport.label}, five actions share one top edge and height within 1px on one line`, async ({ browser }) => {
      test.setTimeout(150_000);
      const master = await sessionFor(masterAccount(await resolveDemoAccounts()));
      test.skip(!master, SKIP_REASON);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const context = await browser.newContext({ ...viewport.device, baseURL: ZYGOS_WEB_URL });
      const page = await context.newPage();
      await enterConsoleAs(page, master!, MASTER_ROUTES.merchants);
      await expect(page.locator(id(MASTER_IDS.merchantsTable)), 'merchants table did not render')
        .toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
      const actions = page.locator(`[data-testid^="${ROW_ACTIONS_PREFIX}"]`).first();
      await expect(actions, 'no merchant row actions on /master/merchants').toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
      const tenantId = (await actions.getAttribute('data-testid'))!.slice(ROW_ACTIONS_PREFIX.length);
      await actions.scrollIntoViewIfNeeded();

      const boxes = await measure(actions, tenantId);

      const report = boxes.map((b) => `${b.kind} top=${b.top.toFixed(1)} h=${b.height.toFixed(1)} w=${b.width.toFixed(1)}`).join('; ');
      test.info().annotations.push({ type: 'measured', description: `${viewport.label}: ${report}` });
      console.log(`measured ${viewport.label}: ${report}`);
      const geometry = await rowGeometry(page, tenantId);
      const row = page.locator(`[${ROW_MARK}]`).first();
      await (geometry.cell ? row : actions).screenshot({ path: path.join(SHOT_DIR, `${viewport.label}-row-actions.png`) });
      await page.screenshot({ path: path.join(SHOT_DIR, `${viewport.label}-merchants.png`), fullPage: true });
      expect(spread(boxes.map((b) => b.top)), `AC-2 tops differ (one line, one top edge): ${report}`).toBeLessThanOrEqual(ALIGN_TOLERANCE_PX);
      expect(spread(boxes.map((b) => b.height)), `AC-2 heights differ: ${report}`).toBeLessThanOrEqual(ALIGN_TOLERANCE_PX);
      const geo = JSON.stringify(geometry);
      test.info().annotations.push({ type: 'geometry', description: `${viewport.label}: ${geo}` });
      if (geometry.cell) {
        const cell = geometry.cell;
        const outside = geometry.actions.filter((a) => a.left < cell.left - ALIGN_TOLERANCE_PX || a.right > cell.right + ALIGN_TOLERANCE_PX).map((a) => a.kind);
        expect(outside, `AC-5 actions outside the Actions cell: ${geo}`).toEqual([]);
        const onTotals = geometry.actions.filter((a) => geometry.totalsText && overlaps(a, geometry.totalsText)).map((a) => a.kind);
        expect(onTotals, `AC-5 actions overlap the Totals text: ${geo}`).toEqual([]);
      }
      const byX = [...geometry.actions].sort((a, b) => a.left - b.left);
      const gaps = byX.slice(1).map((a, i) => a.left - byX[i]!.right);
      expect(spread(gaps), `AC-5 gaps between actions are not uniform (${gaps.map((g) => g.toFixed(1)).join(', ')}): ${geo}`).toBeLessThanOrEqual(ALIGN_TOLERANCE_PX);
      if (viewport.touch) {
        const small = boxes.filter((b) => b.height < MIN_HIT_PX || b.width < MIN_HIT_PX).map((b) => b.kind);
        expect(small, `AC-3 hit boxes under ${String(MIN_HIT_PX)}x${String(MIN_HIT_PX)}: ${report}`).toEqual([]);
      }
      const actionText = ACTION_KINDS.map((kind) => `${id(`zygos-master-merchant-${kind}-${tenantId}`)} *:not([id^="a11y-hint-"])`).join(', ');
      await expectTextFits(page, actionText);
      await context.close();
    });
  });
}
