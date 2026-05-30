/**
 * Poueni forgot/reset-password E2E — the real user round-trip.
 *
 * Reproduces the reported bug ("received the reset email, set a new password,
 * but the new password doesn't log me in") through the SAME surfaces a user
 * touches, in a real browser (so the dashboard login carries the BFF CSRF
 * cookie + Origin that a bare curl lacks — that's why a CLI probe couldn't
 * reproduce it):
 *
 *   1. API   signup (bot mailbox, plus-addressed)            → 202
 *   2. IMAP  read the verify email → GET the verify URL       → tenant Active + KC user enabled
 *   3. BROWSER dashboard /login with the ORIGINAL password    → lands in the app (baseline: login works)
 *   4. API   forgot-password-request                          → 202
 *   5. IMAP  read the reset email → open the reset page        → set a NEW password in the browser
 *   6. BROWSER dashboard /login with the NEW password         → MUST land in the app  ← the reported failure
 *   7. BROWSER dashboard /login with the OLD password         → MUST be rejected (new password really took)
 *
 * Tagged @poueni @auth @critical. Remote-only (prod/staging) — there's no local
 * Poueni stack in the dev loop, and the flow needs real Maddy + Keycloak.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import {
  PoueniMailbox,
  loadPoueniMailboxConfig,
  newPoueniCanaryEmail,
  extractPoueniVerifyUrl,
  extractPoueniResetUrl,
} from '../../helpers/poueni/poueniMailbox.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MAILBOX_TIMEOUT_MS = 90_000;
const MAILBOX_POLL_MS = 2_000;
const OLD_PASSWORD = 'OldPoueniPass-123';
const NEW_PASSWORD = 'NewPoueniPass-456';

const urls = getPoueniUrls();

/** Drive the dashboard login form and report whether it authenticated. */
async function attemptDashboardLogin(page: Page, email: string, password: string): Promise<boolean> {
  // Clear any existing BFF session cookie first — otherwise /login sees a live
  // __Host-bff-poueni session and bounces straight to the dashboard, so we'd
  // never actually exercise the credentials (and a stale session would make a
  // wrong password look like a successful login). This isolation is the whole
  // point: each attempt must be a fresh, unauthenticated credential check.
  await page.context().clearCookies();
  await page.goto(`${urls.dashboardUrl}/login`);
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  // Success = the SPA navigates off /login (router.replace('/')). Failure = it
  // stays on /login and renders the inline error. Race the two so we don't wait
  // the full nav timeout on the (expected) failure case.
  const result = await Promise.race([
    page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 12_000 })
      .then(() => 'ok' as const)
      .catch(() => 'timeout' as const),
    page
      .locator('.form__error')
      .waitFor({ state: 'visible', timeout: 12_000 })
      .then(() => 'error' as const)
      .catch(() => 'timeout' as const),
  ]);
  return result === 'ok';
}

/** Read one plus-addressed email, returning it and expunging it after. */
async function readEmail(to: string, subjectIncludes: string): Promise<{ html: string; text: string; uid: number }> {
  const mailbox = new PoueniMailbox(loadPoueniMailboxConfig(), {
    timeoutMs: MAILBOX_TIMEOUT_MS,
    pollIntervalMs: MAILBOX_POLL_MS,
  });
  const captured = await mailbox.waitForMessageTo(to, { subjectIncludes });
  await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
  return { html: captured.bodyHtml ?? '', text: captured.bodyText, uid: captured.uid };
}

async function signup(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${urls.apiUrl}/v1/public/signup`, {
    data: { email, tenantName: 'E2E Reset Lab', password: OLD_PASSWORD },
  });
  expect(res.status(), 'signup should be accepted').toBe(202);
}

async function requestReset(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${urls.apiUrl}/v1/public/reset-password-request`, {
    data: { email },
  });
  expect(res.status(), 'forgot-password-request should be accepted').toBe(202);
}

test.describe('Poueni forgot/reset password @poueni @auth @password-reset', () => {
  test.skip(!isRemoteTarget(), 'Poueni reset E2E targets prod/staging (real Maddy + Keycloak); no local stack');

  test('reset → new password logs in via the dashboard, old password is rejected @critical', async ({
    page,
    request,
  }) => {
    const email = newPoueniCanaryEmail();
    test.info().annotations.push({ type: 'canaryEmail', description: email });

    // ── 1. signup ───────────────────────────────────────────────────────
    await signup(request, email);

    // ── 2. verify (activates tenant + enables KC user) ──────────────────
    const verifyEmail = await readEmail(email, 'Verify');
    const verifyUrl = extractPoueniVerifyUrl({ uid: 0, subject: 'Verify', to: email, bodyText: verifyEmail.text, bodyHtml: verifyEmail.html });
    expect(verifyUrl, 'verify URL present in signup email').not.toBeNull();
    const verifyRes = await request.get(verifyUrl!);
    expect(verifyRes.status(), 'verify endpoint returns the success page').toBe(200);

    // ── 3. baseline: original password logs in via the dashboard ────────
    const oldLoginBeforeReset = await attemptDashboardLogin(page, email, OLD_PASSWORD);
    expect(oldLoginBeforeReset, 'original password should log in after verify (baseline)').toBe(true);

    // ── 4. forgot-password request ──────────────────────────────────────
    await requestReset(request, email);

    // ── 5. open the reset page in the browser + set a NEW password ──────
    const resetEmail = await readEmail(email, 'Reset');
    const resetUrl = extractPoueniResetUrl({ uid: 0, subject: 'Reset', to: email, bodyText: resetEmail.text, bodyHtml: resetEmail.html });
    expect(resetUrl, 'reset URL present in reset email').not.toBeNull();

    await page.goto(resetUrl!);
    await page.locator('#password').fill(NEW_PASSWORD);
    await page.locator('#confirm').fill(NEW_PASSWORD);
    await page.locator('#submitBtn').click();
    // The reset page hides the form + shows the success status on 200.
    await expect(page.locator('#formStatus')).toHaveAttribute('data-kind', 'success', { timeout: 15_000 });

    // ── 6. THE reported failure: new password must log in ───────────────
    const newLogin = await attemptDashboardLogin(page, email, NEW_PASSWORD);
    expect(newLogin, 'NEW password must log in via the dashboard after reset').toBe(true);

    // ── 6b. stale-session hygiene: visiting /login while ALREADY logged in
    //        must show the login form (LoginPage clears the session on mount),
    //        NOT silently bounce into the dashboard. This is the exact trap
    //        that makes a returning user think "my new password won't log in"
    //        when really an old session was carrying them straight in. We are
    //        authenticated here (step 6 left a live session, cookies intact).
    await page.goto(`${urls.dashboardUrl}/login`);
    await expect(
      page.locator('input[type="email"]'),
      '/login must render the form even with a live session (no stale-session bounce)',
    ).toBeVisible({ timeout: 15_000 });

    // ── 7. old password must now be rejected ────────────────────────────
    const oldLoginAfterReset = await attemptDashboardLogin(page, email, OLD_PASSWORD);
    expect(oldLoginAfterReset, 'OLD password must be rejected after reset').toBe(false);
  });
});
