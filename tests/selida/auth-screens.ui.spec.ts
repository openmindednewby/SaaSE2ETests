import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { SELIDA_APP_BASE } from './selida-account-helpers.js';

import type { Page, Request } from '@playwright/test';

const PHONE = { width: 360, height: 640 };
const MIXED_TEN = `Lock${String(2026)}Aa`;
const OTHER_MIXED_TEN = `Lock${String(2026)}Ab`;
const THREE_LETTERS = ['a', 'b', 'c'].join('');
const LONG_SYMBOLED = `Lock-Pages-${String(2026)}-aA!`;
const OTHER_LONG_SYMBOLED = `Lock-Pages-${String(2026)}-aB!`;

const IDS = {
  loginPage: 'selida-login-page',
  loginUsername: 'selida-auth-login-username',
  loginPassword: 'selida-auth-login-password',
  loginSubmit: 'selida-auth-login-submit',
  loginError: 'selida-auth-login-error',
  loginForgot: 'selida-auth-login-forgot-link',
  loginSignUp: 'selida-auth-login-signup-link',
  registerPage: 'selida-register-page',
  registerError: 'selida-register-error',
  registerSubmit: 'selida-register-submit-button',
  registerSignIn: 'selida-register-sign-in-link',
  forgotPage: 'selida-forgot-password-page',
  forgotEmail: 'selida-auth-forgot-email',
  forgotSubmit: 'selida-auth-forgot-submit',
  forgotError: 'selida-auth-forgot-error',
  resetPage: 'selida-reset-password-page',
  resetNew: 'selida-auth-reset-new',
  resetConfirm: 'selida-auth-reset-confirm',
  resetSubmit: 'selida-auth-reset-submit',
  resetError: 'selida-auth-reset-error',
} as const;

const REGISTER_INPUTS = {
  firstName: 'selida-register-first-name-input',
  lastName: 'selida-register-last-name-input',
  username: 'selida-register-username-input',
  email: 'selida-register-email-input',
  password: 'selida-register-password-input',
  confirmPassword: 'selida-register-confirm-password-input',
  tenantName: 'selida-register-tenant-name-input',
} as const;

type RegisterValues = Record<keyof typeof REGISTER_INPUTS, string>;

const TEXT = {
  loginTitle: 'Sign in to Selida',
  loginMissing: 'Enter your username and password.',
  loginInvalid: 'That username and password do not match.',
  registerTitle: 'Create your Selida account',
  registerMissing: 'Fill in every field.',
  registerInvalidEmail: 'Enter a valid email address.',
  registerWeak: 'Choose a stronger password.',
  registerMismatch: 'The passwords do not match.',
  forgotTitle: 'Reset your password',
  forgotInvalidEmail: 'Enter a valid email address.',
  forgotNetwork: 'We could not reach the server. Try again.',
  resetTitle: 'Choose a new password',
  resetEmpty: 'Enter and confirm your new password.',
  resetWeak: 'That password is too weak.',
  resetMismatch: 'The two passwords do not match.',
  resetTokenInvalid: 'This reset link has expired or was already used. Request a new one.',
} as const;

const FORGOT_REQUEST = /\/bff\/[^?]*forgot/i;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;

function app(path: string): string {
  return `${SELIDA_APP_BASE}${path}`;
}

function routeOf(page: Page): string {
  return new URL(page.url()).pathname;
}

function unknownName(): string {
  return `selidalock${randomBytes(5).toString('hex')}`;
}

async function fillRegister(page: Page, values: RegisterValues): Promise<void> {
  for (const [field, testId] of Object.entries(REGISTER_INPUTS)) {
    await page.getByTestId(testId).fill(values[field as keyof RegisterValues]);
  }
}

async function submitRegisterExpecting(page: Page, message: string, item: string): Promise<void> {
  await page.getByTestId(IDS.registerSubmit).click();
  await expect.soft(page.getByTestId(IDS.registerError), item).toHaveText(message);
}

async function submitResetExpecting(page: Page, passwords: [string, string], message: string, item: string): Promise<void> {
  await page.getByTestId(IDS.resetNew).fill(passwords[0]);
  await page.getByTestId(IDS.resetConfirm).fill(passwords[1]);
  await page.getByTestId(IDS.resetSubmit).click();
  await expect.soft(page.getByTestId(IDS.resetError), item).toHaveText(message);
}

test.describe('Selida auth screens, today', () => {
  test('LOCK-GUARD anonymous on / and on /pages, both land on /login', async ({ page }) => {
    const entries = ['/', '/pages'];

    for (const entry of entries) {
      await page.goto(app(entry));
      await expect.soft(page, `${entry} redirects anonymous to /login`).toHaveURL(/\/login$/);
    }

    await expect(page.getByTestId(IDS.loginPage), 'login page rendered after redirect').toBeVisible();
  });

  test('LOCK-LOGIN empty, then unknown account by Enter, shows missing then invalid, links open forgot and register', async ({ page }) => {
    const username = unknownName();
    await page.goto(app('/login'));
    await expect(page.getByTestId(IDS.loginPage), 'login page rendered').toBeVisible();
    await expect.soft(page.getByText(TEXT.loginTitle), 'title').toBeVisible();

    await page.getByTestId(IDS.loginSubmit).click();
    await expect.soft(page.getByTestId(IDS.loginError), 'empty submit message').toHaveText(TEXT.loginMissing);
    await page.getByTestId(IDS.loginUsername).fill(username);
    await page.getByTestId(IDS.loginPassword).fill(MIXED_TEN);
    const login = page.waitForResponse((r) => r.url().includes('/bff/login') && r.request().method() === 'POST');
    await page.getByTestId(IDS.loginPassword).press('Enter');

    expect.soft((await login).status(), 'Enter in password posts /bff/login, unknown account').toBe(HTTP_UNAUTHORIZED);
    await expect.soft(page.getByTestId(IDS.loginError), 'unknown account message').toHaveText(TEXT.loginInvalid);
    await page.getByTestId(IDS.loginForgot).click();
    await expect.soft(page, 'forgot link opens /forgot-password').toHaveURL(/\/forgot-password$/);
    await page.goto(app('/login'));
    await page.getByTestId(IDS.loginSignUp).click();
    await expect.soft(page, 'sign-up link opens /register').toHaveURL(/\/register$/);
  });

  test('LOCK-REGISTER at 360x640, invalid inputs show each validation, nothing is posted, page scrolls to submit', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const registerPosts: Request[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/bff/register') && r.method() === 'POST') registerPosts.push(r);
    });
    const valid: RegisterValues = {
      firstName: 'Ada', lastName: 'Lovelace', username: unknownName(), email: 'ada@example.invalid',
      password: LONG_SYMBOLED, confirmPassword: LONG_SYMBOLED, tenantName: 'Lock pages',
    };
    await page.goto(app('/register'));
    await expect(page.getByTestId(IDS.registerPage), 'register page rendered').toBeVisible();
    await expect.soft(page.getByText(TEXT.registerTitle), 'title').toBeVisible();
    for (const [field, testId] of Object.entries(REGISTER_INPUTS)) {
      await expect.soft(page.getByTestId(testId), `field ${field}`).toBeAttached();
    }

    await page.getByTestId(IDS.registerSubmit).scrollIntoViewIfNeeded();
    await expect.soft(page.getByTestId(IDS.registerSubmit), 'submit reachable by scrolling').toBeInViewport();
    await submitRegisterExpecting(page, TEXT.registerMissing, 'empty submit message');
    await fillRegister(page, { ...valid, email: 'not-an-email' });
    await submitRegisterExpecting(page, TEXT.registerInvalidEmail, 'invalid email message');
    await fillRegister(page, { ...valid, password: THREE_LETTERS, confirmPassword: THREE_LETTERS });
    await submitRegisterExpecting(page, TEXT.registerWeak, 'weak password message');
    await fillRegister(page, { ...valid, password: MIXED_TEN, confirmPassword: MIXED_TEN });
    await submitRegisterExpecting(page, TEXT.registerWeak, '10 chars with upper, lower and digit is weak today');
    await fillRegister(page, { ...valid, confirmPassword: OTHER_LONG_SYMBOLED });
    await submitRegisterExpecting(page, TEXT.registerMismatch, 'mismatch message');
    expect.soft(registerPosts.length, 'no POST /bff/register from any invalid submit').toBe(0);
    await page.getByTestId(IDS.registerSignIn).click();
    await expect.soft(page, 'sign-in link opens /login').toHaveURL(/\/login$/);
  });

  test('LOCK-FORGOT invalid email, network failure, then unknown address, shows each state and lands on /login', async ({ page }) => {
    const address = `${unknownName()}@example.invalid`;
    await page.goto(app('/forgot-password'));
    await expect(page.getByTestId(IDS.forgotPage), 'forgot page rendered').toBeVisible();
    await expect.soft(page.getByText(TEXT.forgotTitle), 'title').toBeVisible();

    await page.getByTestId(IDS.forgotEmail).fill('not-an-email');
    await page.getByTestId(IDS.forgotSubmit).click();
    await expect.soft(page.getByTestId(IDS.forgotError), 'invalid email message').toHaveText(TEXT.forgotInvalidEmail);
    await page.route(FORGOT_REQUEST, (route) => route.abort('internetdisconnected'));
    await page.getByTestId(IDS.forgotEmail).fill(address);
    await page.getByTestId(IDS.forgotSubmit).click();
    await expect.soft(page.getByTestId(IDS.forgotError), 'network failure message').toHaveText(TEXT.forgotNetwork);
    await page.unroute(FORGOT_REQUEST);
    const forgot = page.waitForResponse((r) => FORGOT_REQUEST.test(r.url()) && r.request().method() === 'POST');
    await page.getByTestId(IDS.forgotSubmit).click();

    expect.soft((await forgot).status(), 'unknown address answers OK (no enumeration)').toBe(HTTP_OK);
    await expect.soft(page, 'success replaces the route with /login').toHaveURL(/\/login$/);
    expect(routeOf(page), 'ends on /login').toBe('/login');
  });

  test('LOCK-RESET empty, weak, mismatch, bogus token and no token, shows each error and stays on the page', async ({ page }) => {
    await page.goto(app('/reset-password?token=selida-lock-not-a-token'));
    await expect(page.getByTestId(IDS.resetPage), 'reset page rendered').toBeVisible();
    await expect.soft(page.getByText(TEXT.resetTitle), 'title').toBeVisible();

    await submitResetExpecting(page, ['', ''], TEXT.resetEmpty, 'empty message');
    await submitResetExpecting(page, [THREE_LETTERS, THREE_LETTERS], TEXT.resetWeak, 'weak message');
    await submitResetExpecting(page, [MIXED_TEN, OTHER_MIXED_TEN], TEXT.resetMismatch, 'mismatch message');
    await submitResetExpecting(page, [MIXED_TEN, MIXED_TEN], TEXT.resetTokenInvalid, 'server rejects bogus token');
    await page.goto(app('/reset-password'));
    await submitResetExpecting(page, [MIXED_TEN, MIXED_TEN], TEXT.resetTokenInvalid, 'no token in query');
    expect(routeOf(page), 'stays on /reset-password').toBe('/reset-password');
  });
});
