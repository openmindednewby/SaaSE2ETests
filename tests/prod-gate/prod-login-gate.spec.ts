/**
 * Gate B — Post-deploy REAL-UI login probe (P0-02).
 *
 * The permanent guard for the "agent says fixed but prod is broken" class that
 * the API-level login path (`loginViaAPI` / ROPC) structurally cannot catch:
 * a dead Sign-in button, an unbranded Keycloak bounce, or a post-login dead-end
 * all pass an API login while a real user is stuck. This spec drives the ACTUAL
 * rendered login UI, in a real browser, against the live PUBLIC URL, using real
 * pointer + keyboard events (Playwright `.fill()` / `.click()` — NOT
 * `dispatchEvent` / value injection, which produced the P0-03 false negative on
 * RN-web `Pressable`; see P0-03 task doc).
 *
 * Per product it asserts:
 *   1. no console errors of severity `error` while loading the login page,
 *   2. a real-UI password login LANDS on an authenticated route (leaves /login),
 *   3. the landed route RENDERS — not the generic error boundary
 *      ("Something went wrong" / "unexpected error"), which is the exact P0-01
 *      Katalogos symptom (authed layout crashed on a 404 chunk).
 *
 * Run: `E2E_TARGET=prod npx playwright test --project=prod-gate`
 * (staging works too: `E2E_TARGET=staging`). Creds + hosts come from
 * `.env.<target>(.secrets)`. Keep this to 1 test/product — it is a GATE, not a
 * suite. New product → add a row to PRODUCTS.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

import { TestIds, testIdSelector } from '../../shared/testIds.js';

type LoginScheme = 'shared-auth' | 'kefi';

interface ProductGate {
  readonly name: string;
  /** Public base URL env var (per E2E_TARGET). */
  readonly baseUrlEnv: string;
  /** Username/email + password env var names. */
  readonly userEnv: string;
  readonly passEnv: string;
  /** Which login DOM contract this product renders. */
  readonly scheme: LoginScheme;
}

// The shared `@dloizides/auth-web` <LoginForm> (katalogos-web, erevna-web) uses
// `auth-login-*` testIds; kefi-web keeps its hand-rolled `kefi-login-*` form.
const SHARED_IDS = {
  username: testIdSelector(TestIds.USERNAME_INPUT), // auth-login-username
  password: testIdSelector(TestIds.PASSWORD_INPUT), // auth-login-password
  submit: testIdSelector(TestIds.LOGIN_BUTTON), // auth-login-submit
};
const KEFI_IDS = {
  username: '[data-testid="kefi-login-username"]',
  password: '[data-testid="kefi-login-password"]',
  submit: '[data-testid="kefi-login-password-submit"]',
};

const PRODUCTS: readonly ProductGate[] = [
  // Katalogos — THE P0-01 product. onlinemenu-realm superUser (in .env.prod.secrets).
  { name: 'katalogos', baseUrlEnv: 'KATALOGOS_BASE_URL', userEnv: 'SUPERUSER_USERNAME', passEnv: 'SUPERUSER_PASSWORD', scheme: 'shared-auth' },
  // Kefi — the sellable flagship. kefi-realm platform admin (email as username).
  { name: 'kefi', baseUrlEnv: 'KEFI_WEB_URL', userEnv: 'KEFI_PLATFORM_ADMIN_USERNAME', passEnv: 'KEFI_PLATFORM_ADMIN_PASSWORD', scheme: 'kefi' },
  // Erevna — questioner realm. Needs questioner-realm creds; runs only when
  // EREVNA_TEST_USERNAME/PASSWORD are provided (superUser is onlinemenu-realm,
  // so it CANNOT log into erevna). Real-UI erevna login already verified by hand
  // on prod (P0-03: POST /bff/login fires, error surfaces) — kept here so it
  // gates automatically once questioner creds are wired.
  { name: 'erevna', baseUrlEnv: 'EREVNA_BASE_URL', userEnv: 'EREVNA_TEST_USERNAME', passEnv: 'EREVNA_TEST_PASSWORD', scheme: 'shared-auth' },
];

const ERROR_BOUNDARY = /something went wrong|unexpected error occurred/i;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

for (const product of PRODUCTS) {
  const baseUrl = process.env[product.baseUrlEnv];
  const username = process.env[product.userEnv];
  const password = process.env[product.passEnv];
  const ids = product.scheme === 'kefi' ? KEFI_IDS : SHARED_IDS;

  test(`prod-gate: ${product.name} real-UI login lands on an authed route`, async ({ page }) => {
    test.skip(
      !baseUrl || !username || !password,
      `${product.name}: missing ${product.baseUrlEnv}/${product.userEnv}/${product.passEnv} for this target`,
    );

    const consoleErrors = collectConsoleErrors(page);

    // 1. Load the real login page. RN-web dev/prod bundles can be slow to hydrate.
    await page.goto(`${baseUrl!.replace(/\/$/, '')}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator(ids.username).waitFor({ state: 'visible', timeout: 30_000 });

    // 2. Real-UI password login — real pointer/keyboard events (see P0-03).
    await page.locator(ids.username).fill(username!);
    await page.locator(ids.password).fill(password!);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
      page.locator(ids.submit).click(),
    ]);

    // 3. The landed authed route must RENDER, not the P0-01 error boundary.
    await expect(page.locator('body')).not.toContainText(ERROR_BOUNDARY, { timeout: 10_000 });

    // 4. No REAL console errors getting here. This is the P0-01 net —
    //    `AsyncRequireError` (a 404 chunk), JS exceptions, 5xx. We DON'T fail on:
    //    - the i18next promo notice (benign, always logged),
    //    - a `Failed to load resource … 401/403`: the app's pre-login `/bff/me`
    //      probe (and permission-gated resources) legitimately return 401/403
    //      during the auth handshake — expected, not a defect. A 404 (missing
    //      chunk = the P0-01 outage) or 5xx is NOT filtered and still fails.
    const BENIGN = /locize\.com|i18next is maintained|Failed to load resource: the server responded with a status of 40[13]\b/i;
    const real = consoleErrors.filter((e) => !BENIGN.test(e));
    expect(real, `console errors on ${product.name}: ${real.join(' | ')}`).toEqual([]);
  });
}
