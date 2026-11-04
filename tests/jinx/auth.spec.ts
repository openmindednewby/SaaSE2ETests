import { expect, test } from '@playwright/test';

import { BFF_API } from './helpers/live-api';
import { ACCOUNT_TEST_MS, newJinxAccount, pressEnterForLogin, removeAccount } from './helpers/signed-in';
import { APP_URL } from './helpers/tracker';

const SESSION_COOKIE = '__Host-bff-jinx';
const TOKEN_SHAPE = /eyJ[\w-]+\.[\w-]+|access_token|refresh_token/;

test('AC-24 Realm jinx, Sign in, sign out, Session cookie httpOnly, no tokens in the SPA, logout clears it', async ({ page, context }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const account = await newJinxAccount();
  try {
    await page.goto(`${APP_URL}/login`);
    await page.locator('input').first().fill(account.email);
    await page.locator('input[type="password"]').fill(account.password);

    const login = await pressEnterForLogin(page);

    expect(login.status()).toBe(200);
    const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
    expect(session?.httpOnly).toBe(true);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toMatch(TOKEN_SHAPE);
    expect((await page.request.get(`${APP_URL}/bff/me`)).status()).toBe(200);
    await page.getByTestId('logout-button').click();
    await expect.poll(async () => (await context.cookies()).map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);
    expect((await page.request.get(`${APP_URL}/bff/me`)).status()).toBe(401);
  } finally {
    await removeAccount(account);
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

test('AC-24 wrong password, Enter, 401 with no session cookie and no token in storage', async ({ page, context }) => {
  const email = `e2e-no-such-user-${Date.now()}@example.com`;
  await page.goto(`${APP_URL}/login`);
  await page.locator('input').first().fill(email);
  await page.locator('input[type="password"]').fill('wrong-password-e2e');
  const answer = page.waitForResponse((response) => new URL(response.url()).pathname === '/bff/login');

  await page.locator('input[type="password"]').press('Enter');

  expect((await answer).status()).toBe(401);
  const cookieNames = (await context.cookies()).map((cookie) => cookie.name);
  expect(cookieNames).not.toContain(SESSION_COOKIE);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(TOKEN_SHAPE);
});
