/**
 * P1-08 — Katalogos self-serve signup journey (real UI) + honeypot.
 *
 * The product's most important test: a stranger goes from the marketing page to
 * a PUBLISHED, publicly-viewable menu with zero founder involvement. Runs in the
 * prod-gate project against the live/staging URL (`KATALOGOS_BASE_URL` per
 * `E2E_TARGET`).
 *
 * A completed signup creates a REAL tenant + Keycloak user that the canary sweep
 * canNOT reclaim: the public register endpoint rejects the reserved `e2ec-…`
 * prefix by design (`MustNotMatchReservedPrefix`). So this spec owns its own
 * teardown — `helpers/signup-teardown.ts` deletes each created tenant + user via
 * the admin API (authenticated with the canary superUser token minted in
 * global-setup). Teardown runs in `afterEach` (the safety net for a mid-test
 * failure) AND explicitly in-test (which then ASSERTS no orphan remains).
 *
 * Tests:
 *  1. Immediate-access signup lands authenticated + self-teardown (DEFAULT) —
 *     the working, nightly-guarded happy path (the P1-08 fix: the shared BFF
 *     mints a session on register instead of throwing "missing user").
 *  2. Full journey: signup → wizard → publish → public URL (OPT-IN) — the full
 *     DoD. Both earlier prod blockers are fixed in code (owner→`admin` authz,
 *     deployed; the wizard `x.map` crash from an unversioned menu-templates URL,
 *     fixed in katalogos-web). Stays opt-in until the katalogos-web fix is
 *     REDEPLOYED + verified green, then the gate drops (see the test's comment).
 *  3. Entry point — navbar "Register" CTA reaches `/register` (OPT-IN: flaky
 *     RN-web nav click).
 *  4. Honeypot — a filled hidden `website` field is refused (no session).
 */
import { test, expect, type Page } from '@playwright/test';

import { isCanaryMode } from '../../helpers/canary-prefix.js';
import {
  assertPublicMenuRenders,
  completeWelcomeWizard,
  ERROR_BOUNDARY,
  fillAndSubmitRegister,
  LANDING_TIMEOUT,
  readPublicMenuUrl,
  seedClientState,
  uniqueSignup,
  type SignupInput,
} from '../../helpers/katalogos-signup-helpers.js';
import {
  deleteSelfServeSignup,
  selfServeSignupExists,
  type SignupTeardownTarget,
} from '../../helpers/signup-teardown.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

const baseUrl = process.env.KATALOGOS_BASE_URL;

/**
 * Tenants/users this run created that must be deleted. Populated the moment a
 * signup is submitted (before it can fail) so `afterEach` cleans up even when a
 * test aborts mid-flow. The tenant-creating tests also drain + assert on their
 * own entry in-test.
 */
const pendingCleanup: SignupTeardownTarget[] = [];

test.describe('katalogos self-serve signup', () => {
  test.skip(!baseUrl, 'KATALOGOS_BASE_URL not set for this target');
  test.skip(!isCanaryMode(), 'runs only on canary (staging/prod) targets');

  // Real Keycloak/BFF + RN-web hydrate + a public-cache wait make these long. A
  // couple of retries keep them reliable for nightly; afterEach cleans up every
  // attempt's tenant, so retries never accumulate orphans.
  test.describe.configure({ retries: 2 });

  test.afterEach(async () => {
    // Safety net: delete anything a (possibly failed) test created. Never throws
    // — a teardown must not mask the test result.
    while (pendingCleanup.length > 0) {
      const target = pendingCleanup.shift();
      if (!target) break;
      const result = await deleteSelfServeSignup(target);
      process.stdout.write(
        `[signup-teardown] ${target.username ?? target.tenantName}: ` +
          `attempted=${result.attempted} tenant=${result.deletedTenant} ` +
          `users=${result.deletedUserIds.length} notes=[${result.notes.join('; ')}]\n`,
      );
    }
  });

  /**
   * Real-UI signup that lands on an authenticated route. Registers the created
   * identity for cleanup BEFORE submit (a tenant may exist from here on).
   */
  async function signupAndLand(page: Page): Promise<{ input: SignupInput; target: SignupTeardownTarget; consoleErrors: string[] }> {
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

    const input = uniqueSignup();
    const target: SignupTeardownTarget = { tenantName: input.tenantName, username: input.username };

    await seedClientState(page);
    await page.goto(`${baseUrl!.replace(/\/$/, '')}/register`, { waitUntil: 'domcontentloaded' });
    await page.locator(testIdSelector(TestIds.REGISTER_USERNAME_INPUT)).waitFor({ state: 'visible', timeout: 30_000 });
    pendingCleanup.push(target);

    await Promise.all([
      page.waitForURL((url) => !/\/(register|login)/.test(url.pathname), { timeout: LANDING_TIMEOUT }),
      fillAndSubmitRegister(page, input),
    ]);
    await expect(page.locator('body')).not.toContainText(ERROR_BOUNDARY, { timeout: 10_000 });
    return { input, target, consoleErrors };
  }

  /** Delete the signup and assert no tenant/user orphan remains (in-test proof). */
  async function teardownAndAssertClean(target: SignupTeardownTarget): Promise<void> {
    const teardown = await deleteSelfServeSignup(target);
    expect(teardown.attempted, `teardown skipped: ${teardown.notes.join('; ')}`).toBeTruthy();
    const idx = pendingCleanup.indexOf(target);
    if (idx >= 0) pendingCleanup.splice(idx, 1);

    const remaining = await selfServeSignupExists(target);
    expect(remaining.tenantFound, `tenant orphan remains: ${remaining.notes.join('; ')}`).toBeFalsy();
    expect(remaining.userFound, `user orphan remains: ${remaining.notes.join('; ')}`).toBeFalsy();
  }

  // DEFAULT (canary) — the working, nightly-guarded path: a stranger's real-UI
  // signup establishes a session with no console errors, then is fully cleaned
  // up (proving the signup-teardown is nightly-safe on the happy path).
  test('immediate-access signup lands authenticated + self-teardown leaves no orphan @ui @critical', async ({ page }) => {
    test.setTimeout(120_000);
    const { target, consoleErrors } = await signupAndLand(page);

    const realErrors = consoleErrors.filter(
      (e) => !/locize\.com|i18next is maintained|status of 40[13]\b/i.test(e),
    );
    expect(realErrors, `console errors on landing: ${realErrors.join(' | ')}`).toEqual([]);

    await teardownAndAssertClean(target);
  });

  // The full DoD journey — NOW A NIGHTLY GATE (verified green on prod 2026-07-08).
  // Three prod blockers were found + fixed to get here: (1) the owner-role authz
  // gap (self-serve creator now gets `admin`); (2) the WelcomeWizard `x.map` crash
  // (`useMenuTemplates` hit the unversioned `/api/menu-templates` → SPA HTML →
  // `templates.map` threw; fixed to versioned `/api/v1/menu-templates` + array
  // guard); and (3) the anonymous public-menu 401 — the OnlineMenu API applies a
  // global FastEndpoints `api/v1` prefix, so `usePublicMenuGetById` calling the
  // UNVERSIONED `/public/menus/{id}` matched no route and was fallback-401'd
  // (fixed to `/api/v1/public/menus/{id}`; same for public dietary-tags). All three
  // are deployed + green, so this runs every night now. It creates a REAL tenant
  // per run that afterEach + in-test teardown reclaim (canary sweep can't — the
  // public register path rejects the reserved `e2ec-` prefix).
  test('full journey: signup → wizard → publish → public menu URL renders @ui @critical', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { input, target } = await signupAndLand(page);

    // Wizard → starter menu from a template → land in /menus.
    await completeWelcomeWizard(page, input.tenantName, input.menuName);

    // Publish: activate the starter menu.
    const menusPage = new OnlineMenusPage(page);
    await menusPage.goto();
    await menusPage.expectMenuInList(input.menuName);
    const activated = await menusPage.activateMenu(input.menuName);
    expect(activated, 'starter menu should activate (publish)').toBeTruthy();
    await menusPage.expectMenuActive(input.menuName, true);

    // Public URL renders for an anonymous diner.
    const publicUrl = await readPublicMenuUrl(page, input.menuName);
    await assertPublicMenuRenders(browser, publicUrl, input.menuName);

    await teardownAndAssertClean(target);
  });

  test('entry point: the navbar "Create account" CTA renders the register screen', async ({ page }) => {
    test.skip(
      process.env.RUN_SIGNUP_JOURNEY !== '1',
      'RN-web nav-button click is flaky under Playwright; opt in with RUN_SIGNUP_JOURNEY=1',
    );
    await seedClientState(page);
    await page.goto(baseUrl!.replace(/\/$/, ''), { waitUntil: 'domcontentloaded' });
    const registerCta = page.locator(testIdSelector(TestIds.LANDING_NAV_REGISTER_BUTTON)).first();
    await registerCta.scrollIntoViewIfNeeded().catch(() => undefined);
    await registerCta.click({ force: true });
    await page.waitForURL(/\/register/, { timeout: 20_000 });
    await expect(page.locator(testIdSelector(TestIds.REGISTER_USERNAME_INPUT))).toBeVisible({ timeout: 30_000 });
  });

  test('honeypot: a filled hidden field is refused (no session)', async ({ page }) => {
    await seedClientState(page);
    await page.goto(`${baseUrl!.replace(/\/$/, '')}/register`, { waitUntil: 'domcontentloaded' });
    await page.locator(testIdSelector(TestIds.REGISTER_USERNAME_INPUT)).waitFor({ state: 'visible', timeout: 30_000 });

    await fillAndSubmitRegister(page, uniqueSignup('http://bot.example'));

    // The client refuses synchronously (no request, no navigation), so the
    // register form stays put — a regression that let the bot through would
    // navigate away to an authed route.
    await expect(page.locator(testIdSelector(TestIds.REGISTER_SUBMIT_BUTTON))).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });
});
