import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, type Page, type TestInfo } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiAttendeeDeleteClient } from '../../helpers/kefi/kefiAttendeeDeleteClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

const SITE_URL = process.env.KEFI_CSDF_SITE_URL ?? 'https://csdf.kefi.dloizides.com';
const TENANT_SLUG = 'csdf';
const REGISTRANT_EMAIL = 'e2e-kefi-bot@dloizides.com';
const REGISTRANT_NAME = 'Ayşe';
const REGISTRANT_SURNAME = 'Yılmaz';
const PHONE_PREFIX = '+357990';
const RUN_TAG_MODULO = 1000;
const RUN_TAG_DIGITS = 3;
const MS_PER_MINUTE = 60_000;
const RUN_TAG = String(Math.floor(Date.now() / MS_PER_MINUTE) % RUN_TAG_MODULO).padStart(RUN_TAG_DIGITS, '0');
const PASS_CODE = 'FULL';
const EXPECTED_NAME_SEGMENT = 'AYSE-YILMAZ';
const REFERENCE_PATTERN = /^FULL-AYSE-YILMAZ-[A-HJ-NP-Z2-9]{4}$/;
const SUFFIX_LENGTH = 4;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;
const REGISTER_TIMEOUT_MS = 30_000;

const enum Rail {
  Revolut = 'Revolut',
  Bank = 'Bank',
}

interface RegisterBody {
  attendeeExternalId?: string;
  eventExternalId?: string;
  paymentReference?: string | null;
}

interface CreatedRow {
  attendeeExternalId: string;
  eventExternalId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '')
    throw new Error(`${name} is unset: the CSDF organiser login is needed to delete the test attendee`);
  return value;
}

async function organiserBearer(): Promise<string> {
  return new KefiAdminClient().getTenantOwnerBearer({
    email: requireEnv('CSDF_KEFI_ORGANIZER_EMAIL'),
    password: requireEnv('CSDF_KEFI_ORGANIZER_PASSWORD'),
  });
}

async function deleteRows(rows: CreatedRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  const bearer = await organiserBearer();
  const client = new KefiAttendeeDeleteClient();
  const failures: string[] = [];
  for (const row of rows) {
    const first = await client.deleteAttendee({ bearer, ...row });
    if (first.status !== HTTP_NO_CONTENT)
      failures.push(`delete ${row.attendeeExternalId} returned ${first.status}`);
    const again = await client.deleteAttendee({ bearer, ...row });
    if (again.status !== HTTP_NOT_FOUND)
      failures.push(`attendee ${row.attendeeExternalId} still present (${again.status})`);
  }
  return failures;
}

async function chooseOption(page: Page, inputSelector: string): Promise<void> {
  await page.locator('label', { has: page.locator(inputSelector) }).first().click();
  await expect(page.locator(inputSelector), `${inputSelector} is selected`).toBeChecked();
}

function phoneFor(rail: Rail, testInfo: TestInfo): string {
  const device = testInfo.project.name.endsWith('mobile') ? '1' : '2';
  const railDigit = rail === Rail.Revolut ? '1' : '2';
  return `${PHONE_PREFIX}${RUN_TAG}${device}${railDigit}`;
}

async function fillForm(page: Page, phone: string): Promise<void> {
  await page.locator('#sr-name').fill(REGISTRANT_NAME);
  await page.locator('#sr-surname').fill(REGISTRANT_SURNAME);
  await page.locator('#sr-phone').fill(phone);
  await page.locator('#sr-email').fill(REGISTRANT_EMAIL);
  await chooseOption(page, `input[name="passCode"][value="${PASS_CODE}"]`);
  await chooseOption(page, '#sr-gender-0');
  await chooseOption(page, '#sr-app-0');
}

async function openForm(page: Page): Promise<void> {
  await page.goto(`${SITE_URL}/#register`);
  await expect(page.locator('#sr-name'), 'the register form renders').toBeVisible();
}

async function pickRail(page: Page, rail: Rail): Promise<string> {
  await chooseOption(page, `input[name="paymentMethod"][value="${rail}"]`);
  const reference = page.locator('#sri-pay-ref-value');
  await expect(reference, 'the reference preview is built').toHaveText(REFERENCE_PATTERN);
  return (await reference.textContent())?.trim() ?? '';
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.INLINE_PAY_4_SCREENSHOT_DIR ?? testInfo.outputPath('screenshots');
  mkdirSync(dir, { recursive: true });
  const device = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-');
  await page.screenshot({ path: join(dir, `${device}-${name}.png`), fullPage: false });
}

async function submit(page: Page): Promise<{ status: number; body: RegisterBody }> {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(`/t/${TENANT_SLUG}/register`) && r.request().method() === 'POST',
    { timeout: REGISTER_TIMEOUT_MS },
  );
  await page.locator('#sr-submit').click();
  const response = await responsePromise;
  const body = (await response.json().catch(() => ({}))) as RegisterBody;
  return { status: response.status(), body };
}

for (const rail of [Rail.Revolut, Rail.Bank]) {
  test.describe(`INLINE-PAY-4 payment reference, ${rail}`, () => {
    test.skip(!isRemoteTarget(), 'drives the deployed CSDF landing');

    test(`AC-FLOW-1 ${rail} rail with a Turkish name, previews FULL-AYSE-YILMAZ-XXXX that survives reload and equals the registered reference`, async ({
      page,
    }, testInfo) => {
      const created: CreatedRow[] = [];
      const phone = phoneFor(rail, testInfo);
      try {
        await openForm(page);
        await fillForm(page, phone);

        const preview = await pickRail(page, rail);

        await expect(
          page.locator(`[data-ipay-steps="${rail}"]`),
          `the ${rail} payment steps show before registering`,
        ).toBeVisible();
        await expect(page.locator('#sri-pay-ref-copy'), 'Copy is offered next to the reference').toBeEnabled();
        await expect(page.locator('#sr-ipay-confirm-row'), 'the "I have paid" tick is offered').toBeVisible();
        expect(preview, 'the Turkish name is transliterated, not dropped').toContain(EXPECTED_NAME_SEGMENT);
        await capture(page, testInfo, `${rail}-1-preview`);

        await page.goto(SITE_URL);
        await expect(page.locator('#sr-name'), 'the form renders after reload').toBeVisible();
        await fillForm(page, phone);
        const afterReload = await pickRail(page, rail);
        expect(afterReload.slice(-SUFFIX_LENGTH), 'reload keeps the suffix the payer may already have used').toBe(
          preview.slice(-SUFFIX_LENGTH),
        );

        await page.locator('#sr-ipay-confirm').check();
        await page.locator('#sr-consent').check();
        const terms = page.locator('#sr-payment-terms');
        if (await terms.isVisible()) await terms.check();
        await capture(page, testInfo, `${rail}-2-ready`);
        const registered = await submit(page);
        if (registered.body.attendeeExternalId && registered.body.eventExternalId)
          created.push({
            attendeeExternalId: registered.body.attendeeExternalId,
            eventExternalId: registered.body.eventExternalId,
          });

        expect(registered.status, 'the single register POST succeeds').toBe(HTTP_CREATED);
        expect(registered.body.paymentReference, 'the server reference equals the preview the payer copied').toBe(
          afterReload,
        );
        await capture(page, testInfo, `${rail}-3-registered`);
      } finally {
        const failures = await deleteRows(created);
        expect(failures, 'every attendee this test created is deleted').toEqual([]);
      }
    });
  });
}
