import { expectTextFits } from '@dloizides/game-e2e';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

import { ZYGOS_WEB_URL, enterConsoleAs, id, merchantAccount, resolveDemoAccounts, sessionFor } from './zygos-master.js';

import type { ZygosSession } from './zygos-session.js';

const ROUTE = '/accounting/journal-entries/new';
const SCREEN = 'zygos-post-journal-screen';
const FIELD = 'post-journal-entry-date';
const DIALOG = `[data-testid="${FIELD}-picker"][data-variant]`;
const DAYS = `[data-testid^="${FIELD}-picker-day-"]`;
const PICKER_TEXT = `${DIALOG} *:not([id^="a11y-hint-"]), [data-testid="${FIELD}-anchor"] *:not([id^="a11y-hint-"])`;
const MIN_TAP = 44;
const EDGE_PX = 1;
const SETTLE_MS = 300;
const FINAL_MS = 1200;
const SCREEN_TIMEOUT_MS = 30_000;

const { defaultBrowserType: _phoneBrowser, ...PHONE } = devices['Galaxy S5'];
const { defaultBrowserType: _desktopBrowser, ...DESKTOP } = devices['Desktop Chrome'];
void _phoneBrowser;
void _desktopBrowser;

const DEVICES = [
  { name: 'phone-360x640', device: PHONE, phone: true },
  { name: 'desktop-1280x800', device: { ...DESKTOP, viewport: { width: 1280, height: 800 } }, phone: false },
] as const;

interface Box { x: number; y: number; width: number; height: number }

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no bounding box`);
  return box;
}

async function textFitProblem(page: Page): Promise<string> {
  try {
    await expectTextFits(page, PICKER_TEXT);
    return '';
  } catch (error) {
    return (error as Error).message.split('\n').slice(0, 4).join(' | ');
  }
}

async function openJournalForm(browser: Browser, session: ZygosSession, device: (typeof DEVICES)[number]): Promise<Page> {
  const context = await browser.newContext({ ...device.device, baseURL: ZYGOS_WEB_URL });
  const page = await context.newPage();
  await enterConsoleAs(page, session, ROUTE);
  await expect(page.locator(id(SCREEN)), `${ROUTE} renders ${SCREEN}`).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  return page;
}

function popoverSide(dialog: Box, field: Box): string {
  if (dialog.y >= field.y + field.height - EDGE_PX) return 'below';
  if (dialog.y + dialog.height <= field.y + EDGE_PX) return 'above';
  return 'covers-field';
}

test.describe('DATEPICK-1 FinReg journal date picker sighting @zygos-ui @ui', () => {
  let session: ZygosSession | null = null;

  test.beforeAll(async () => {
    session = await sessionFor(merchantAccount(await resolveDemoAccounts()));
  });

  for (const device of DEVICES) {
    test(`AC-UI-DP-${device.phone ? 1 : 2} journal date picker on ${device.name}, opens as ${device.phone ? 'bottom sheet' : 'popover beside the field'}, Esc cancels without a change and returns focus`, async ({ browser }, info) => {
      test.skip(!session, 'FinReg demo merchant account not published or its login was rejected');
      test.setTimeout(120_000);
      const page = await openJournalForm(browser, session as ZygosSession, device);
      const consoleErrors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${m.text().slice(0, 200)} @ ${m.location().url}`); });
      page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message.slice(0, 200)}`));
      const viewport = page.viewportSize() ?? { width: 0, height: 0 };
      const field = page.getByTestId(FIELD).first();
      const before = await field.inputValue();
      const facts: Record<string, unknown> = { device: device.name, viewport, utc: new Date().toISOString(), url: page.url(), before };

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
      facts.dialog = final;
      facts.field = fieldBox;
      facts.textFitPicker = await textFitProblem(page);
      const shot = info.outputPath(`finreg-${device.name}-open.png`);
      await page.screenshot({ path: shot });
      facts.screenshot = shot;

      if (device.phone) {
        expect.soft(facts.variant, 'phone opens the sheet variant').toBe('sheet');
        expect.soft(final.width, 'sheet is full width').toBeGreaterThanOrEqual(viewport.width - EDGE_PX);
        expect.soft(Math.abs(final.y + final.height - viewport.height), 'sheet docked to the bottom edge').toBeLessThanOrEqual(EDGE_PX);
        expect.soft(cells.filter((c) => c.w < MIN_TAP || c.h < MIN_TAP), 'every day cell >= 44x44').toEqual([]);
      } else {
        facts.popoverSide = popoverSide(final, fieldBox);
        expect.soft(facts.variant, 'desktop opens the popover variant').toBe('popover');
        expect.soft(facts.popoverSide, 'popover below the field, or above it when there is no room below, never over it').not.toBe('covers-field');
        expect.soft(final.x >= 0 && final.y >= 0 && final.x + final.width <= viewport.width && final.y + final.height <= viewport.height, 'popover inside the viewport').toBe(true);
        expect.soft(Math.abs(atRest.width - final.width), 'width 300 ms after open equals final width (no stuck scale)').toBeLessThanOrEqual(0.5);
      }
      expect.soft(facts.textFitPicker, 'expectTextFits inside the open picker and field').toBe('');

      await page.keyboard.press('Escape');
      await expect(dialog, 'Esc closes the picker').toBeHidden();
      await page.waitForTimeout(SETTLE_MS);
      facts.focusAfterEsc = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);
      expect.soft(facts.focusAfterEsc, 'Esc returns focus to the field').toBe(FIELD);
      await field.blur();
      facts.after = await field.inputValue();
      expect.soft(facts.after, 'cancel leaves the date unchanged').toBe(before);

      facts.consoleErrors = consoleErrors;
      expect.soft(consoleErrors, 'no console errors').toEqual([]);
      console.log(`DATEPICK-1 FINREG FACTS ${JSON.stringify(facts)}`);
      await page.context().close();
    });
  }
});
