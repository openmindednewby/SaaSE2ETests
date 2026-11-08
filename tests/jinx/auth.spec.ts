import { expect, test } from '@playwright/test';

import {
  CodeForm,
  confirmDeletion,
  enterCode,
  openLogin,
  otherCode,
  readCode,
  readCodeEmail,
  removeCodeAccount,
  requestDeletion,
  sendCode,
  SESSION_COOKIE,
  sessionCookieLifetimeSeconds,
  signInByCode,
  storedAuthState,
  stubCodeSends,
  stubCodeVerify,
  uniqueCodeEmail,
} from './helpers/code-sign-in';
import { BFF_API, WRITE_HEADERS } from './helpers/live-api';
import { ACCOUNT_TEST_MS } from './helpers/signed-in';
import { postPaced } from './helpers/test-accounts';
import { APP_URL } from './helpers/tracker';

const TOKEN_SHAPE = /eyJ[\w-]+\.[\w-]+|access_token|refresh_token/;
const AUTH_RATE_WINDOW_MS = 60_000;
const MS_PER_SECOND = 1000;

test.use({ serviceWorkers: 'block' });

test('AC-OTP-1 AC-24 email then the emailed six-digit code on one screen, httpOnly session, no token in storage, logout clears it', async ({ page, context }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const email = uniqueCodeEmail();
  await openLogin(page);
  await sendCode(page, email);
  const urlAtCodeStep = page.url();
  const code = await readCode(email);

  const verify = await enterCode(page, code);

  expect(verify.status()).toBe(200);
  expect(urlAtCodeStep).toMatch(/\/login$/);
  await expect(page.getByTestId('logout-button')).toBeVisible();
  await requestDeletion(page);
  try {
    const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
    expect(session?.httpOnly).toBe(true);
    expect(await storedAuthState(page)).not.toMatch(TOKEN_SHAPE);
    expect((await page.request.get(`${APP_URL}/bff/me`)).status()).toBe(200);
    await page.getByTestId('logout-button').click();
    await expect.poll(async () => (await context.cookies()).map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);
    expect((await page.request.get(`${APP_URL}/bff/me`)).status()).toBe(401);
  } finally {
    expect.soft(await confirmDeletion(page, email), `confirm deletion of ${email}`).toBe(200);
  }
});

test('AC-24 anonymous session read, returns 401', async ({ request }) => {
  const url = `${APP_URL}/bff/me`;

  const response = await request.get(url);

  expect(response.status()).toBe(401);
});

test('AC-24 anonymous account read through the BFF, returns 401', async ({ request }) => {
  const url = `${BFF_API}/me/patterns`;

  const response = await request.get(url);

  expect(response.status()).toBe(401);
});

test('AC-OTP-4 a wrong code, says it did not match, clears the field, no session cookie, no token in storage', async ({ page, context }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const email = uniqueCodeEmail();
  const message = 'That code did not match. Try again or send a new one.';
  await openLogin(page);
  await sendCode(page, email);
  const wrong = otherCode(await readCode(email));

  const verify = await enterCode(page, wrong);

  expect(verify.status()).toBe(401);
  await expect(page.getByTestId(CodeForm.error)).toHaveText(message);
  await expect(page.getByTestId(CodeForm.code)).toHaveValue('');
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);
  expect(await storedAuthState(page)).not.toMatch(TOKEN_SHAPE);
});

test('AC-OTP-4 a code past its lifetime, says it has expired', async ({ page }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const email = uniqueCodeEmail();
  const message = 'That code has expired. Send a new one.';
  await page.clock.install();
  await openLogin(page);
  const sent = await sendCode(page, email);
  const { expiresIn } = (await sent.json()) as { expiresIn: number };
  const wrong = otherCode(await readCode(email));
  await page.clock.fastForward((expiresIn + 1) * MS_PER_SECOND);

  const verify = await enterCode(page, wrong);

  expect(verify.status()).toBe(401);
  await expect(page.getByTestId(CodeForm.error)).toHaveText(message);
});

test('AC-OTP-4 resend during its 30 second cooldown is disabled, afterwards it sends again and says so', async ({ page }) => {
  const cooldownSeconds = 30;
  const email = 'e2e-bot+jinx-otp-cooldown@dloizides.com';
  const sends = await stubCodeSends(page);
  await page.clock.install();
  await openLogin(page);
  await page.getByTestId(CodeForm.email).fill(email);
  await page.getByTestId(CodeForm.send).click();
  const resend = page.getByTestId(CodeForm.resend);
  await expect(resend).toHaveAttribute('aria-disabled', 'true');
  await expect(resend).toHaveText(/^Send a new code in \d+s$/);

  await page.clock.fastForward((cooldownSeconds + 1) * MS_PER_SECOND);
  await expect(resend).not.toHaveAttribute('aria-disabled', 'true');
  await resend.click();

  await expect(page.getByTestId(CodeForm.notice)).toHaveText('We sent a new code.');
  expect(sends).toHaveLength(2);
});

test('AC-OTP-4 after five wrong codes the right code is refused, returns 401', async ({ request }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const identifier = uniqueCodeEmail();
  const maxAttempts = 5;
  const headers = WRITE_HEADERS;
  const verifyWith = (otp: string) => postPaced(request, `${APP_URL}/bff/otp/verify`, { headers, data: { username: identifier, otp } }, AUTH_RATE_WINDOW_MS);
  const sent = await postPaced(request, `${APP_URL}/bff/otp/request`, { headers, data: { identifier } }, AUTH_RATE_WINDOW_MS);
  expect(sent.status()).toBe(200);
  const code = await readCode(identifier);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    expect((await verifyWith(otherCode(code))).status(), `wrong code ${String(attempt)}`).toBe(401);
  }

  const withRightCode = await verifyWith(code);

  expect(withRightCode.status()).toBe(401);
});

test('AC-OTP-4 a throttled verify, says too many attempts and keeps the typed code', async ({ page }) => {
  const email = 'e2e-bot+jinx-otp-throttled@dloizides.com';
  const code = '123456';
  await stubCodeSends(page);
  await stubCodeVerify(page, 429);
  await openLogin(page);
  await page.getByTestId(CodeForm.email).fill(email);
  await page.getByTestId(CodeForm.send).click();
  await page.getByTestId(CodeForm.code).fill(code);

  await page.getByTestId(CodeForm.verify).click();

  await expect(page.getByTestId(CodeForm.error)).toHaveText('Too many attempts. Wait a minute and try again.');
  await expect(page.getByTestId(CodeForm.code)).toHaveValue(code);
});

test('AC-OTP-5 sign-in sets a five-year session cookie, a browser reopened with the saved state stays signed in', async ({ page, browser }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const fiveYearsSeconds = 157_680_000;
  const toleranceSeconds = 60;
  const account = await signInByCode(page);
  const signedInUrl = page.url();
  try {
    const lifetime = sessionCookieLifetimeSeconds(await account.verify.headerValues('set-cookie'));
    const reopened = await browser.newContext({ storageState: await page.context().storageState(), serviceWorkers: 'block' });

    const reopenedPage = await reopened.newPage();
    await reopenedPage.goto(signedInUrl);

    await expect(reopenedPage.getByTestId('logout-button')).toBeVisible();
    expect((await reopenedPage.request.get(`${APP_URL}/bff/me`)).status()).toBe(200);
    expect(lifetime).toBeGreaterThanOrEqual(fiveYearsSeconds - toleranceSeconds);
    await reopened.close();
  } finally {
    await removeCodeAccount(page, account.email);
  }
});

test('AC-OTP-7 Enter in the email field sends and Enter in the code field verifies, with the client write shape', async ({ page }) => {
  const email = 'e2e-bot+jinx-otp-enter@dloizides.com';
  const code = '654321';
  const sends = await stubCodeSends(page);
  const verifies = await stubCodeVerify(page, 401);
  await openLogin(page);
  await page.getByTestId(CodeForm.email).fill(email);
  await page.getByTestId(CodeForm.email).press('Enter');
  await expect(page.getByTestId(CodeForm.code)).toBeVisible();
  await page.getByTestId(CodeForm.code).fill(code);

  await page.getByTestId(CodeForm.code).press('Enter');

  await expect(page.getByTestId(CodeForm.error)).toBeVisible();
  expect(sends[0]).toMatchObject({ identifier: email });
  expect(verifies[0]).toMatchObject({ username: email, otp: code });
});

test('AC-OTP-7 Send code and Sign in show the shared loading state while their request is in flight', async ({ page }) => {
  const email = 'e2e-bot+jinx-otp-loading@dloizides.com';
  const code = '111222';
  let releaseSend = (): void => undefined;
  let releaseVerify = (): void => undefined;
  const sendHeld = new Promise<void>((resolve) => { releaseSend = resolve; });
  const verifyHeld = new Promise<void>((resolve) => { releaseVerify = resolve; });
  await page.route('**/bff/otp/request', async (route) => {
    await sendHeld;
    await route.fulfill({ status: 200, json: { success: true, expiresIn: 300, code: null } });
  });
  await page.route('**/bff/otp/verify', async (route) => {
    await verifyHeld;
    await route.fulfill({ status: 401, json: {} });
  });
  await openLogin(page);
  await page.getByTestId(CodeForm.email).fill(email);

  await page.getByTestId(CodeForm.send).click();

  await expect(page.getByTestId(CodeForm.send)).toHaveAttribute('aria-label', 'Sending your code');
  await expect(page.getByTestId(CodeForm.send).getByRole('progressbar')).toBeVisible();
  releaseSend();
  await page.getByTestId(CodeForm.code).fill(code);
  await page.getByTestId(CodeForm.verify).click();
  await expect(page.getByTestId(CodeForm.verify)).toHaveAttribute('aria-label', 'Signing you in');
  await expect(page.getByTestId(CodeForm.verify).getByRole('progressbar')).toBeVisible();
  releaseVerify();
  await expect(page.getByTestId(CodeForm.error)).toBeVisible();
});

test('AC-OTP-8 a per-run test account signs in through the shared code form with a code read from the bot mailbox, session resolves', async ({ page }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  await openLogin(page);
  await expect(page.getByTestId(CodeForm.form)).toBeVisible();

  const account = await signInByCode(page);

  try {
    expect((await page.request.get(`${APP_URL}/bff/me`)).status()).toBe(200);
  } finally {
    await removeCodeAccount(page, account.email);
  }
});

test('AC-OTP-9 the code email to a new address, says the code creates an account', async ({ page }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const email = uniqueCodeEmail();
  const note = 'If you do not have an account yet, entering this code creates one.';
  await openLogin(page);
  await sendCode(page, email);

  const body = await readCodeEmail(email);

  expect(body).toContain(note);
});
