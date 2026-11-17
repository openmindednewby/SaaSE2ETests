import fs from 'fs';

import { expectTextFits } from '@dloizides/game-e2e';
import { devices, expect, test, type Page } from '@playwright/test';

const ORIGIN = 'https://ui.dloizides.com';
const FORMS_PAGE = `${ORIGIN}/forms`;
const FIELD = 'showcase-datefield';
const INITIAL_ISO = '2026-11-30';
const PICK_ISO = '2026-11-01';
const DIALOG = `[data-testid="${FIELD}-picker"][data-variant]`;
const DAYS = `[data-testid^="${FIELD}-picker-day-"]`;
const MIN_TAP = 44;
const SETTLE_MS = 300;
const FINAL_MS = 1200;
const EDGE_PX = 1;
const PICKER_TEXT = `${DIALOG} *:not([id^="a11y-hint-"]), [data-testid="${FIELD}-anchor"] *:not([id^="a11y-hint-"])`;

const { defaultBrowserType: _phoneBrowser, ...PHONE } = devices['Galaxy S5'];
const { defaultBrowserType: _desktopBrowser, ...DESKTOP } = devices['Desktop Chrome'];
void _phoneBrowser;
void _desktopBrowser;

const DEVICES = [
  { name: 'phone-360x640', use: PHONE, phone: true },
  { name: 'desktop-1280x800', use: { ...DESKTOP, viewport: { width: 1280, height: 800 } }, phone: false },
] as const;

interface Box { x: number; y: number; width: number; height: number }

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no bounding box`);
  return box;
}

async function openFormsField(page: Page): Promise<void> {
  await page.goto(FORMS_PAGE, { timeout: 45_000 });
  const field = page.getByTestId(FIELD).first();
  await field.scrollIntoViewIfNeeded({ timeout: 20_000 });
  await expect(field, 'DateField showcase-datefield visible on the public forms page').toBeVisible({ timeout: 20_000 });
  await expect(field, `specimen starts on ${INITIAL_ISO}, so the picker opens on that month`).not.toHaveValue('');
}

async function textFitProblem(page: Page, selector = PICKER_TEXT): Promise<string> {
  try {
    await expectTextFits(page, selector);
    return '';
  } catch (error) {
    return (error as Error).message.split('\n').slice(0, 4).join(' | ');
  }
}

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.use(device.use);

    test(`AC-UI-DP-${device.phone ? 1 : 2} ui-showcase DateField picker on ${device.name}, opens as ${device.phone ? 'bottom sheet' : 'popover under the field'}, Set date shows a locale date, Esc returns focus`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const consoleErrors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${m.text().slice(0, 200)} @ ${m.location().url}`); });
      page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message.slice(0, 200)}`));
      const failedResponses: string[] = [];
      page.on('response', (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`); });
      const pickIso = PICK_ISO;
      const viewport = page.viewportSize() ?? { width: 0, height: 0 };
      await openFormsField(page);
      const facts: Record<string, unknown> = { device: device.name, viewport, utc: new Date().toISOString(), initialIso: INITIAL_ISO, pickIso };

      await page.getByTestId(`${FIELD}-calendar`).click();
      await page.waitForTimeout(SETTLE_MS);
      const dialog = page.locator(DIALOG);
      await expect(dialog, 'picker dialog opens').toBeVisible();
      const atRest = await boxOf(page, DIALOG);
      await page.waitForTimeout(FINAL_MS);
      const final = await boxOf(page, DIALOG);
      const fieldBox = await boxOf(page, `[data-testid="${FIELD}-anchor"]`);
      const cells = await page.locator(DAYS).evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
      }));
      facts.variant = await dialog.getAttribute('data-variant');
      facts.dialogAtRest = atRest;
      facts.dialogFinal = final;
      facts.field = fieldBox;
      facts.smallestCell = cells.reduce((m, c) => (c.w * c.h < m.w * m.h ? c : m), cells[0] ?? { w: 0, h: 0 });
      facts.textFitPicker = await textFitProblem(page);
      const shot = info.outputPath(`${device.name}-open.png`);
      await page.screenshot({ path: shot });
      facts.screenshot = shot;

      if (device.phone) {
        expect.soft(facts.variant, 'phone opens the sheet variant').toBe('sheet');
        expect.soft(final.width, 'sheet is full width').toBeGreaterThanOrEqual(viewport.width - EDGE_PX);
        expect.soft(Math.abs(final.y + final.height - viewport.height), 'sheet docked to the bottom edge').toBeLessThanOrEqual(EDGE_PX);
        expect.soft(cells.length, 'day cells rendered').toBeGreaterThanOrEqual(28);
        expect.soft(cells.filter((c) => c.w < MIN_TAP || c.h < MIN_TAP), 'every day cell >= 44x44').toEqual([]);
      } else {
        expect.soft(facts.variant, 'desktop opens the popover variant').toBe('popover');
        const below = final.y >= fieldBox.y + fieldBox.height - EDGE_PX;
        const above = final.y + final.height <= fieldBox.y + EDGE_PX;
        facts.popoverSide = below ? 'below' : above ? 'above' : 'covers-field';
        expect.soft(facts.popoverSide, 'popover below the field, or above it when there is no room below, never over it').not.toBe('covers-field');
        expect.soft(final.x >= 0 && final.y >= 0 && final.x + final.width <= viewport.width && final.y + final.height <= viewport.height, 'popover inside the viewport').toBe(true);
        expect.soft(Math.abs(atRest.width - final.width), 'width 300 ms after open equals final width (no stuck scale)').toBeLessThanOrEqual(0.5);
      }
      expect.soft(facts.textFitPicker, 'expectTextFits inside the open picker and field').toBe('');

      await page.locator(`[data-testid="${FIELD}-picker-day-${pickIso}"]`).click();
      await page.getByTestId(`${FIELD}-picker-set`).last().click();
      await expect(dialog, 'Set date closes the picker').toBeHidden();
      facts.valueWhileFocused = await page.getByTestId(FIELD).first().inputValue();
      await page.getByTestId(FIELD).first().blur();
      const shown = await page.getByTestId(FIELD).first().inputValue();
      const expected = await page.evaluate((iso) => {
        const [y, m, d] = iso.split('-').map(Number);
        const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
        const date = new Date(y, m - 1, d);
        return [navigator.language, 'en-GB'].map((l) => new Intl.DateTimeFormat(l, opts).format(date).replace(/,/g, ''));
      }, pickIso);
      facts.closedValue = shown;
      facts.expectedValues = expected;
      expect.soft(expected, `closed field shows the picked date by locale, got "${shown}"`).toContain(shown.replace(/,/g, ''));
      expect.soft(facts.valueWhileFocused, 'field after Set date (focus returned) never shows mm/dd/yyyy').not.toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      facts.textFitClosed = await page.getByTestId(FIELD).first().evaluate((el) => {
        const input = el as HTMLInputElement;
        return input.scrollWidth > input.clientWidth + 1 ? `value "${input.value}" ${input.scrollWidth}px in a ${input.clientWidth}px box` : '';
      });
      expect.soft(facts.textFitClosed, 'expectTextFits on the closed date field').toBe('');

      await page.getByTestId(`${FIELD}-calendar`).click();
      await expect(dialog, 'picker reopens').toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog, 'Esc closes the picker').toBeHidden();
      await page.waitForTimeout(SETTLE_MS);
      facts.focusAfterEsc = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return a ? a.getAttribute('data-testid') ?? a.tagName : null;
      });
      expect.soft(facts.focusAfterEsc, 'Esc returns focus to the field').toBe(FIELD);

      facts.consoleErrors = consoleErrors;
      facts.failedResponses = failedResponses;
      expect.soft(consoleErrors, 'no console errors on the public forms page').toEqual([]);
      fs.writeFileSync(info.outputPath(`${device.name}-facts.json`), JSON.stringify(facts, null, 2));
      console.log(`DATEPICK-2 ui-showcase FACTS ${JSON.stringify(facts)}`);
    });
  });
}
