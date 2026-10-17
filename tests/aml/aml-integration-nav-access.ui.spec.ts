import { devices, expect, test, type Page } from '@playwright/test';

import { MOBILE_FLOOR } from '../../fixtures/mobile-devices.js';

const AML_WEB_URL = (process.env.AML_WEB_URL ?? 'https://aml-screening.dloizides.com/app').replace(/\/+$/, '');
const IDP_HOST = process.env.AML_IDP_HOST?.trim() || 'aml-identity.dloizides.com';
const TENANT_EMAIL = process.env.AML_TESTER_EMAIL?.trim() || null;
const TENANT_PASSWORD = process.env.AML_TESTER_PASSWORD?.trim() || null;
const OPERATOR_EMAIL = process.env.AML_PLATFORM_ADMIN_EMAIL?.trim() || null;
const OPERATOR_PASSWORD = process.env.AML_PLATFORM_ADMIN_PASSWORD?.trim() || null;

const LOAD_TIMEOUT_MS = 45_000;
const HTTP_OK = 200;
const SHELL = 'authed-shell';
const INTEGRATION_NAV = 'integration';
const NO_ACCESS = 'operator-route-no-access';

const { defaultBrowserType: desktopBrowser, ...DESKTOP_1280 } = devices['Desktop Chrome'];
void desktopBrowser;

const VIEWPORTS = [
  { name: 'mobile 360x640', device: MOBILE_FLOOR },
  { name: 'desktop 1280x720', device: DESKTOP_1280 },
];

async function signIn(page: Page, email: string, password: string, returnPath: string): Promise<void> {
  const origin = new URL(AML_WEB_URL).origin;
  await page.goto(`${origin}/bff/passkey/login?returnUrl=${encodeURIComponent(`/app${returnPath}`)}`, {
    waitUntil: 'domcontentloaded',
    timeout: LOAD_TIMEOUT_MS,
  });
  expect(page.url(), `login did not reach the IdP (${IDP_HOST})`).toContain(IDP_HOST);
  await page.locator('input#email, input[type="email"]').first().fill(email);
  await page.locator('input#password, input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(url => url.host === new URL(AML_WEB_URL).host, { timeout: LOAD_TIMEOUT_MS });
  const me = await page.request.get(`${origin}/bff/me`);
  expect(me.status(), 'signed-in precondition failed: /bff/me did not return 200').toBe(HTTP_OK);
}

async function openNav(page: Page): Promise<void> {
  await expect(page.getByTestId(`${SHELL}-content`)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  const toggle = page.getByTestId(`${SHELL}-menu-toggle`);
  if (!(await toggle.isVisible())) return;
  await toggle.click();
  await expect(page.getByTestId(`${SHELL}-drawer`), 'the mobile nav drawer did not open').toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`W12 Integration nav access at ${viewport.name}`, () => {
    test.use({ ...viewport.device });

    test(`W12 tenant user opens the console, sees no Integration nav item`, async ({ page }) => {
      test.skip(!TENANT_EMAIL || !TENANT_PASSWORD, 'AML_TESTER_EMAIL / AML_TESTER_PASSWORD unset');
      await signIn(page, TENANT_EMAIL!, TENANT_PASSWORD!, '/');

      await openNav(page);

      await expect(page.getByTestId(INTEGRATION_NAV), 'a tenant user must not see the Integration group').toHaveCount(0);
    });

    test(`W12 tenant user opens /integration directly, sees the no-access notice`, async ({ page }) => {
      test.skip(!TENANT_EMAIL || !TENANT_PASSWORD, 'AML_TESTER_EMAIL / AML_TESTER_PASSWORD unset');
      await signIn(page, TENANT_EMAIL!, TENANT_PASSWORD!, '/');

      await page.goto(`${AML_WEB_URL}/integration`, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });

      await expect(page.getByTestId(NO_ACCESS), 'direct /integration must render the operator-only notice').toBeVisible({
        timeout: LOAD_TIMEOUT_MS,
      });
    });

    test(`W12 platform operator opens the console, sees the Integration nav item`, async ({ page }) => {
      test.skip(!OPERATOR_EMAIL || !OPERATOR_PASSWORD, 'AML_PLATFORM_ADMIN_EMAIL / AML_PLATFORM_ADMIN_PASSWORD unset');
      await signIn(page, OPERATOR_EMAIL!, OPERATOR_PASSWORD!, '/');

      await openNav(page);

      await expect(page.getByTestId(INTEGRATION_NAV).first(), 'the platform operator must see Integration').toBeVisible();
    });
  });
}
