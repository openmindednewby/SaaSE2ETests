/**
 * Shared surface driver for the organizer registration-notifications card
 * (`RegistrationNotificationsCard`, kefi-web commit 1be3ce2).
 *
 * The card is the organizer's answer to "tell me when someone registers". It is
 * per-TENANT config edited from the organizer dashboard, and it defaults to
 * DISABLED — a tenant that has never touched it must show the card off, never
 * silently on.
 *
 * Why a driver instead of a page object per spec: reaching the card is three
 * steps (log in → land on /organizer → wait for the tenant-level GET to
 * resolve), and every one of them can fail in a way that looks like "the card
 * is missing". Concentrating them here means a failure names WHICH step broke.
 *
 * ⚠️ WRITES REAL TENANT CONFIG. Every save here mutates the live per-tenant
 * blob for the resolved fixture tenant, so the tenant guard in
 * {@link getKefiFixtureTenant} is the thing standing between this suite and a
 * paying customer's notification settings. Do not bypass it. Specs that save
 * MUST capture {@link readConfigFromApi} first and restore it in `afterAll`,
 * so a run leaves the tenant exactly as it found it.
 */

import { type Locator, type Page, expect } from '@playwright/test';

import { getKefiFixtureTenant } from './kefiFixtureTenant.js';
import { getKefiUrls } from './kefiUrls.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { attachConsoleGuard, type ConsoleGuard } from '../consoleGuard.js';

export {
  CHECK_GLYPH,
  expectChecked,
  expectExposesCheckedStateToAssistiveTech,
  isChecked,
  setChecked,
} from './kefiCheckboxField.js';
import type {
  MyRegistrationNotifications,
  RegistrationNotificationConfig,
} from './kefiRegistrationNotifications.types.js';

export {
  CHANNEL_EMAIL,
  CHANNEL_WHATSAPP_HANDOFF,
  MAX_RECIPIENTS,
  type MyRegistrationNotifications,
  type RegistrationNotificationConfig,
} from './kefiRegistrationNotifications.types.js';

/** Every control on the card, resolved once. */
export interface RegistrationNotificationsCard {
  card: Locator;
  enableToggle: Locator;
  emailChannel: Locator;
  whatsappChannel: Locator;
  /** The "no automatic message will be sent" warning. */
  noServerChannelWarning: Locator;
  recipientsField: Locator;
  /** The actual `<input>` inside the recipients field. */
  recipientsInput: Locator;
  destination: Locator;
  noDestination: Locator;
  saveButton: Locator;
  banner: Locator;
  loading: Locator;
  loadError: Locator;
}

/** Resolve every control on the card from a page already showing it. */
export function cardControls(page: Page): RegistrationNotificationsCard {
  const recipientsField = page.getByTestId('registration-notifications-recipients');
  return {
    card: page.getByTestId('registration-notifications-card'),
    enableToggle: page.getByTestId('registration-notifications-enable'),
    emailChannel: page.getByTestId('registration-notifications-channel-email'),
    whatsappChannel: page.getByTestId('registration-notifications-channel-whatsapp'),
    noServerChannelWarning: page.getByTestId('registration-notifications-no-server-channel'),
    recipientsField,
    // The SAME element. `FormField` forwards its testID to the react-native-web
    // `TextInput`, which renders a real `<input>` carrying that testID — so
    // there is no wrapper to drill through, and a `.locator('input')` inside it
    // would match nothing. Kept as a distinct name because the two readings are
    // different questions: `recipientsField` is measured as a TAP TARGET, and
    // `recipientsInput` is filled and read as a VALUE. Verified against prod:
    // `.fill()` and `toHaveValue()` both operate on it directly.
    recipientsInput: recipientsField,
    destination: page.getByTestId('registration-notifications-destination'),
    noDestination: page.getByTestId('registration-notifications-no-destination'),
    saveButton: page.getByTestId('registration-notifications-save'),
    banner: page.getByTestId('registration-notifications-banner'),
    loading: page.getByTestId('registration-notifications-loading'),
    loadError: page.getByTestId('registration-notifications-error'),
  };
}

/** How long to allow for the SPA to boot and the tenant-level GET to resolve. */
const CARD_READY_TIMEOUT_MS = 45_000;

/** An opened card plus the console capture covering it. */
export interface OpenedCard {
  controls: RegistrationNotificationsCard;
  /**
   * Console capture, ALREADY RESET at the moment the card became visible.
   *
   * Reaching an organizer screen necessarily loads the app unauthenticated
   * first, and the session probe `GET /bff/me` answers 401 by design at that
   * instant. The browser logs that as a console error with no URL in the text,
   * so an allow-pattern broad enough to match it would also swallow a genuine
   * 401 from the card's own GET — precisely the defect worth catching. Reset is
   * the correct tool; an allow-list is not.
   */
  console: ConsoleGuard;
}

/**
 * Log in as the fixture organizer and open the dashboard until the card is on
 * screen, then hand back its controls and a freshly-reset console guard.
 *
 * Fails loudly and specifically if the card resolves to its ERROR state: a
 * 403 from `/admin/registration-notifications` (organizer not the tenant owner)
 * renders an error box, not a missing card, and would otherwise read as an
 * unhelpful "timed out waiting for the card".
 */
export async function openRegistrationNotificationsCard(page: Page): Promise<OpenedCard> {
  const tenant = getKefiFixtureTenant();
  const { webUrl } = getKefiUrls();

  const consoleGuard = attachConsoleGuard(page);

  const login = new KefiLoginPage(page);
  await login.goto();
  await login.signIn({ email: tenant.organizerEmail, password: tenant.organizerPassword });

  await page.goto(`${webUrl}/organizer?event=${encodeURIComponent(tenant.eventExternalId)}`);

  const controls = cardControls(page);

  // Settle on a TERMINAL state — the card, or the card's own error box. Racing
  // them means a 403 reports itself instead of timing out anonymously.
  await expect
    .poll(
      async () => {
        if (await controls.card.isVisible()) return 'card';
        if (await controls.loadError.isVisible()) return 'error';
        return 'pending';
      },
      {
        timeout: CARD_READY_TIMEOUT_MS,
        message:
          'the registration-notifications card reached neither its loaded nor its error state ' +
          `on ${webUrl}/organizer. Either the section did not mount at all, or the tenant-level ` +
          'GET /admin/registration-notifications never settled.',
      },
    )
    .not.toBe('pending');

  if (await controls.loadError.isVisible()) {
    const message = await controls.loadError.innerText();
    throw new Error(
      'the registration-notifications card rendered its ERROR state instead of the editor. ' +
        'The organizer cannot configure notifications at all on this tenant. The card reported: ' +
        `"${message.trim()}". A 403 here means the fixture organizer is not the tenant OWNER, ` +
        'which is who the /admin/registration-notifications endpoint is scoped to.',
    );
  }

  await expect(controls.card, 'the registration-notifications card is on the dashboard').toBeVisible();

  // The card is up; everything the unauthenticated boot logged is now noise.
  consoleGuard.reset();

  return { controls, console: consoleGuard };
}

/**
 * Read the tenant's stored config straight from the BFF, using the browser's
 * own authenticated session.
 *
 * Used to snapshot the baseline before a spec writes, so `afterAll` can put the
 * tenant back. Deliberately goes through `page.request`, which shares the BFF
 * session cookie the UI login just established — no second password grant, and
 * therefore no risk of the concurrent-grant 401s that serial running exists to
 * avoid.
 */
export async function readConfigFromApi(page: Page): Promise<MyRegistrationNotifications> {
  const { webUrl } = getKefiUrls();
  const response = await page.request.get(`${webUrl}/bff/api/kefi/api/v1/admin/registration-notifications`);
  expect(
    response.status(),
    'GET /bff/api/kefi/api/v1/admin/registration-notifications answers 200 for the fixture organizer',
  ).toBe(200);
  return (await response.json()) as MyRegistrationNotifications;
}

/**
 * Write a config straight to the BFF. Restore path only — the specs prove the
 * UI can save; this exists so teardown does not depend on the UI it is testing.
 */
export async function writeConfigViaApi(
  page: Page,
  config: RegistrationNotificationConfig,
): Promise<void> {
  const { webUrl } = getKefiUrls();
  // `Bff.AspNetCore`'s anti-forgery middleware rejects unsafe verbs unless BOTH
  // the `X-BFF-Csrf` header AND a same-origin `Origin` are present. Measured
  // against prod, all three combinations, because the first two look identical:
  //
  //   no header                 -> 403 {"error":"Anti-forgery validation failed."}
  //   X-BFF-Csrf: 1             -> 403 {"error":"Anti-forgery validation failed."}
  //   X-BFF-Csrf: 1 + Origin    -> 200
  //
  // Worth spelling out: the middle case is the trap. Adding the CSRF header
  // alone changes nothing, so a 403 here reads exactly like an authorization
  // denial and invites the conclusion that the organizer lacks permission to
  // save — a false defect report about a feature that works. `page.request`
  // does not go through the app's axios interceptor and sends no Origin of its
  // own, so both must be set by hand. The BROWSER always sends Origin, which is
  // why the card's own save was never affected.
  const response = await page.request.put(
    `${webUrl}/bff/api/kefi/api/v1/admin/registration-notifications`,
    { data: config, headers: { 'X-BFF-Csrf': '1', Origin: webUrl } },
  );
  expect(
    response.status(),
    'PUT /bff/api/kefi/api/v1/admin/registration-notifications accepts the restore write',
  ).toBeLessThan(300);
}
