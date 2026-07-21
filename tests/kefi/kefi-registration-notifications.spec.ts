/**
 * Kefi organizer REGISTRATION-NOTIFICATIONS card E2E — "tell me when someone
 * registers" (kefi-web 1be3ce2, kefi-api migration 20260721163209).
 *
 * This card is the organizer's only self-serve way to be told that somebody
 * signed up; the previous answer was "ask a developer to edit the database".
 * Every assertion here is about the one property that makes it a feature rather
 * than a decoration: what the organizer SEES must match what the server DOES.
 *
 * The three semantics under test, in descending order of how badly they fail:
 *
 *  1. WHATSAPP-ONLY MUST WARN. Channels are `None = 0`, `Email = 1`,
 *     `WhatsAppHandoff = 2`. WhatsApp handoff has NO server sender — a `wa.me`
 *     link opens a chat on a device — so selecting only it means NO automatic
 *     message is ever sent. Without the warning the organizer has switched
 *     notifications "on", the card looks entirely correct, and she is never
 *     told about a single registration — worse than an obviously absent
 *     feature, because she stops checking the dashboard. The warning is driven
 *     by `serverDeliveredChannels` from the GET, so it is asserted against the
 *     REAL server payload, not a hard-coded list.
 *
 *  2. DEFAULT DISABLED. A tenant that has never configured this must open the
 *     card OFF. A default-on would have started mailing every existing tenant
 *     the moment the migration landed.
 *
 *  3. PERSISTENCE. The toggle and channel selection must survive a full reload,
 *     in BOTH directions. A setting that silently reverts is, to the organizer,
 *     indistinguishable from one that never saved.
 *
 * Validation (the recipient cap, invalid addresses) and the accessibility
 * assertion live in `kefi-registration-notifications-validation.spec.ts`;
 * phone-viewport geometry lives in `-mobile.spec.ts`.
 *
 * WRITES REAL PER-TENANT CONFIG on the dedicated `e2e` fixture tenant; the
 * baseline is snapshotted and restored, and `assertNotCustomerTenant` is what
 * stops this ever pointing at a paying customer. SERIAL — one login per file,
 * because concurrent Keycloak password grants have produced transient 401s.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  CHANNEL_EMAIL,
  CHANNEL_WHATSAPP_HANDOFF,
  type MyRegistrationNotifications,
  type RegistrationNotificationsCard,
  cardControls,
  expectChecked,
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
import { type ConsoleGuard } from '../../helpers/consoleGuard.js';
import { isRemoteTarget } from '../../helpers/target.js';

/** The BFF path both verbs share, for route interception. */
const CONFIG_ROUTE = '**/bff/api/kefi/api/v1/admin/registration-notifications';

/** A recipient that can never resolve (RFC 2606) — safe on a prod tenant. */
const SAFE_RECIPIENT = 'e2e-registration-notify@example.invalid';

test.describe.configure({ mode: 'serial' });

test.describe('Kefi organizer registration-notifications card', () => {
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
    test.info().attach('baseline-config', {
      body: JSON.stringify(baseline, null, 2),
      contentType: 'application/json',
    });
  });

  test.afterAll(async () => {
    // Restore through the API rather than the UI: teardown must not depend on
    // the thing under test still working.
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
   * A FULL document navigation is the point. Re-reading in-memory React state
   * would prove only that the component kept its own buffer — true even when
   * nothing persisted. `goto(page.url())` over `reload()` because it cannot be
   * served from the back-forward cache, so the config is genuinely re-fetched.
   */
  async function reloadCard(): Promise<void> {
    await page.goto(page.url());
    controls = cardControls(page);
    await expect(controls.card, 'the card survives a reload').toBeVisible({ timeout: 45_000 });
  }

  test('@ui the card renders on the organizer dashboard with every control reachable', async () => {
    const tenant = getKefiFixtureTenant();
    test.info().annotations.push({ type: 'tenant', description: tenant.slug });

    await expect(controls.card, 'the registration-notifications card').toBeVisible();
    await expect(controls.enableToggle, 'the master enable toggle').toBeVisible();
    await expect(controls.emailChannel, 'the Email channel row').toBeVisible();
    await expect(controls.whatsappChannel, 'the WhatsApp-handoff channel row').toBeVisible();
    await expect(controls.saveButton, 'the save button').toBeVisible();
    await expect(controls.saveButton, 'the save button is operable').toBeEnabled();

    // The card must say where mail lands. An organizer who cannot see the
    // destination has no way to know a blank recipient field means "my login
    // address" rather than "nowhere" — the single most likely misreading.
    const destinationShown =
      (await controls.destination.isVisible()) || (await controls.noDestination.isVisible());
    expect(
      destinationShown,
      'the card states where notifications will be delivered. Without this line a blank ' +
        'recipient field is ambiguous between "the owner account email" and "nobody", and the ' +
        'organizer cannot tell which she has configured.',
    ).toBe(true);

    await test.info().attach('card-desktop.png', {
      body: await controls.card.screenshot(),
      contentType: 'image/png',
    });

    consoleGuard.expectClean('the organizer dashboard carrying the registration-notifications card');
  });

  test('@ui a never-configured tenant opens the card OFF, not silently on', async () => {
    // Forced through route interception rather than read off the live tenant:
    // this suite WRITES config, so once it has run even once the fixture tenant
    // is no longer "never configured" and the real payload can no longer prove
    // the default. Intercepting the GET reproduces the exact payload the backend
    // returns for an unconfigured tenant (`config: null`) and asserts what the
    // UI does with it — which is the property that matters here.
    await page.route(CONFIG_ROUTE, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: null,
          ownerAccountEmail: baseline.ownerAccountEmail,
          serverDeliveredChannels: baseline.serverDeliveredChannels,
        } satisfies MyRegistrationNotifications),
      });
    });

    try {
      await reloadCard();

      await expectChecked(
        controls.enableToggle,
        'the master enable toggle for a tenant with NO stored config (config: null)',
        false,
      );

      // The warning must NOT fire while the feature is off — an unconfigured
      // tenant showing a scary "no message will be sent" box would train every
      // organizer to ignore the one banner that matters.
      await expect(
        controls.noServerChannelWarning,
        'the no-server-channel warning stays hidden while notifications are OFF — it is only ' +
          'meaningful once the organizer has actually switched them on',
      ).toBeHidden();
    } finally {
      await page.unroute(CONFIG_ROUTE);
    }

    await reloadCard();
  });

  test('@ui selecting ONLY WhatsApp handoff warns that nothing will be sent', async () => {
    // Asserted against the REAL serverDeliveredChannels from the live GET, not
    // a hard-coded list — that is the whole design of the check. If the backend
    // ever registers a genuine WhatsApp sender this test correctly stops
    // expecting the warning, with no frontend release and no test edit.
    const serverDelivered = baseline.serverDeliveredChannels;
    test.info().attach('serverDeliveredChannels', {
      body: JSON.stringify(serverDelivered),
      contentType: 'application/json',
    });

    expect(
      serverDelivered,
      'the backend reports which channels it can genuinely deliver. An empty list here would ' +
        'mean the server can send NOTHING, which no channel selection could fix.',
    ).not.toEqual([]);

    await setChecked(controls.enableToggle, true);
    await setChecked(controls.emailChannel, false);
    await setChecked(controls.whatsappChannel, true);

    const whatsappIsServerDelivered = serverDelivered.includes(CHANNEL_WHATSAPP_HANDOFF);

    if (whatsappIsServerDelivered) {
      await expect(
        controls.noServerChannelWarning,
        'the backend now reports whatsapp-handoff as server-delivered, so the warning is ' +
          'correctly suppressed — a real WhatsApp sender has been registered',
      ).toBeHidden();
      return;
    }

    await expect(
      controls.noServerChannelWarning,
      'WhatsApp handoff is NOT in serverDeliveredChannels, so with it selected alone the server ' +
        'will send NOTHING when somebody registers. The card MUST say so. Without this warning ' +
        'the organizer has switched notifications on, the UI looks entirely correct, and she is ' +
        'never told about a single registration — she just stops hearing about sign-ups and has ' +
        'no way to discover why.',
    ).toBeVisible();

    const warningText = (await controls.noServerChannelWarning.innerText()).trim();
    expect(
      warningText.length,
      'the warning carries actual explanatory text rather than rendering an empty box',
    ).toBeGreaterThan(0);
    test.info().attach('whatsapp-only-warning.txt', {
      body: warningText,
      contentType: 'text/plain',
    });
    await test.info().attach('whatsapp-only-warning.png', {
      body: await controls.card.screenshot(),
      contentType: 'image/png',
    });

    // Re-adding a server-delivered channel must clear it — a warning that never
    // goes away is a warning nobody reads.
    await setChecked(controls.emailChannel, true);
    await expect(
      controls.noServerChannelWarning,
      'the warning clears once a genuinely server-delivered channel is selected alongside it',
    ).toBeHidden();

    consoleGuard.expectClean('the registration-notifications card during channel selection');
  });

  test('@ui the enabled toggle and the channel selection survive a reload', async () => {
    await setChecked(controls.enableToggle, true);
    await setChecked(controls.emailChannel, true);
    await setChecked(controls.whatsappChannel, true);
    await controls.recipientsInput.fill(SAFE_RECIPIENT);

    await controls.saveButton.click();
    await expect(controls.banner, 'saving reports an outcome').toBeVisible({ timeout: 20_000 });
    const saveMessage = (await controls.banner.innerText()).trim();
    test.info().attach('save-banner.txt', { body: saveMessage, contentType: 'text/plain' });

    await reloadCard();

    await expectChecked(controls.enableToggle, 'the master enable toggle after a reload', true);
    await expectChecked(controls.emailChannel, 'the Email channel after a reload', true);
    await expectChecked(controls.whatsappChannel, 'the WhatsApp channel after a reload', true);
    await expect(
      controls.recipientsInput,
      'the recipient the organizer typed is read back after a reload — a recipient list that ' +
        'silently empties means notifications go to the owner account she may not monitor',
    ).toHaveValue(new RegExp(SAFE_RECIPIENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    // …and OFF must persist too. A toggle that only saves in one direction
    // means an organizer who deliberately silences notifications keeps getting
    // them, which is the complaint that ends in "your app is broken".
    await setChecked(controls.enableToggle, false);
    await controls.saveButton.click();
    await expect(controls.banner, 'turning notifications off reports an outcome').toBeVisible({
      timeout: 20_000,
    });

    await reloadCard();
    await expectChecked(
      controls.enableToggle,
      'the master enable toggle after being switched OFF and reloaded',
      false,
    );

    consoleGuard.expectClean('the registration-notifications card across save + reload');
  });

});
