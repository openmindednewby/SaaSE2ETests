import { setTimeout as delay } from 'node:timers/promises';

import { devices, expect, test } from '@playwright/test';

import {
  CodeForm,
  confirmDeletion,
  DeleteForm,
  enterCode,
  openLogin,
  OTP_SEND_COOLDOWN_MS,
  readCode,
  removeCodeAccount,
  sendCode,
  SESSION_COOKIE,
  signInByCode,
  submitDeletionForm,
  uniqueCodeEmail,
} from './helpers/code-sign-in';
import { ACCOUNT_TEST_MS } from './helpers/signed-in';
import { APP_URL } from './helpers/tracker';

const { defaultBrowserType: _mobileEngine, ...MOBILE } = devices['Galaxy S5'];
const { defaultBrowserType: _desktopEngine, ...DESKTOP } = devices['Desktop Chrome'];
const DESKTOP_1280 = { ...DESKTOP, viewport: { width: 1280, height: 800 } };
const PASSWORD_FIELD = 'input[type="password"]';
const DELETE_REQUEST_ROUTE = '**/bff/account/delete-request';

test.use({ serviceWorkers: 'block' });

test('AC-OTP-3 /register, redirects to the code sign-in with no password field', async ({ page }) => {
  const registerUrl = `${APP_URL}/register`;

  await page.goto(registerUrl);

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId(CodeForm.email)).toBeVisible();
  await expect(page.locator(PASSWORD_FIELD)).toHaveCount(0);
});

for (const path of ['/login', '/verify-email']) {
  test(`AC-OTP-3 ${path}, has no password field and no reset link`, async ({ page }) => {
    const resetLink = page.getByRole('link', { name: /forgot|reset/i });

    await page.goto(`${APP_URL}${path}`);

    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.locator(PASSWORD_FIELD)).toHaveCount(0);
    await expect(resetLink).toHaveCount(0);
  });
}

test('AC-OTP-3 the BFF config, offers code sign-in and no password method', async ({ request }) => {
  const url = `${APP_URL}/bff/config`;

  const response = await request.get(url);

  const { methods } = (await response.json()) as { methods: string[] };
  expect(methods).toContain('otp');
  expect(methods).not.toContain('password');
});

test('AC-OTP-6 a stale login at delete, goes to a new code and back to delete, where the delete is accepted', async ({ page, context }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const staleReply = { status: 403, json: { code: 'RECENT_AUTHENTICATION_REQUIRED' } };
  let stale = true;
  await page.route(DELETE_REQUEST_ROUTE, async (route) => {
    if (!stale) {
      await route.continue();
      return;
    }
    stale = false;
    await route.fulfill(staleReply);
  });
  const { email } = await signInByCode(page);
  await page.goto(`${APP_URL}/delete-account`);

  await page.getByTestId(DeleteForm.submit).click();

  await expect(page).toHaveURL(/\/login\?.*delete-account/);
  await expect.poll(async () => (await context.cookies()).map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);
  await delay(OTP_SEND_COOLDOWN_MS);
  await sendCode(page, email);
  const verify = await enterCode(page, await readCode(email));
  expect(verify.status()).toBe(200);
  await expect(page).toHaveURL(/\/delete-account/);
  await submitDeletionForm(page);
  await expect(page.getByTestId(DeleteForm.checkEmail)).toBeVisible();
  expect(await confirmDeletion(page, email)).toBe(200);
});

for (const [size, device] of [['360x640', MOBILE], ['1280x800', DESKTOP_1280]] as const) {
  test.describe(`Sign-up journey at ${size}`, () => {
    test.use(device);

    test(`AC-OTP-2 at ${size} email is the only field and the first right code creates the account`, async ({ page }) => {
      test.setTimeout(ACCOUNT_TEST_MS);
      const email = uniqueCodeEmail();
      await openLogin(page);
      const fields = page.getByTestId(CodeForm.form).locator(`input:not([data-testid="${CodeForm.honeypot}"]), textarea, select`);
      await expect(fields).toHaveCount(1);
      await sendCode(page, email);

      const verify = await enterCode(page, await readCode(email));

      expect(verify.status()).toBe(200);
      try {
        const me = (await (await page.request.get(`${APP_URL}/bff/me`)).json()) as { user?: { email?: string } };
        expect(me.user?.email).toBe(email);
      } finally {
        await removeCodeAccount(page, email);
      }
    });

    test(`AC-OTP-6 at ${size} a fresh login deletes through the form with no password, the emailed link confirms it`, async ({ page }) => {
      test.setTimeout(ACCOUNT_TEST_MS);
      const { email } = await signInByCode(page);
      await page.goto(`${APP_URL}/delete-account`);
      await expect(page.locator(PASSWORD_FIELD)).toHaveCount(0);

      await submitDeletionForm(page);

      await expect(page.getByTestId(DeleteForm.checkEmail)).toBeVisible();
      expect(await confirmDeletion(page, email)).toBe(200);
    });
  });
}
