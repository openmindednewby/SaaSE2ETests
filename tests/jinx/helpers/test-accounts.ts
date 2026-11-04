import { setTimeout as delay } from 'node:timers/promises';

import { BotMailbox, loadBotMailboxConfig, type TestAccountContext, type TestAccountMailbox } from '@dloizides/e2e-helpers';
import { expect, request, type APIResponse, type Page } from '@playwright/test';

import { APP_URL } from './tracker';

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAUTHORIZED = 401;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MS_PER_SECOND = 1000;
const MAX_THROTTLED_ATTEMPTS = 4;
const ERASE_POLL_MS = 20_000;
const ERASE_TIMEOUT_MS = 180_000;
const LEFTOVER_MAIL_WAIT_MS = 4000;
const FORM_FILL_SECONDS_MS = 2000;
const VERIFY_PATH = '/bff/verify-and-login';
const REGISTER_PATH = '/bff/register';

type PostOptions = NonNullable<Parameters<TestAccountContext['post']>[1]>;
type PostHook = (url: string, options: PostOptions, send: (next?: PostOptions) => Promise<APIResponse>) => Promise<APIResponse>;

export interface RegisterBody {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  tenantName: string;
}

function retryAfterMs(response: APIResponse): number {
  const seconds = Number.parseInt(response.headers()['retry-after'] ?? '', 10);
  return (Number.isNaN(seconds) ? DEFAULT_RETRY_AFTER_SECONDS : seconds) * MS_PER_SECOND;
}

export async function postPaced(context: TestAccountContext, url: string, options: PostOptions): Promise<APIResponse> {
  let response = await context.post(url, options);
  for (let attempt = 1; attempt < MAX_THROTTLED_ATTEMPTS && response.status() === HTTP_TOO_MANY_REQUESTS; attempt += 1) {
    await delay(retryAfterMs(response));
    response = await context.post(url, options);
  }
  return response;
}

export function apiContext(baseUrl: string): ReturnType<typeof request.newContext> {
  return request.newContext({ baseURL: baseUrl, extraHTTPHeaders: { Origin: baseUrl, 'X-BFF-Csrf': '1' } });
}

export function hookedContext(hook: PostHook): (baseUrl: string) => Promise<TestAccountContext> {
  return async (baseUrl) => {
    const context = await apiContext(baseUrl);
    return {
      get: context.get.bind(context),
      dispose: context.dispose.bind(context),
      post: (url, options = {}) =>
        hook(url, options, (next) => postPaced(context, url, next ?? options)),
    };
  };
}

export function pacedContext(): (baseUrl: string) => Promise<TestAccountContext> {
  return hookedContext((_url, _options, send) => send());
}

export function isRegister(url: string): boolean {
  return url === REGISTER_PATH;
}

export function isVerify(url: string): boolean {
  return url === VERIFY_PATH;
}

export function newestMailbox(): TestAccountMailbox {
  const mailbox = new BotMailbox(loadBotMailboxConfig(), { timeoutMs: 120_000 });
  return {
    waitForMessageTo: (to, options) => mailbox.waitForMessageTo(to, { ...options, preferNewest: true }),
    expungeMessages: (uids) => mailbox.expungeMessages(uids),
  };
}

export async function expungeLeftoverMail(email: string): Promise<void> {
  const mailbox = new BotMailbox(loadBotMailboxConfig(), { timeoutMs: LEFTOVER_MAIL_WAIT_MS });
  for (;;) {
    const mail = await mailbox.waitForMessageTo(email).catch(() => null);
    if (mail === null) return;
    await mailbox.expungeMessages([mail.uid]);
  }
}

export async function signIn(username: string, password: string): Promise<number> {
  const context = await apiContext(APP_URL);
  try {
    const response = await postPaced(context, '/bff/login', { data: { username, password } });
    return response.status();
  } finally {
    await context.dispose();
  }
}

export async function expectSignInGone(username: string, password: string): Promise<void> {
  await expect
    .poll(() => signIn(username, password), {
      message: `sign-in for ${username} after dispose`,
      intervals: [ERASE_POLL_MS],
      timeout: ERASE_TIMEOUT_MS,
    })
    .toBe(HTTP_UNAUTHORIZED);
}

async function submitRegisterForm(page: Page, body: RegisterBody): Promise<APIResponse> {
  await page.clock.install();
  await page.goto(`${APP_URL}/register`);
  await page.getByTestId('jinx-register-first-name-input').fill(body.firstName);
  await page.getByTestId('jinx-register-last-name-input').fill(body.lastName);
  await page.getByTestId('jinx-register-username-input').fill(body.username);
  await page.getByTestId('jinx-register-email-input').fill(body.email);
  await page.getByTestId('jinx-register-password-input').fill(body.password);
  await page.getByTestId('jinx-register-confirm-password-input').fill(body.password);
  await page.getByTestId('jinx-register-tenant-name-input').fill(body.tenantName);
  await page.clock.fastForward(FORM_FILL_SECONDS_MS);

  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === REGISTER_PATH);
  await page.getByTestId('jinx-register-submit-button').click();
  return (await answered) as unknown as APIResponse;
}

async function openVerifyLink(page: Page, token: string): Promise<APIResponse> {
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === VERIFY_PATH);
  await page.goto(`${APP_URL}/verify-email?token=${encodeURIComponent(token)}`);
  return (await answered) as unknown as APIResponse;
}

export interface FormJourneyProbes {
  meBeforeVerify?: number;
}

export function formContext(page: Page, probes: FormJourneyProbes): () => Promise<TestAccountContext> {
  return async () => ({
    get: page.request.get.bind(page.request),
    dispose: async () => undefined,
    post: async (url, options = {}) => {
      if (isRegister(url)) {
        const answered = await submitRegisterForm(page, options.data as RegisterBody);
        await expect(page.getByTestId('jinx-register-check-email')).toBeVisible();
        probes.meBeforeVerify = (await page.request.get('/bff/me')).status();
        return answered;
      }
      if (isVerify(url)) return openVerifyLink(page, (options.data as { token: string }).token);
      return postPaced(page.request, url, options);
    },
  });
}
