/**
 * Kefi interactive email-OTP login E2E (login-method parity follow-up).
 *
 * Closes the coverage gap where kefi advertised `otp` but only the MAGIC-LINK
 * OTP path (`/bff/verify-and-login`, exercised by the signup→verify specs) was
 * tested. This covers the INTERACTIVE request→verify flow end to end:
 *   - the `kefi-login-tab-otp` UI tab + the OtpForm email step render,
 *   - `POST /bff/otp/request` → TenantService `send-otp` on the KEFI realm
 *     (X-Realm=kefi; kefi is KefiService-managed, so this proves TenantService
 *     can mint+email for it — the distinct half magic-link never exercises),
 *   - the emailed code is read from the shared bot mailbox over IMAP,
 *   - `POST /bff/otp/verify` → KC direct grant → session as the seeded otp-bot.
 *
 * Reuses the shared `defineOtpLoginTest` (same as katalogos/erevna); baseURL is
 * the kefi web host (KEFI_WEB_URL per E2E_TARGET). Seeded kefi-realm `otp-bot`
 * (email = bot-mailbox plus-alias). Runs on staging + prod; local is skipped.
 */
import { test } from '@playwright/test';

import { defineOtpLoginTest } from '../../helpers/login-methods-otp.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Serial — shares the per-IP BffAuth rate limiter + the one bot mailbox.
test.describe.configure({ mode: 'serial' });

test.describe('Kefi email-OTP login (bff-kefi + kefi realm)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi OTP E2E targets staging+prod; no local kefi BFF in the dev loop',
  );

  defineOtpLoginTest({
    product: 'Kefi',
    sessionCookie: '__Host-bff-kefi',
    testIdPrefix: 'kefi',
    otpEmailTag: 'otp-kefi',
  });
});
