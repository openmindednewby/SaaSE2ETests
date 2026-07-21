/**
 * Kefi organizer registration-notifications card — VALIDATION and ACCESSIBILITY.
 *
 * Split from `kefi-registration-notifications.spec.ts`, which owns the four
 * behavioural semantics (renders, defaults off, warns on WhatsApp-only,
 * persists). This file owns the two ways the card must REFUSE input, plus the
 * one way it currently fails a user who cannot see it.
 *
 * Refusal matters here for a specific reason: the backend enforces the same
 * rules, so without inline validation the organizer meets a raw 400 she cannot
 * interpret — or, worse, believes she saved a recipient list the server
 * silently truncated. "I added the whole team and only I get the emails" is a
 * support ticket nobody can diagnose from the outside.
 *
 * ⚠️ WRITES REAL PER-TENANT CONFIG on the dedicated `e2e` fixture tenant, with
 * the baseline snapshotted and restored. SERIAL — one login for the file.
 */

import { test, expect, type Page } from '@playwright/test';

import {
  CHANNEL_EMAIL,
  MAX_RECIPIENTS,
  type MyRegistrationNotifications,
  type RegistrationNotificationsCard,
  cardControls,
  expectExposesCheckedStateToAssistiveTech,
  openRegistrationNotificationsCard,
  readConfigFromApi,
  setChecked,
  writeConfigViaApi,
} from '../../helpers/kefi/kefiRegistrationNotifications.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
  getKefiFixtureTenant,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { type ConsoleGuard } from '../../helpers/consoleGuard.js';
import { isRemoteTarget } from '../../helpers/target.js';

/** One more than the cap, to prove the cap is enforced rather than declared. */
const OVER_CAP_RECIPIENTS = Array.from(
  { length: MAX_RECIPIENTS + 1 },
  (_, index) => `e2e-cap-${index}@example.invalid`,
).join(', ');

/** Structurally impossible address — no `@`, so no domain to deliver to. */
const INVALID_RECIPIENT = 'not-an-email-address';

test.describe.configure({ mode: 'serial' });

test.describe('Kefi registration-notifications card validation', () => {
  test.skip(!isRemoteTarget(), 'the card lives on the deployed kefi-web organizer dashboard');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  let page: Page;
  let controls: RegistrationNotificationsCard;
  let consoleGuard: ConsoleGuard;
  let baseline: MyRegistrationNotifications;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    const opened = await openRegistrationNotificationsCard(page);
    controls = opened.controls;
    consoleGuard = opened.console;
    baseline = await readConfigFromApi(page);
  });

  test.afterAll(async () => {
    if (page && baseline) {
      await writeConfigViaApi(
        page,
        baseline.config ?? { enabled: false, channels: [CHANNEL_EMAIL], recipientEmails: [] },
      );
    }
    await page?.close();
  });

  /**
   * Re-load the dashboard from the server and re-resolve the card.
   *
   * A FULL document navigation is the point, not a shortcut. The assertion is
   * that the setting survives a fresh load of the app, so re-reading in-memory
   * React state — or a client-side route change — would prove only that the
   * component kept its own buffer, which stays true even when nothing was
   * persisted at all. `goto(page.url())` is used in preference to `reload()`
   * because it cannot be served from the back-forward cache, so the tenant
   * config is genuinely re-fetched rather than restored from a snapshot.
   */
  async function reloadCard(): Promise<void> {
    await page.goto(page.url());
    controls = cardControls(page);
    await expect(controls.card, 'the card survives a reload').toBeVisible({ timeout: 45_000 });
  }

  test(`@ui more than ${MAX_RECIPIENTS} recipients is refused with a visible message`, async () => {
    await setChecked(controls.enableToggle, true);
    await setChecked(controls.emailChannel, true);
    await controls.recipientsInput.fill(OVER_CAP_RECIPIENTS);
    await controls.saveButton.click();

    await expect(
      controls.banner,
      `${MAX_RECIPIENTS + 1} recipients is over the ${MAX_RECIPIENTS} cap the backend enforces, ` +
        'so the card must refuse it inline. Letting it through means the organizer meets a raw ' +
        '400 she cannot interpret, or worse, believes she saved a list the server truncated.',
    ).toBeVisible({ timeout: 20_000 });

    const capMessage = (await controls.banner.innerText()).trim();
    expect(
      capMessage.length,
      'the over-cap refusal carries a readable message rather than an empty banner',
    ).toBeGreaterThan(0);
    test.info().attach('over-cap-banner.txt', { body: capMessage, contentType: 'text/plain' });

    // The refusal must be a REFUSAL — the over-cap list must not reach the server.
    await reloadCard();
    const stored = await readConfigFromApi(page);
    expect(
      stored.config?.recipientEmails.length ?? 0,
      'the rejected over-cap list was never persisted. A banner that says "too many" while the ' +
        'save still went through is the worst of both worlds.',
    ).toBeLessThanOrEqual(MAX_RECIPIENTS);

    consoleGuard.expectClean('the registration-notifications card after an over-cap save attempt');
  });


  test('@ui a structurally invalid recipient address is refused', async () => {
    await setChecked(controls.enableToggle, true);
    await setChecked(controls.emailChannel, true);
    await controls.recipientsInput.fill(INVALID_RECIPIENT);
    await controls.saveButton.click();

    await expect(
      controls.banner,
      `"${INVALID_RECIPIENT}" has no @ and therefore no domain — no mail gateway could ever ` +
        'deliver to it. The card must say so inline. Accepting it silently leaves the organizer ' +
        'believing she is covered while every notification bounces into nothing.',
    ).toBeVisible({ timeout: 20_000 });

    const invalidMessage = (await controls.banner.innerText()).trim();
    expect(
      invalidMessage.length,
      'the invalid-address refusal carries a readable message',
    ).toBeGreaterThan(0);
    test.info().attach('invalid-email-banner.txt', {
      body: invalidMessage,
      contentType: 'text/plain',
    });

    await reloadCard();
    const stored = await readConfigFromApi(page);
    expect(
      stored.config?.recipientEmails ?? [],
      'the invalid address was never persisted',
    ).not.toContain(INVALID_RECIPIENT);

    consoleGuard.expectClean('the registration-notifications card after an invalid-address save');
  });


  test('@ui the toggles report their checked state to assistive technology', async () => {
    // Split out from the render test because it fails for a DIFFERENT reason
    // and needs to be readable as its own defect: the controls work with a
    // mouse and are unusable with a screen reader.
    await expectExposesCheckedStateToAssistiveTech(
      controls.enableToggle,
      'the master "notify me" enable toggle',
    );
    await expectExposesCheckedStateToAssistiveTech(
      controls.emailChannel,
      'the Email channel row',
    );
    await expectExposesCheckedStateToAssistiveTech(
      controls.whatsappChannel,
      'the WhatsApp-handoff channel row',
    );
  });
  test('@ui the dashboard hosting the card logs no console errors', async () => {
    // The final sweep, deliberately LAST in the file: a fresh full load of the
    // dashboard after every interaction above has run. An error that only
    // appears once the card has been saved to and reloaded — a stale query
    // cache, a serialization mismatch — shows up here and nowhere else.
    const { webUrl } = getKefiUrls();
    const tenant = getKefiFixtureTenant();
    await page.goto(`${webUrl}/organizer?event=${encodeURIComponent(tenant.eventExternalId)}`);
    controls = cardControls(page);
    await expect(controls.card).toBeVisible({ timeout: 45_000 });

    consoleGuard.expectClean('a fresh load of the organizer dashboard');
  });
});
