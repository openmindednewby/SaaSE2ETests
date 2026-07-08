/**
 * UI-driving helpers for the P1-08 Katalogos self-serve signup journey
 * (`tests/prod-gate/katalogos-signup.spec.ts`). Kept out of the spec so the spec
 * stays focused on test structure + assertions (and under the file-length cap).
 */
import { expect, type Browser, type Page } from '@playwright/test';

import { getCanaryRunIdShort } from './canary-prefix.js';
import { OnlineMenusPublicPage } from '../pages/OnlineMenusPublicPage.js';
import { TestIds, testIdSelector } from '../shared/testIds.js';

export const ERROR_BOUNDARY = /something went wrong|unexpected error occurred/i;
export const STRONG_PASSWORD = 'Str0ng!signup1';
export const LANDING_TIMEOUT = 45_000;
const WIZARD_TIMEOUT = 30_000;

// The public route ships a large (~2.5 MB) `_layout` chunk that must fully
// download + execute before React mounts and the `/public/menus/{id}` fetch
// fires. `NAV` bounds that download on a cold connection; `RENDER` bounds React
// mount + the public API round-trip → visible content.
const PUBLIC_MENU_NAV_TIMEOUT = 60_000;
const PUBLIC_MENU_RENDER_TIMEOUT = 45_000;

export interface SignupInput {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  tenantName: string;
  menuName: string;
  honeypot?: string;
}

// A UNIQUE, VALID self-serve name. It deliberately does NOT use the canary
// `e2ec-<runId>-` prefix: TenantService's `MustNotMatchReservedPrefix`
// (`^e2ec-[0-9a-f]{8}-`) rejects that prefix on the PUBLIC register path by
// design (anti-abuse — real users can't squat the canary namespace). The `p108`
// prefix + run id keeps names unique + greppable, and the bespoke
// signup-teardown reclaims them since the canary sweep cannot.
let signupSeq = 0;
function validSignupSlug(): string {
  const run = getCanaryRunIdShort() ?? 'local';
  signupSeq += 1;
  return `p108${run}${signupSeq}`;
}

export function uniqueSignup(honeypot?: string): SignupInput {
  const slug = validSignupSlug();
  return {
    firstName: 'Selfserve',
    lastName: 'Tester',
    username: slug,
    email: `${slug}@example.com`,
    tenantName: `${slug} Bistro`,
    menuName: `${slug} Menu`,
    honeypot,
  };
}

/**
 * Pre-seed client state so full-page overlays never render — they are RN-web
 * Pressables that swallow Playwright's synthetic click AND cover every other
 * control (the P0-03 class), so once shown they block the whole flow:
 *
 *   - `COOKIE_CONSENT` — the cookie banner (`@dloizides/legal-ui`,
 *     CONSENT_VERSION '1.0'; the exact shape `useCookieConsent` validates).
 *   - `menuflow_tour_seen_{dashboard,editor,public-menu}` — the guided-tour
 *     backdrop that auto-starts on the dashboard / editor / public menu
 *     (`TOUR_SEEN_KEY_PREFIX`). Left un-seeded it intercepts every wizard click.
 *
 * Must run before the first goto on every page/context (incl. the anonymous
 * diner context, where the public-menu tour would otherwise cover the viewer).
 */
export async function seedClientState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'COOKIE_CONSENT',
        JSON.stringify({
          necessary: true,
          analytics: false,
          marketing: false,
          consentedAt: '2026-01-01T00:00:00.000Z',
          version: '1.0',
        }),
      );
      for (const tour of ['dashboard', 'editor', 'public-menu']) {
        window.localStorage.setItem(`menuflow_tour_seen_${tour}`, 'true');
      }
    } catch {
      /* storage unavailable — overlays will show, the test will surface it */
    }
  });
}

/** Fill + submit the register form. Assumes the page is already on /register. */
export async function fillAndSubmitRegister(page: Page, input: SignupInput): Promise<void> {
  await page.locator(testIdSelector(TestIds.REGISTER_FIRST_NAME_INPUT)).fill(input.firstName);
  await page.locator(testIdSelector(TestIds.REGISTER_LAST_NAME_INPUT)).fill(input.lastName);
  await page.locator(testIdSelector(TestIds.REGISTER_USERNAME_INPUT)).fill(input.username);
  await page.locator(testIdSelector(TestIds.REGISTER_EMAIL_INPUT)).fill(input.email);
  await page.locator(testIdSelector(TestIds.REGISTER_PASSWORD_INPUT)).fill(STRONG_PASSWORD);
  await page.locator(testIdSelector(TestIds.REGISTER_CONFIRM_PASSWORD_INPUT)).fill(STRONG_PASSWORD);
  await page.locator(testIdSelector(TestIds.REGISTER_TENANT_NAME_INPUT)).fill(input.tenantName);
  if (input.honeypot !== undefined) {
    await page.locator('[data-testid="register-website"]').fill(input.honeypot);
  }
  await page.locator(testIdSelector(TestIds.REGISTER_SUBMIT_BUTTON)).click();
}

/**
 * Drive the first-run WelcomeWizard from a freshly-registered, empty tenant to a
 * created starter menu, landing on `/menus`:
 *   Step 1 business name → Step 2 logo (skipped) → Step 3 menu from a template.
 *
 * Step 1 sometimes auto-skips (when the tenant name has already loaded from
 * `/register`), so we set it only when its input is on screen; the logo step is
 * advanced with the side-effect-free Skip button, stopping BEFORE it could skip
 * menu creation.
 */
export async function completeWelcomeWizard(page: Page, businessName: string, menuName: string): Promise<void> {
  await expect(page.locator(testIdSelector(TestIds.WELCOME_WIZARD))).toBeVisible({ timeout: WIZARD_TIMEOUT });

  const businessInput = page.locator(testIdSelector(TestIds.WELCOME_WIZARD_BUSINESS_NAME_INPUT));
  const menuNameInput = page.locator(testIdSelector(TestIds.WELCOME_WIZARD_MENU_NAME_INPUT));
  const skipButton = page.locator(testIdSelector(TestIds.WELCOME_WIZARD_SKIP_BUTTON));
  const continueButton = page.locator(testIdSelector(TestIds.WELCOME_WIZARD_CONTINUE_BUTTON));

  // Step 1 — business name (unless it auto-skipped).
  if (await businessInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await businessInput.fill(businessName);
    await continueButton.click();
  }

  // Step 2 — logo: skip. Advance until the menu-name step (Step 3) is on screen.
  const MAX_STEP_ADVANCES = 4;
  for (let i = 0; i < MAX_STEP_ADVANCES; i++) {
    if (await menuNameInput.isVisible({ timeout: 3_000 }).catch(() => false)) break;
    if (!(await skipButton.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    await skipButton.click().catch(() => undefined);
  }
  await expect(menuNameInput).toBeVisible({ timeout: 15_000 });

  // Starter menu FROM A TEMPLATE: pick the first template card if the gallery
  // rendered any (gives the public page real content); harmless if none.
  const firstTemplate = page.locator('[data-testid^="menu-template-card-"]').first();
  if (await firstTemplate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await firstTemplate.click().catch(() => undefined);
  }
  await menuNameInput.fill(menuName);

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/TenantMenus') && r.request().method() === 'POST',
    { timeout: WIZARD_TIMEOUT },
  );
  await continueButton.click();
  const resp = await createResp;
  expect(resp.ok(), `wizard menu POST -> ${resp.status()}`).toBeTruthy();

  const completeButton = page.locator(testIdSelector(TestIds.WELCOME_WIZARD_COMPLETE_BUTTON));
  await expect(completeButton).toBeVisible({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/menus/, { timeout: 20_000 }),
    completeButton.click(),
  ]);
}

/** Read the exact public menu URL from the card's QR-code modal. */
export async function readPublicMenuUrl(page: Page, menuName: string): Promise<string> {
  const publicPo = new OnlineMenusPublicPage(page);
  await publicPo.openQrCodeModal(menuName);
  const url = (await publicPo.qrCodeUrlText.textContent({ timeout: 10_000 }))?.trim() ?? '';
  await publicPo.closeQrCodeModal().catch(() => undefined);
  expect(url, 'QR modal did not expose a public menu URL').toMatch(/\/public\/menu\//);
  return url;
}

/**
 * Open the public URL as a real diner would — a FRESH, unauthenticated context
 * (an authenticated session is redirected to the admin app).
 *
 * CRITICAL: load ONCE and wait patiently — do NOT re-`goto` in a loop. A fresh
 * navigation ABORTS the still-downloading 2.5 MB `_layout` chunk (net::ERR_ABORTED),
 * so React never mounts, the body stays blank, and zero `/public/menus/` calls
 * fire. That chunk-abort is exactly the false-negative the old 6× re-goto loop
 * produced (`waitUntil:'domcontentloaded'` resolves before the async chunk
 * finishes, so an 8 s wait then re-navigated over the in-flight chunk). See the
 * P1-08 task doc for captured evidence.
 *
 * Instead: `goto` with `waitUntil:'load'` and wait for the `/public/menus/`
 * response — it only fires AFTER the route chunk mounts, so awaiting it proves the
 * chunk loaded without re-navigating. A single reload retry (safe: it runs only
 * after the first load fully settled, so nothing is in flight to abort) absorbs
 * public-menu cache propagation right after publish.
 */
export async function assertPublicMenuRenders(browser: Browser, url: string, menuName: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const anonPage = await context.newPage();
    await seedClientState(anonPage);
    const viewer = anonPage.locator(testIdSelector(TestIds.PUBLIC_MENU_VIEWER));
    const nameText = anonPage.getByText(menuName, { exact: false }).first();
    const target = viewer.or(nameText).first();
    const menuFetched = (): Promise<unknown> =>
      anonPage
        .waitForResponse((r) => r.url().includes('/public/menus/'), { timeout: PUBLIC_MENU_NAV_TIMEOUT })
        .catch(() => null);

    // `waitUntil:'commit'` (not 'load'): `goto` resolves early, but the ACTIONABLE
    // wait is `menuFetched()` — the public fetch only fires after the route chunk
    // mounts, so awaiting it proves the chunk loaded WITHOUT re-navigating over it.
    const firstFetch = menuFetched();
    await anonPage.goto(url, { waitUntil: 'commit', timeout: PUBLIC_MENU_NAV_TIMEOUT });
    await firstFetch;

    if (!(await target.isVisible({ timeout: PUBLIC_MENU_RENDER_TIMEOUT }).catch(() => false))) {
      const retryFetch = menuFetched();
      await anonPage.reload({ waitUntil: 'commit', timeout: PUBLIC_MENU_NAV_TIMEOUT });
      await retryFetch;
    }

    await expect(target).toBeVisible({ timeout: PUBLIC_MENU_RENDER_TIMEOUT });
    await expect(anonPage.locator('body')).not.toContainText(ERROR_BOUNDARY, { timeout: 5_000 });
  } finally {
    await context.close();
  }
}
