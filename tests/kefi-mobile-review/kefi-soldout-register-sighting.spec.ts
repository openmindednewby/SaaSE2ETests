import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { fixtureTenantAvailable, FIXTURE_TENANT_SKIP_REASON, getKefiFixtureTenant } from '../../helpers/kefi/kefiFixtureTenant.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';

test.describe.configure({ mode: 'serial' });

const SHOT_DIR = 'qa-screenshots/kefi-soldout-register';
const STATUSES = ['OnSale', 'SoldOut', 'Hidden', 'Retired'] as const;
const MIN_HIT_PX = 44;
const SUBPIXEL = 1;
const MAX_OPTION_LENGTH = 50;
const LONG_OPTION = 'L'.repeat(MAX_OPTION_LENGTH + 1);
const SHELL_TIMEOUT = 45_000;
const TEXT_SELECTOR = 'body *:not(.skip):not([id^="a11y-hint-"])';

interface PassRow {
  externalId: string;
  status?: string;
}

function passesUrl(eventExternalId: string): string {
  return `${getKefiUrls().webUrl}/bff/api/kefi/api/v1/organizer/events/${encodeURIComponent(eventExternalId)}/passes`;
}

async function readPasses(page: Page, eventExternalId: string): Promise<PassRow[]> {
  const res = await page.request.get(passesUrl(eventExternalId));
  expect(res.status(), `GET passes for ${eventExternalId}`).toBe(200);
  const body = (await res.json()) as PassRow[] | { items?: PassRow[] };
  return Array.isArray(body) ? body : (body.items ?? []);
}

async function signIn(page: Page): Promise<void> {
  const tenant = getKefiFixtureTenant();
  const login = new KefiLoginPage(page);
  await login.goto();
  await login.signIn({ email: tenant.organizerEmail, password: tenant.organizerPassword });
}

async function openPassEditor(page: Page, passId: string): Promise<void> {
  await page.goto(`${getKefiUrls().webUrl}/organizer/passes`);
  const actions = page.getByTestId(`organizer-pass-actions-${passId}`);
  await expect(actions, 'the passes list never rendered the pass row').toBeVisible({ timeout: SHELL_TIMEOUT });
  const inline = page.getByTestId(`organizer-pass-edit-${passId}`);
  if (await inline.isVisible()) await inline.click();
  else {
    await page.getByTestId(`organizer-pass-actions-${passId}-overflow`).click();
    await page.getByTestId(`organizer-pass-edit-${passId}-menu-item`).click();
  }
  await expect(page.getByTestId('organizer-pass-status-note'), 'the pass form never showed the status note').toBeVisible();
}

async function setStatusAndSave(page: Page, status: string): Promise<void> {
  await page.getByTestId(`organizer-pass-status-${status}`).click();
  await page.getByTestId('organizer-pass-submit').click();
  await expect(page.getByTestId('organizer-pass-submit'), 'save never finished').toBeEnabled();
}

async function expectSaneLayout(page: Page, testInfo: TestInfo, step: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-${step}.png` });
  expect(overflow, `${step}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(SUBPIXEL);
  await expectTextFits(page, TEXT_SELECTOR);
}

async function chipHeight(chip: Locator): Promise<number> {
  const box = await chip.boundingBox();
  return box?.height ?? 0;
}

test.describe('Kefi pass status + register option lines (sighting)', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('KEFI-SOLDOUT-2 pass set to Sold out and saved, reload and GET show SoldOut', async ({ page }, testInfo) => {
    const eventId = getKefiFixtureTenant().eventExternalId;
    await signIn(page);
    const [pass] = await readPasses(page, eventId);
    expect(pass, 'the e2e fixture event has no pass to edit').toBeDefined();
    const original = pass.status ?? 'OnSale';
    await openPassEditor(page, pass.externalId);
    for (const status of STATUSES) {
      const chip = page.getByTestId(`organizer-pass-status-${status}`);
      await expect(chip, `status chip ${status} missing`).toBeVisible();
      expect(await chipHeight(chip), `status chip ${status} is shorter than ${MIN_HIT_PX}px`).toBeGreaterThanOrEqual(MIN_HIT_PX);
    }
    await page.getByTestId('organizer-pass-status-OnSale').scrollIntoViewIfNeeded();
    await expectSaneLayout(page, testInfo, 'pass-status-before');

    try {
      await setStatusAndSave(page, 'SoldOut');
      await page.reload();
      const saved = (await readPasses(page, eventId)).find((p) => p.externalId === pass.externalId);

      expect(saved?.status, 'GET passes after save and reload').toBe('SoldOut');
      await openPassEditor(page, pass.externalId);
      await expect(page.getByTestId('organizer-pass-status-note'), 'note follows the saved status').toContainText('sold-out');
      await page.getByTestId('organizer-pass-status-SoldOut').scrollIntoViewIfNeeded();
      await expectSaneLayout(page, testInfo, 'pass-status-soldout');
    } finally {
      await openPassEditor(page, pass.externalId);
      await setStatusAndSave(page, original);
      const restored = (await readPasses(page, eventId)).find((p) => p.externalId === pass.externalId);
      expect(restored?.status, `teardown restores ${original}`).toBe(original);
    }
  });

  test(`KUCY-REG-FOLLOWUPS-1 option line of ${LONG_OPTION.length} chars, shows the line 2 error without saving`, async ({ page }, testInfo) => {
    const fieldId = 'landing-form-registration-fields-levelOptions';
    const typed = `Beginner\n${LONG_OPTION}`;
    await signIn(page);
    await page.goto(`${getKefiUrls().webUrl}/organizer/landing`);
    const section = page.getByTestId('landing-builder-section-registration');
    await expect(section, 'the Register section row never rendered').toBeVisible({ timeout: SHELL_TIMEOUT });
    await section.click();
    const field = page.getByTestId(fieldId);
    await expect(field, 'the level options field never rendered').toBeVisible();
    const input = field.locator('xpath=self::textarea|self::input').or(field.locator('textarea, input')).first();

    await input.fill(typed);

    const error = page.getByTestId(`${fieldId}-error`);
    await expect(error, 'no per-line error for an over-long option').toContainText('line 2');
    await expect(error).toContainText(String(MAX_OPTION_LENGTH));
    await error.scrollIntoViewIfNeeded();
    await expectSaneLayout(page, testInfo, 'register-option-error');
  });
});
