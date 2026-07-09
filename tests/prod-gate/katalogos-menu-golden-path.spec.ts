/**
 * Gate B golden path — Katalogos (menus): create a menu, then a diner PUBLICLY
 * views it.
 *
 * Gate B (`prod-login-gate.spec.ts`) only proves the restaurateur can log in and
 * the dashboard renders. Katalogos' whole point is the OTHER side — a stranger
 * scans a QR and sees the menu. This wires that public-view golden path into the
 * prod gate: a real-UI self-serve signup creates a tenant, the welcome wizard
 * builds + the spec publishes a starter menu, and a FRESH ANONYMOUS context loads
 * the singular `/public/menu/{id}` URL and asserts the viewer renders.
 *
 * REUSE, not duplication:
 *   - The anonymous cold-load assertion is the shared `assertPublicMenuRenders`
 *     helper — the same single-cold-load, no-re-goto logic that
 *     `tests/online-menus/menu-public-anon-cold-load.spec.ts` proves at the
 *     @critical online-menus chunk level (local/staging, seeded superUser). THIS
 *     spec lifts that assertion to the prod GATE, reached via the real self-serve
 *     signup (no seeded auth in the prod-gate project).
 *   - Signup → wizard → publish → public-URL orchestration reuses the same
 *     `katalogos-signup-helpers` as `tests/prod-gate/katalogos-signup.spec.ts`;
 *     teardown reuses `signup-teardown` (the public register endpoint rejects the
 *     reserved `e2ec-` canary prefix, so the canary sweep can't reclaim it).
 *
 * NIGHTLY. The anonymous public-menu-view path is green on prod (the P1-08 fix:
 * the frontend hooks now call the VERSIONED `/api/v1/public/...` endpoints, so the
 * diner's cold anonymous load renders). Verified 2026-07-09 (this spec passed on
 * E2E_TARGET=prod). The former RUN_KATALOGOS_PUBLIC_GATE opt-in has been dropped so
 * it runs nightly alongside the other golden paths; it still self-gates on
 * KATALOGOS_BASE_URL + canary mode.
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
import { deleteSelfServeSignup, type SignupTeardownTarget } from '../../helpers/signup-teardown.js';
import { OnlineMenusPage } from '../../pages/OnlineMenusPage.js';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

const baseUrl = process.env.KATALOGOS_BASE_URL;
const GATE_TIMEOUT = 180_000;

/** Tenants/users this run created that must be deleted (populated before submit). */
const pendingCleanup: SignupTeardownTarget[] = [];

test.describe('katalogos menu golden path', () => {
  test.skip(!baseUrl, 'KATALOGOS_BASE_URL not set for this target');
  test.skip(!isCanaryMode(), 'runs only on canary (staging/prod) targets');

  // Real Keycloak/BFF + RN-web hydrate + a post-publish public-cache wait make this
  // long; a couple of retries keep it reliable for nightly. afterEach reclaims each
  // attempt's tenant so retries never accumulate orphans.
  test.describe.configure({ retries: 2 });

  test.afterEach(async () => {
    while (pendingCleanup.length > 0) {
      const target = pendingCleanup.shift();
      if (!target) break;
      const result = await deleteSelfServeSignup(target);
      process.stdout.write(
        `[menu-golden-path teardown] ${target.username ?? target.tenantName}: ` +
          `attempted=${result.attempted} tenant=${result.deletedTenant} ` +
          `users=${result.deletedUserIds.length} notes=[${result.notes.join('; ')}]\n`,
      );
    }
  });

  /** Real-UI signup that lands authenticated. Registers cleanup BEFORE submit. */
  async function signupAndLand(page: Page): Promise<SignupInput> {
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
    return input;
  }

  test('signup → wizard → publish → a diner views the menu on a cold anonymous load @ui @critical', async ({ page, browser }) => {
    test.setTimeout(GATE_TIMEOUT);

    const input = await signupAndLand(page);

    // Wizard → starter menu from a template → land in /menus.
    await completeWelcomeWizard(page, input.tenantName, input.menuName);

    // Publish: activate the starter menu.
    const menusPage = new OnlineMenusPage(page);
    await menusPage.goto();
    await menusPage.expectMenuInList(input.menuName);
    const activated = await menusPage.activateMenu(input.menuName);
    expect(activated, 'starter menu should activate (publish)').toBeTruthy();
    await menusPage.expectMenuActive(input.menuName, true);

    // THE golden path: a fresh anonymous diner cold-loads the singular public URL.
    const publicUrl = await readPublicMenuUrl(page, input.menuName);
    await assertPublicMenuRenders(browser, publicUrl, input.menuName);
  });
});
