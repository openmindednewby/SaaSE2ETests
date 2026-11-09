import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { BotMailbox, loadBotMailboxConfig, type CapturedEmail } from '@dloizides/e2e-helpers';
import { expect, type Locator, type Page, type Response } from '@playwright/test';

import { WRITE_HEADERS } from './live-api';
import { postPaced } from './test-accounts';
import { APP_URL } from './tracker';

export const SESSION_COOKIE = '__Host-bff-jinx';
export const OTP_SEND_COOLDOWN_MS = 31_000;

export const CodeForm = {
  form: 'jinx-auth-otp-form',
  email: 'jinx-auth-otp-email',
  honeypot: 'jinx-auth-otp-website',
  send: 'jinx-auth-otp-request',
  code: 'jinx-auth-otp-code',
  verify: 'jinx-auth-otp-verify',
  resend: 'jinx-auth-otp-resend',
  error: 'jinx-auth-otp-error',
  notice: 'jinx-auth-otp-notice',
} as const;

export const DeleteForm = {
  submit: 'jinx-account-deletion-submit-button',
  checkEmail: 'jinx-account-deletion-check-email',
} as const;

const OTP_EMAIL_SUBJECT = 'Your Verification Code';
const MAILBOX_TIMEOUT_MS = 120_000;
const AUTH_RATE_WINDOW_MS = 60_000;
const MAX_PACED_ATTEMPTS = 8;
const DELETE_REQUEST_PATH = '/bff/account/delete-request';
const HTTP_ACCEPTED = 202;
const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const SIX_DIGITS = /(?<![#\w])(\d{6})(?!\w)/;
const DELETION_LINK = /https?:\/\/[^\s"'<>)]*\/privacy\/delete-request\/[^\s"'<>)]+/i;
const DIGITS_IN_A_DECIMAL = 10;
const OTP_REQUEST_ROUTE = '**/bff/otp/request';
const OTP_VERIFY_ROUTE = '**/bff/otp/verify';
const STUB_EXPIRES_IN_SECONDS = 300;
const MS_PER_SECOND = 1000;

export interface CodeAccount {
  email: string;
  verify: Response;
}

export function uniqueCodeEmail(): string {
  return `e2e-bot+jinx-otp-${Date.now().toString(36)}${randomBytes(4).toString('hex')}@dloizides.com`;
}

function botMailbox(): BotMailbox {
  return new BotMailbox(loadBotMailboxConfig(), { timeoutMs: MAILBOX_TIMEOUT_MS });
}

function bodyOf(mail: CapturedEmail): string {
  return mail.bodyHtml ?? mail.bodyText;
}

export async function readCodeEmail(email: string): Promise<string> {
  const mailbox = botMailbox();
  const mail = await mailbox.waitForMessageTo(email, { subjectIncludes: OTP_EMAIL_SUBJECT, preferNewest: true });
  await mailbox.expungeMessages([mail.uid]);
  return bodyOf(mail);
}

export async function readCode(email: string): Promise<string> {
  const code = SIX_DIGITS.exec(await readCodeEmail(email))?.[1];
  expect(code, `a six-digit code in the mail to ${email}`).toBeDefined();
  return code ?? '';
}

export function otherCode(code: string): string {
  const last = (Number(code.slice(-1)) + 1) % DIGITS_IN_A_DECIMAL;
  return `${code.slice(0, -1)}${String(last)}`;
}

async function pacedPress(page: Page, path: string, press: () => Promise<void>): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === path);
    await press();
    const response = await answered;
    if (response.status() !== HTTP_TOO_MANY_REQUESTS || attempt === MAX_PACED_ATTEMPTS) return response;
    await delay(AUTH_RATE_WINDOW_MS);
  }
}

export async function submitDeletionForm(page: Page): Promise<void> {
  const answered = await pacedPress(page, DELETE_REQUEST_PATH, () => page.getByTestId(DeleteForm.submit).click());
  expect(answered.status(), `POST ${DELETE_REQUEST_PATH} from the form`).toBe(HTTP_ACCEPTED);
}

export async function openLogin(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/login`);
  await expect(page.getByTestId(CodeForm.email)).toBeVisible();
}

export async function sendCode(page: Page, email: string): Promise<Response> {
  await page.getByTestId(CodeForm.email).fill(email);
  const sent = await pacedPress(page, '/bff/otp/request', () => page.getByTestId(CodeForm.send).click());
  expect(sent.status(), `POST /bff/otp/request for ${email}`).toBe(HTTP_OK);
  await expect(page.getByTestId(CodeForm.code)).toBeVisible();
  return sent;
}

async function fillOrResubmitCode(field: Locator, code: string): Promise<void> {
  if ((await field.inputValue()) === code) await field.press('Enter');
  else await field.fill(code);
}

export async function enterCode(page: Page, code: string): Promise<Response> {
  const field = page.getByTestId(CodeForm.code);
  return pacedPress(page, '/bff/otp/verify', () => fillOrResubmitCode(field, code));
}

export async function signInByCode(page: Page, email = uniqueCodeEmail()): Promise<CodeAccount> {
  await openLogin(page);
  await sendCode(page, email);
  const verify = await enterCode(page, await readCode(email));
  expect(verify.status(), `POST /bff/otp/verify for ${email}`).toBe(HTTP_OK);
  await expect(page).not.toHaveURL(/\/login/);
  return { email, verify };
}

export async function requestDeletion(page: Page): Promise<void> {
  const requested = await postPaced(
    page.request,
    `${APP_URL}/bff/account/delete-request`,
    { headers: WRITE_HEADERS, data: {} },
    AUTH_RATE_WINDOW_MS,
  );
  expect(requested.status(), 'POST /bff/account/delete-request').toBe(HTTP_ACCEPTED);
}

function tokenOf(link: string): string {
  const url = new URL(link);
  return url.searchParams.get('token') ?? url.pathname.split('/').pop() ?? '';
}

export async function confirmDeletion(page: Page, email: string): Promise<number> {
  const mailbox = botMailbox();
  const mail = await mailbox.waitForMessageTo(email, {
    preferNewest: true,
    matches: (candidate) => DELETION_LINK.test(bodyOf(candidate)),
  });
  await mailbox.expungeMessages([mail.uid]);
  const link = (DELETION_LINK.exec(bodyOf(mail))?.[0] ?? '').replace(/&amp;/g, '&');
  const landing = await page.request.get(link);
  expect(landing.status(), `GET ${link}`).toBe(HTTP_OK);
  const confirmed = await page.request.post(new URL('confirm-form', link).href, {
    headers: WRITE_HEADERS,
    form: { confirmationToken: tokenOf(link) },
  });
  return confirmed.status();
}

export async function removeCodeAccount(page: Page, email: string): Promise<void> {
  await requestDeletion(page);
  expect.soft(await confirmDeletion(page, email), `confirm deletion of ${email}`).toBe(HTTP_OK);
}

export async function storedAuthState(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
}

export async function stubCodeSends(page: Page): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(OTP_REQUEST_ROUTE, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: HTTP_OK, json: { success: true, expiresIn: STUB_EXPIRES_IN_SECONDS, code: null } });
  });
  return bodies;
}

export async function stubCodeVerify(page: Page, status: number): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(OTP_VERIFY_ROUTE, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status, json: {} });
  });
  return bodies;
}

export function sessionCookieLifetimeSeconds(setCookies: string[]): number {
  const cookie = setCookies.find((value) => value.startsWith(`${SESSION_COOKIE}=`)) ?? '';
  const maxAge = /max-age=(\d+)/i.exec(cookie)?.[1];
  if (maxAge !== undefined) return Number(maxAge);
  const expires = /expires=([^;]+)/i.exec(cookie)?.[1] ?? '';
  return Math.round((Date.parse(expires) - Date.now()) / MS_PER_SECOND);
}
