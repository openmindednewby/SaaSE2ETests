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
import { setTimeout as delay } from 'node:timers/promises';

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

/**
 * Drive the login expecting SUCCESS, polling through the per-IP BffAuth rate
 * limiter (5/60s). When the whole poueni suite runs back-to-back from one canary
 * pod the limiter 429s the form submit (it just stays on /login →
 * attemptDashboardLogin returns false). Wait out the 60s window and retry, up to
 * a budget. Only the expect-success calls use this — the rejection check keeps
 * the single-shot form so a genuinely-wrong password still fails fast.
 */
const RATE_LIMIT_WINDOW_MS = 15_000;
const LOGIN_SUCCESS_BUDGET_MS = 120_000;
async function loginExpectingSuccess(page: Page, email: string, password: string): Promise<void> {
  const deadline = Date.now() + LOGIN_SUCCESS_BUDGET_MS;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    if (await attemptDashboardLogin(page, email, password)) return;
    // Deliberate wall-clock pause to let the BFF per-IP rate-limit window reset
    // before retrying — a Node timer (not page.waitForTimeout, which the
    // no-wait-for-timeout lint rule forbids for DOM-state waits).
    await delay(RATE_LIMIT_WINDOW_MS);
  }
  throw new Error(`dashboard login expected to succeed did not within the rate-limit budget (${attempts} attempts)`);
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
    await loginExpectingSuccess(page, email, OLD_PASSWORD);

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
    await loginExpectingSuccess(page, email, NEW_PASSWORD);

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

  // Regression guard for the "I'm not receiving the reset email" report
  // (2026-05-30): the most common real cause is requesting a reset for an
  // address that isn't a registered active tenant — a mistype, or an email the
  // user never actually signed up with. The endpoint is anti-enumeration, so it
  // ALWAYS returns 202 and the marketing page ALWAYS shows the same "if it
  // exists, a link is on its way" success — but NO email is sent. This test
  // pins that contract: unknown email → 202, success copy shown, and crucially
  // NO reset email lands at that address within a real polling window. If a
  // future change ever leaks an email (or an error) for unknown addresses, or
  // breaks the success-copy UX, this fails.
  test('forgot-password for an UNREGISTERED email: 202 + success copy, but no email sent (anti-enum) @critical', async ({
    page,
    request,
  }) => {
    // A guaranteed-unregistered plus-address on the bot mailbox — same inbox we
    // can poll, so "no email arrives" is a real assertion, not a blind wait.
    const unknownEmail = newPoueniCanaryEmail();
    test.info().annotations.push({ type: 'unknownEmail', description: unknownEmail });

    // API: the endpoint accepts it (anti-enumeration — never reveals it's unknown).
    const res = await request.post(`${urls.apiUrl}/v1/public/reset-password-request`, {
      data: { email: unknownEmail },
    });
    expect(res.status(), 'unknown-email request still returns 202').toBe(202);

    // UI: the marketing forgot-password form shows the same generic success.
    await page.goto(`${urls.marketingUrl}/forgot-password`);
    await page.locator('#email').fill(unknownEmail);
    await page.locator('#submitBtn').click();
    await expect(page.locator('#formStatus')).toHaveAttribute('data-kind', 'success', {
      timeout: 15_000,
    });

    // No reset email may land for an unregistered address. Poll the shared bot
    // mailbox filtered to this plus-address for a real window; expect a timeout.
    const mailbox = new PoueniMailbox(loadPoueniMailboxConfig(), {
      timeoutMs: 25_000,
      pollIntervalMs: 2_000,
    });
    let received = false;
    try {
      await mailbox.waitForMessageTo(unknownEmail, { subjectIncludes: 'Reset' });
      received = true;
    } catch {
      received = false; // expected: nothing arrives for an unknown account
    }
    expect(received, 'NO reset email should be sent for an unregistered email').toBe(false);
  });

  // The "Resend email" action on the success state (added after the "not
  // receiving it" report): after a successful request, the page reveals a
  // Resend button that re-fires WITHOUT retyping the address, and a "Use a
  // different email" button that restores the form. This drives a real
  // registered canary so the resend actually delivers a SECOND email.
  test('forgot-password success state offers Resend (re-delivers) + Use-a-different-email @critical', async ({
    page,
    request,
  }) => {
    // Need a real active tenant so the resend genuinely sends. Signup + verify.
    const email = newPoueniCanaryEmail();
    test.info().annotations.push({ type: 'canaryEmail', description: email });
    await signup(request, email);
    const verifyEmail = await readEmail(email, 'Verify');
    const verifyUrl = extractPoueniVerifyUrl({ uid: 0, subject: 'Verify', to: email, bodyText: verifyEmail.text, bodyHtml: verifyEmail.html });
    expect(verifyUrl, 'verify URL present').not.toBeNull();
    expect((await request.get(verifyUrl!)).status(), 'verify ok').toBe(200);

    // Request the reset through the marketing form → success state appears.
    await page.goto(`${urls.marketingUrl}/forgot-password`);
    await page.locator('#email').fill(email);
    await page.locator('#submitBtn').click();
    await expect(page.locator('#formStatus')).toHaveAttribute('data-kind', 'success', { timeout: 15_000 });
    // Drain the first reset email so the post-resend poll can't match it.
    await readEmail(email, 'Reset');

    // The Resend + different-email actions are now revealed.
    await expect(page.locator('#resendBtn'), 'Resend button visible on success').toBeVisible();
    await expect(page.locator('#differentBtn'), 'Use-a-different-email button visible').toBeVisible();

    // Click Resend (no retype) → a SECOND reset email must arrive.
    await page.locator('#resendBtn').click();
    await expect(page.locator('#resendStatus')).toHaveAttribute('data-kind', 'success', { timeout: 15_000 });
    const second = await readEmail(email, 'Reset');
    expect(second.html || second.text, 'resend delivers a second reset email').toContain('reset-password?token=');

    // "Use a different email" restores the form for a fresh address.
    await page.locator('#differentBtn').click();
    await expect(page.locator('#email'), 'form restored after Use-a-different-email').toBeVisible();
    await expect(page.locator('#email')).toHaveValue('');
  });
});
