// FINREG master console @ui (#177/#189/#190) — what the master↔merchant model actually RENDERS.
//
// The @api tier proves the wire; this proves the screens. #190 turned the master's single overview into
// a mode-based shell, so this file now proves:
//
//   * the public login page reveals BOTH one-tap demo rows (master + merchant);
//   * the master sidebar is EXACTLY the five master pages + Guide — no operational module groups;
//   * the Portfolio shows each merchant by its human NAME (never the raw-GUID fallback) and EXCLUDES the
//     master's own tenant (the broken "0 / no matching payments" self-card #190 killed);
//   * "Open ▸" switches into a merchant and raises the "Operating as <name>" banner, and Exit returns;
//   * the master never sees the "Reset demo data" control; a merchant does, has NO master nav, and is
//     route-guarded off /master.
//
// The new master PAGES (Approvals, Reporting, Audit) + the operational-route guard live in the sibling
// `zygos-master-pages.ui.spec.ts` (this file caps at the 300-line limit). Sessions are REAL
// server-issued cookies injected into the browser context — nothing about auth is faked.
import { expect, test } from '@playwright/test';

import {
  DEMO_CRED_IDS,
  MASTER_IDS,
  MASTER_ROUTES,
  MASTER_TENANT,
  MERCHANTS,
  accountLabelId,
  cardId,
  enterConsoleAs,
  gotoScreen,
  id,
  masterAccount,
  merchantAccount,
  openId,
  resolveDemoAccounts,
  sessionFor,
  shortId,
  useId,
  usernameId,
} from './zygos-master.js';

import type { DemoAccount } from './zygos-master.js';
import type { ZygosSession } from './zygos-session.js';

const DESKTOP = { width: 1280, height: 900 };
const SKIP_REASON = 'Zygos console unreachable or demo accounts not published';
const REVEAL_TIMEOUT_MS = 30_000;
/** Any of the currency glyphs the per-currency lines render — proof totals are shown per currency. */
const CURRENCY_GLYPH = /€|US\$|£|CHF/;

test.describe('FINREG master console @zygos-ui @ui', () => {
  let accounts: DemoAccount[];
  let master: ZygosSession | null;
  let merchant: ZygosSession | null;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    accounts = await resolveDemoAccounts();
    master = await sessionFor(masterAccount(accounts));
    merchant = await sessionFor(merchantAccount(accounts));
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(DESKTOP);
  });

  test('the login page reveals BOTH demo accounts as one-tap rows', async ({ page }) => {
    test.skip(accounts.length < 2, SKIP_REASON);
    const masterAcc = masterAccount(accounts) as DemoAccount;
    const merchantAcc = merchantAccount(accounts) as DemoAccount;

    await page.goto('/login', { waitUntil: 'commit' });

    // Reveal the panel (the `/bff/config` fetch is slow, so wait for the disclosure control first).
    const toggle = page.locator(id(DEMO_CRED_IDS.toggle));
    await expect(toggle).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await toggle.click();

    // Row 0 = master, row 1 = merchant, each with its label, username and a "use" action.
    await expect(page.locator(id(accountLabelId(0)))).toHaveText(masterAcc.label);
    await expect(page.locator(id(usernameId(0)))).toHaveText(masterAcc.username);
    await expect(page.locator(id(useId(0)))).toBeVisible();

    await expect(page.locator(id(accountLabelId(1)))).toHaveText(merchantAcc.label);
    await expect(page.locator(id(usernameId(1)))).toHaveText(merchantAcc.username);
    await expect(page.locator(id(useId(1)))).toBeVisible();
  });

  test('the master sidebar is the five master pages + Guide, with NO operational modules', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.portfolio);
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    // The five master nav leaves + the shared Guide leaf are all present.
    for (const navId of [
      MASTER_IDS.navPortfolio,
      MASTER_IDS.navMerchants,
      MASTER_IDS.navApprovals,
      MASTER_IDS.navReporting,
      MASTER_IDS.navAudit,
      MASTER_IDS.navGuide,
    ]) {
      await expect(page.locator(id(navId))).toBeVisible();
    }

    // NONE of the operational module groups render — a master has no merchant to act on (#190).
    for (const groupId of [MASTER_IDS.navGroupCrm, MASTER_IDS.navGroupAccounting, MASTER_IDS.navGroupPayments]) {
      await expect(page.locator(id(groupId))).toHaveCount(0);
    }
  });

  test('the Portfolio lists each merchant BY NAME and EXCLUDES the master own tenant (#190)', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.portfolio);
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    for (const merchantTenant of MERCHANTS) {
      const card = page.locator(id(cardId(merchantTenant.id)));
      // The NAME renders (#187) and the raw-GUID fallback does NOT — the exact regression #187 fixed.
      await expect(card).toContainText(merchantTenant.name);
      await expect(card).not.toContainText(shortId(merchantTenant.id));
    }

    // The busiest merchant shows per-currency figures.
    await expect(page.locator(id(cardId(MERCHANTS[0].id)))).toContainText(CURRENCY_GLYPH);

    // #190 correction #1: the master's OWN tenant is NOT a merchant — no self-card renders for it.
    await expect(page.locator(id(cardId(MASTER_TENANT.id)))).toHaveCount(0);
  });

  test('the Merchants page lists merchants BY NAME and EXCLUDES the master own tenant (#190)', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.merchants);
    await expect(page.locator(id(MASTER_IDS.merchantsScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(page.locator(id(MASTER_IDS.merchantsTable))).toBeVisible();

    const table = page.locator(id(MASTER_IDS.merchantsTable));
    for (const merchantTenant of MERCHANTS) {
      await expect(table).toContainText(merchantTenant.name);
    }
    // The own-tenant row is excluded (same correction as the Portfolio).
    await expect(page.locator(id(openId(MASTER_TENANT.id)))).toHaveCount(0);
  });

  test('Open ▸ a merchant raises "Operating as <name>", and Exit returns to the Portfolio', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    const acme = MERCHANTS[0];
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.portfolio);
    await expect(page.locator(id(openId(acme.id)))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    await page.locator(id(openId(acme.id))).click();

    const banner = page.locator(id(MASTER_IDS.impersonationBanner));
    await expect(banner).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(banner).toContainText(`Operating as ${acme.name}`);
    // Mid-impersonation the master pages are hidden — the master nav leaf is gone.
    await expect(page.locator(id(MASTER_IDS.navPortfolio))).toHaveCount(0);

    await page.locator(id(MASTER_IDS.impersonationExit)).click();
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(banner).toBeHidden();
    await expect(page.locator(id(MASTER_IDS.navPortfolio))).toBeVisible();
  });

  test('the "Reset demo data" control is HIDDEN for the master', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    // A master cannot reach the module catalogue at all (route-guarded), so the reset control — which
    // lives there — is unreachable. Assert it never renders anywhere in the master shell.
    await enterConsoleAs(page, master as ZygosSession, MASTER_ROUTES.portfolio);
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(page.locator(id(MASTER_IDS.resetDemoButton))).toHaveCount(0);
  });

  test('a merchant has the reset control, NO master nav, and /master bounces to the catalogue', async ({ page }) => {
    test.skip(!merchant, SKIP_REASON);
    await enterConsoleAs(page, merchant as ZygosSession, MASTER_ROUTES.modules);

    // The reset control IS present for the merchant (the contrast with the master case above), and the
    // merchant sidebar carries the operational modules but NONE of the master nav leaves.
    await expect(page.locator(id(MASTER_IDS.moduleCatalog))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(page.locator(id(MASTER_IDS.resetDemoButton))).toBeVisible();
    await expect(page.locator(id(MASTER_IDS.navGroupPayments))).toBeVisible();
    await expect(page.locator(id(MASTER_IDS.navPortfolio))).toHaveCount(0);

    // A merchant hand-typing /master is redirected to the catalogue — the master surface never renders.
    await gotoScreen(page, MASTER_ROUTES.portfolio, MASTER_IDS.moduleCatalog);
    await expect(page.locator(id(MASTER_IDS.portfolioScreen))).toHaveCount(0);
  });
});
