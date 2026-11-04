import { randomBytes } from 'node:crypto';

import { createTestAccount, type TestAccount } from '@dloizides/e2e-helpers';
import { devices, expect, test } from '@playwright/test';

import {
  expectSignInGone,
  expungeLeftoverMail,
  formContext,
  hookedContext,
  isRegister,
  isVerify,
  newestMailbox,
  pacedContext,
  signIn,
  type FormJourneyProbes,
  type RegisterBody,
} from './helpers/test-accounts';
import { APP_URL } from './helpers/tracker';

const { defaultBrowserType: _mobileEngine, ...MOBILE } = devices['Galaxy S5'];
const { defaultBrowserType: _desktopEngine, ...DESKTOP } = devices['Desktop Chrome'];
const DESKTOP_1280 = { ...DESKTOP, viewport: { width: 1280, height: 800 } };

async function disposeAndExpectGone(account: TestAccount, password = account.password): Promise<void> {
  const disposed = await account.dispose();
  expect(disposed.confirmStatus).toBe(200);
  await expectSignInGone(account.email, password);
  await expungeLeftoverMail(account.email);
}

test('AC-HOST-3 a verified account is deleted through the emailed link, sign-in returns 401', async () => {
  const account = await createTestAccount({ app: 'jinx', baseUrl: APP_URL, newContext: pacedContext() });
  expect(account.tenantId).not.toBe('');

  const disposed = await account.dispose();

  expect(disposed.confirmStatus).toBe(200);
  await expectSignInGone(account.email, account.password);
});

test('AC-HOST-8 an unverified account gets no password grant, returns 401 until the link is used', async () => {
  let beforeVerify = 0;
  let body: RegisterBody | undefined;
  const account = await createTestAccount({
    app: 'jinx',
    baseUrl: APP_URL,
    newContext: hookedContext(async (url, options, send) => {
      if (isRegister(url)) body = options.data as RegisterBody;
      if (isVerify(url) && body) beforeVerify = await signIn(body.email, body.password);
      return send();
    }),
  });

  const afterVerify = await signIn(account.email, account.password);

  expect(beforeVerify).toBe(401);
  expect(afterVerify).toBe(200);
  await disposeAndExpectGone(account);
});

test('AC-HOST-7 a duplicate signup asks for a new password at the link, old password returns 401, new returns 200', async () => {
  const newPassword = `E2e-${randomBytes(6).toString('hex')}-Bb2`;
  let firstVerifyStatus = 0;
  let firstVerifyCode = '';
  const account = await createTestAccount({
    app: 'jinx',
    baseUrl: APP_URL,
    mailbox: newestMailbox(),
    newContext: hookedContext(async (url, options, send) => {
      if (isRegister(url)) {
        const first = await send();
        expect(first.status()).toBe(202);
        return send({ ...options, headers: { 'Idempotency-Key': randomBytes(6).toString('hex') } });
      }
      if (!isVerify(url)) return send();
      const asked = await send();
      firstVerifyStatus = asked.status();
      firstVerifyCode = ((await asked.json().catch(() => ({}))) as { code?: string; errorCode?: string }).errorCode ?? '';
      return send({ ...options, data: { ...(options.data as object), newPassword } });
    }),
  });

  const withOldPassword = await signIn(account.email, account.password);
  const withNewPassword = await signIn(account.email, newPassword);

  expect(firstVerifyStatus).toBe(409);
  expect(firstVerifyCode).toBe('NEW_PASSWORD_REQUIRED');
  expect(withOldPassword).toBe(401);
  expect(withNewPassword).toBe(200);
  await disposeAndExpectGone(account, newPassword);
});

test('AC-HOST-3 a tenant with a second user stays after one is deleted, its other user still signs in', () => {
  test.skip(true, 'No public way to add a second user to a tenant: /users and /team/invite need a bearer token the BFF never proxies');
});

test('Journey step 4 a second identical submit on a verified account creates no second user, one delete removes the only login', async () => {
  let body: RegisterBody | undefined;
  const account = await createTestAccount({
    app: 'jinx',
    baseUrl: APP_URL,
    newContext: hookedContext(async (url, options, send) => {
      if (isRegister(url)) body = options.data as RegisterBody;
      return send();
    }),
  });
  const original = await (await account.context.get('/bff/me')).json();

  const again = await account.context.post('/bff/register', {
    headers: { 'Idempotency-Key': randomBytes(6).toString('hex') },
    data: { ...body, website: '', formElapsedMs: 8000 },
  });

  expect(again.status()).toBe(202);
  await expect
    .poll(async () => (await (await account.context.get('/bff/me')).json()).tenantId)
    .toBe(original.tenantId);
  expect(await signIn(account.email, account.password)).toBe(200);
  await disposeAndExpectGone(account);
});

for (const [size, device] of [['360x640', MOBILE], ['1280x800', DESKTOP_1280]] as const) {
  test.describe(`Acceptance journey at ${size}`, () => {
    test.use(device);

    test(`Journey at ${size} the form registers with no session, the link signs in with a tenant, delete returns 401`, async ({ page }) => {
      const probes: FormJourneyProbes = {};
      const account = await createTestAccount({ app: 'jinx', baseUrl: APP_URL, newContext: formContext(page, probes) });

      const me = await page.request.get('/bff/me');

      expect(probes.meBeforeVerify).toBe(401);
      expect(me.status()).toBe(200);
      expect((await me.json()).tenantId).toBe(account.tenantId);
      expect(account.tenantId).not.toBe('');
      await disposeAndExpectGone(account);
    });
  });
}
