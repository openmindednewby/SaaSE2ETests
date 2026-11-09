import { expect, test } from '@playwright/test';

import { CodeForm, openLogin, sendCode, stubCodeSends, stubCodeVerify } from './helpers/code-sign-in';

const WRONG_CODE_MESSAGE = 'That code did not match. Try again or send a new one.';

test.use({ serviceWorkers: 'block' });

test('AC-OTP-11 a pasted six-digit code with no button press, verifies once with the client write shape', async ({ page }) => {
  const email = 'e2e-bot+jinx-otp-paste@dloizides.com';
  const code = '246810';
  await stubCodeSends(page);
  const verifies = await stubCodeVerify(page, 401);
  await openLogin(page);
  await sendCode(page, email);
  await page.getByTestId(CodeForm.code).focus();

  await page.keyboard.insertText(code);

  await expect(page.getByTestId(CodeForm.error)).toBeVisible();
  expect(verifies).toEqual([expect.objectContaining({ username: email, otp: code })]);
});

test('AC-OTP-11 a wrong code entered in full, shows the normal error and verify count stays 1', async ({ page }) => {
  const email = 'e2e-bot+jinx-otp-wrong@dloizides.com';
  const wrongCode = '135790';
  await stubCodeSends(page);
  const verifies = await stubCodeVerify(page, 401);
  await openLogin(page);
  await sendCode(page, email);

  await page.getByTestId(CodeForm.code).fill(wrongCode);

  await expect(page.getByTestId(CodeForm.error)).toHaveText(WRONG_CODE_MESSAGE);
  await expect(page.getByTestId(CodeForm.code)).toHaveValue('');
  expect(verifies).toHaveLength(1);
});

test('AC-OTP-11 a different code typed digit by digit after a wrong one, verifies again and nothing else was sent', async ({ page }) => {
  const email = 'e2e-bot+jinx-otp-retry@dloizides.com';
  const wrongCode = '135790';
  const differentCode = '864202';
  await stubCodeSends(page);
  const verifies = await stubCodeVerify(page, 401);
  await openLogin(page);
  await sendCode(page, email);
  await page.getByTestId(CodeForm.code).fill(wrongCode);
  await expect(page.getByTestId(CodeForm.error)).toHaveText(WRONG_CODE_MESSAGE);
  await expect(page.getByTestId(CodeForm.code)).toHaveValue('');

  await page.getByTestId(CodeForm.code).pressSequentially(differentCode);

  await expect.poll(() => verifies.length).toBe(2);
  await expect(page.getByTestId(CodeForm.error)).toHaveText(WRONG_CODE_MESSAGE);
  expect(verifies).toEqual([
    expect.objectContaining({ username: email, otp: wrongCode }),
    expect.objectContaining({ username: email, otp: differentCode }),
  ]);
});
