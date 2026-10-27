import { test, expect, devices, type Locator, type Page } from '@playwright/test';
import { FIELD_CONTROL_SELECTOR, expectFieldsAligned } from '@dloizides/e2e-helpers';

import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';

const { defaultBrowserType: _desktopBrowser, ...desktopChrome } = devices['Desktop Chrome'];
const { defaultBrowserType: _phoneBrowser, ...PHONE } = devices['iPhone 13'];
const DESKTOP = { ...desktopChrome, viewport: { width: 1280, height: 800 } };
const INLINE_ROW_CONTROLS = 2;

interface OrganizerSession {
  email: string;
  password: string;
  eventExternalId: string;
}

let session: OrganizerSession;

async function openEventsList(page: Page, ready: Locator): Promise<void> {
  const login = new KefiLoginPage(page);
  await login.goto();
  await login.signIn({ email: session.email, password: session.password });
  await page.goto(`${getKefiUrls().webUrl}/organizer/events`);
  await expect(ready, 'the events list never rendered the editor control').toBeVisible();
}

async function expectStacked(field: Locator, action: Locator): Promise<void> {
  const fieldBox = await field.boundingBox();
  const actionBox = await action.boundingBox();
  expect(fieldBox, 'field has no bounding box').not.toBeNull();
  expect(actionBox, 'Save has no bounding box').not.toBeNull();
  const fieldBottom = (fieldBox?.y ?? 0) + (fieldBox?.height ?? 0);
  expect(actionBox?.y ?? 0, 'on a phone Save must sit below its field, not beside it').toBeGreaterThanOrEqual(fieldBottom);
}

test.describe('Kefi organizer events: inline field rows (FORM-ALIGN-1)', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test.beforeAll(async () => {
    const ops = await openEventOps();
    session = {
      email: ops.tenant.organizerEmail,
      password: ops.tenant.organizerPassword,
      eventExternalId: ops.tenant.eventExternalId,
    };
  });

  test.describe('desktop 1280x800', () => {
    test.use(DESKTOP);

    test('FORM-ALIGN-1 slug row at 1280x800, input and Save share one top edge and height', async ({ page }) => {
      const row = page.getByTestId(`event-slug-row-${session.eventExternalId}`);
      await openEventsList(page, row);
      await expect(row.locator(FIELD_CONTROL_SELECTOR), 'slug row must hold the input and Save').toHaveCount(INLINE_ROW_CONTROLS);

      const aligned = expectFieldsAligned(page, row);

      await expect(aligned).resolves.toBeUndefined();
    });

    test('FORM-ALIGN-1 start-time row at 1280x800, input and Save share one top edge and height', async ({ page }) => {
      const row = page.getByTestId(`event-start-time-row-${session.eventExternalId}`);
      await openEventsList(page, row);
      await expect(row.locator(FIELD_CONTROL_SELECTOR), 'start-time row must hold the input and Save').toHaveCount(INLINE_ROW_CONTROLS);

      const aligned = expectFieldsAligned(page, row);

      await expect(aligned).resolves.toBeUndefined();
    });
  });

  test.describe('phone iPhone 13', () => {
    test.use(PHONE);

    test('FORM-ALIGN-1 slug row on a phone, Save stacks below the input with no inline row', async ({ page }) => {
      const id = session.eventExternalId;
      const input = page.getByTestId(`event-slug-input-${id}`);
      const save = page.getByTestId(`event-slug-save-${id}`);

      await openEventsList(page, input);

      await expect(page.getByTestId(`event-slug-row-${id}`), 'phones stack; no inline row renders').toHaveCount(0);
      await expectStacked(input, save);
    });

    test('FORM-ALIGN-1 start-time row on a phone, Save stacks below the input with no inline row', async ({ page }) => {
      const id = session.eventExternalId;
      const input = page.getByTestId(`event-start-time-input-${id}`);
      const save = page.getByTestId(`event-start-time-save-${id}`);

      await openEventsList(page, input);

      await expect(page.getByTestId(`event-start-time-row-${id}`), 'phones stack; no inline row renders').toHaveCount(0);
      await expectStacked(input, save);
    });
  });
});
