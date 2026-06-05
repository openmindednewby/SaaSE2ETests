/**
 * The email-OTP login E2E test (unified-login parity #172), split out of
 * `login-methods-suite.ts` to keep that file within the max-file-lines budget.
 * Registered into the suite's `describe` block via {@link defineOtpLoginTest},
 * so it inherits the suite's remote-only skip.
 *
 * This is the only login-methods test that completes a REAL round-trip through
 * the realm's `Direct Grant - OTP or Password` flow + the
 * `otp-direct-grant-authenticator` SPI — the leg that #169 bound but never
 * exercised. It proves the whole chain for onlinemenu / questioner:
 *   1. UI: the OTP tab + request form render (`/bff/config` advertises `otp`).
 *   2. `POST /bff/otp/request` → BFF attaches `X-Realm` → TenantService mints a
 *      code and emails it (the BFF proxy + realm-aware send path).
 *   3. The code is read from the shared bot mailbox over IMAP (no env exposes
 *      the dev-mode code — tenant-api runs as Production on both clusters).
 *   4. `POST /bff/otp/verify` → KC direct grant → the SPI validates the code
 *      via TenantService → a real session cookie is minted.
 *
 * The actor is the seeded `otp-bot` realm user, whose KC email is a
 * plus-addressed alias of the shared bot mailbox (`e2e-kefi-bot+otp-…`), so the
 * emailed code lands in an inbox the test can poll. Seeded by
 * `keycloak-seed-test-users` from `realms.config.json`.
 *
 * API-level on the request/verify legs (not UI-driven) so it shares the
 * device-PIN test's rate-limit-aware helpers and reads the code from one minted
 * email — driving the UI would mint a second code the test can't observe.
 */
import { test, expect } from '@playwright/test';

import {
  bffPostThroughRateLimit,
  registerCookieBannerHandler,
  requireCookie,
  HTTP_OK,
} from './bff-auth-api.js';
import {
  SharedBotMailbox,
  loadSharedBotMailboxConfig,
  type CapturedEmail,
} from './sharedMailbox.js';

/** The OTP email subject TenantService sends (see SendOtpHandler). */
const OTP_EMAIL_SUBJECT = 'Your Verification Code';
/** The seeded OTP actor's KC username — its `/bff/me` preferred_username. */
const OTP_USERNAME = 'otp-bot';
const NAV_TIMEOUT_MS = 30_000;
const MAILBOX_TIMEOUT_MS = 90_000;

/** Per-product inputs the OTP test needs beyond the base suite config. */
export interface OtpLoginTestConfig {
  /** Human name used in the test title, e.g. "Katalogos". */
  product: string;
  /** The BFF session cookie name, e.g. `__Host-bff-katalogos`. */
  sessionCookie: string;
  /** The app's testIdPrefix — the OTP tab/form testIDs derive from it. */
  testIdPrefix: string;
  /**
   * The plus-address tag identifying this product's seeded OTP user, e.g.
   * `otp-katalogos`. The actor email is `<bot-local>+<tag>@<bot-domain>`,
   * matching the `otp-bot` user's KC email in `realms.config.json`.
   */
  otpEmailTag: string;
}

/** Build the seeded OTP actor's email by plus-addressing the bot mailbox. */
function otpActorEmail(botUser: string, tag: string): string {
  const [local, domain] = botUser.split('@');
  return `${local}+${tag}@${domain}`;
}

/** Pull the 6-digit code out of the OTP email body. */
function extractOtpCode(email: CapturedEmail): string | null {
  const body = email.bodyHtml ?? email.bodyText;
  const match = body.match(/\b(\d{6})\b/);
  return match?.[1] ?? null;
}

/** Register the email-OTP login round-trip test. */
export function defineOtpLoginTest(config: OtpLoginTestConfig): void {
  const otpTabTestId = `${config.testIdPrefix}-login-tab-otp`;
  const otpEmailInputTestId = `${config.testIdPrefix}-auth-otp-email`;

  test('email OTP: request a code, receive it by email, verify, signed in', async ({
    page,
    baseURL,
  }) => {
    test.skip(
      !process.env.E2E_KEFI_MAILBOX_HOST
        || !process.env.E2E_KEFI_MAILBOX_USER
        || !process.env.E2E_KEFI_MAILBOX_PASSWORD,
      'shared bot mailbox (E2E_KEFI_MAILBOX_*) not configured in the target .env — skipping OTP login',
    );

    const appUrl = baseURL!;
    const mailboxConfig = loadSharedBotMailboxConfig();
    const otpEmail = otpActorEmail(mailboxConfig.user, config.otpEmailTag);
    await registerCookieBannerHandler(page);

    // ── 1. The OTP tab + request form render (BFF advertises `otp`) ─────────
    await page.goto(`${appUrl}/login`);
    await expect(
      page.getByTestId(otpTabTestId),
      'the OTP method tab renders (BFF advertises the otp method)',
    ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await page.getByTestId(otpTabTestId).click();
    await expect(
      page.getByTestId(otpEmailInputTestId),
      'the OTP email-request form renders when the tab is active',
    ).toBeVisible({ timeout: NAV_TIMEOUT_MS });

    // ── 2. Request a code through the BFF → TenantService (realm-aware) ──────
    // send-otp is anti-enumeration: always 200. A non-2xx is a real failure
    // (e.g. the BFF lacks the tenants proxy, or otp isn't enabled → 501).
    const requestResp = await bffPostThroughRateLimit(page.request, appUrl, '/bff/otp/request', {
      identifier: otpEmail,
    });
    expect(
      requestResp.status(),
      'POST /bff/otp/request is accepted (anti-enumeration 200 through the realm)',
    ).toBe(HTTP_OK);

    // ── 3. Read the emailed code from the shared bot mailbox over IMAP ───────
    const mailbox = new SharedBotMailbox(mailboxConfig, { timeoutMs: MAILBOX_TIMEOUT_MS });
    const email = await mailbox.waitForMessageTo(otpEmail, {
      subjectIncludes: OTP_EMAIL_SUBJECT,
    });
    const code = extractOtpCode(email);
    expect(code, `a 6-digit OTP code is present in "${email.subject}"`).not.toBeNull();

    // ── 4. Verify the code → KC direct grant → SPI → a real session ─────────
    const verifyResp = await bffPostThroughRateLimit(page.request, appUrl, '/bff/otp/verify', {
      username: otpEmail,
      otp: code,
    });
    expect(
      verifyResp.status(),
      'POST /bff/otp/verify mints a session (the realm OTP authenticator completes)',
    ).toBe(HTTP_OK);

    // ── 5. The OTP-minted session is real and belongs to the OTP actor ──────
    const cookies = await page.context().cookies();
    requireCookie(cookies, config.sessionCookie);
    const meResponse = await page.request.get(`${appUrl}/bff/me`);
    expect(meResponse.status(), 'OTP-minted session resolves /bff/me').toBe(HTTP_OK);
    const me = (await meResponse.json()) as { user?: { preferred_username?: string } };
    expect(
      me.user?.preferred_username?.toLowerCase(),
      'the OTP session belongs to the seeded otp-bot user',
    ).toBe(OTP_USERNAME);

    // ── 6. Mailbox hygiene — leave the shared inbox clean for the next run ───
    await mailbox.expungeMessages([email.uid]).catch(() => undefined);
  });
}
