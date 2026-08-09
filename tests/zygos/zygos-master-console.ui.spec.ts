// FINREG master console @ui (#177/#189) — what the master↔merchant CONTRACT actually RENDERS.
//
// The @api tier proves the wire; this proves the screens. It is deliberately the visual mirror of each
// @api assertion:
//
//   * the public login page reveals BOTH one-tap demo rows (master + merchant);
//   * the master overview shows each merchant by its human NAME (never the raw-GUID fallback) plus the
//     master's own tenant, with per-currency figures;
//   * "Open ▸" switches into a merchant and raises the "Operating as <name>" banner, and Exit returns
//     to the overview;
//   * the "Reset demo data" control is HIDDEN for the master and PRESENT for the merchant, and a
//     merchant hand-typing /master is bounced back to the module catalogue (the overview is master-only).
//
// Sessions are REAL server-issued cookies (the same `/bff/login` the @api tier uses), injected into the
// browser context — nothing about auth is faked. Nothing is saved, so no seed cleanup is needed.
import { expect, test } from '@playwright/test';

import {
  DEMO_CRED_IDS,
  MASTER_IDS,
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

  test('the master overview lists each merchant BY NAME (not a GUID) + the own tenant', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, '/master');
    await expect(page.locator(id(MASTER_IDS.overviewScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    for (const merchantTenant of MERCHANTS) {
      const card = page.locator(id(cardId(merchantTenant.id)));
      // The NAME renders (#187) and the raw-GUID fallback does NOT — the exact regression #187 fixed.
      await expect(card).toContainText(merchantTenant.name);
      await expect(card).not.toContainText(shortId(merchantTenant.id));
    }

    // The busiest merchant shows per-currency figures; the master's own card renders its name, un-hidden.
    await expect(page.locator(id(cardId(MERCHANTS[0].id)))).toContainText(CURRENCY_GLYPH);
    await expect(page.locator(id(cardId(MASTER_TENANT.id)))).toContainText(MASTER_TENANT.name);
  });

  test('Open ▸ a merchant raises "Operating as <name>", and Exit returns to the overview', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    const acme = MERCHANTS[0];
    await enterConsoleAs(page, master as ZygosSession, '/master');
    await expect(page.locator(id(openId(acme.id)))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });

    await page.locator(id(openId(acme.id))).click();

    const banner = page.locator(id(MASTER_IDS.impersonationBanner));
    await expect(banner).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(banner).toContainText(`Operating as ${acme.name}`);

    await page.locator(id(MASTER_IDS.impersonationExit)).click();
    await expect(page.locator(id(MASTER_IDS.overviewScreen))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(banner).toBeHidden();
  });

  test('the "Reset demo data" control is HIDDEN for the master', async ({ page }) => {
    test.skip(!master, SKIP_REASON);
    await enterConsoleAs(page, master as ZygosSession, '/modules');
    await expect(page.locator(id(MASTER_IDS.moduleCatalog))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(page.locator(id(MASTER_IDS.resetDemoButton))).toHaveCount(0);
  });

  test('a merchant sees the reset control, and /master bounces it to the module catalogue', async ({ page }) => {
    test.skip(!merchant, SKIP_REASON);
    await enterConsoleAs(page, merchant as ZygosSession, '/modules');

    // The reset control IS present for the merchant (the contrast with the master case above).
    await expect(page.locator(id(MASTER_IDS.moduleCatalog))).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    await expect(page.locator(id(MASTER_IDS.resetDemoButton))).toBeVisible();

    // A merchant hand-typing /master is redirected to the catalogue — the master overview never renders.
    await gotoScreen(page, '/master', MASTER_IDS.moduleCatalog);
    await expect(page.locator(id(MASTER_IDS.overviewScreen))).toHaveCount(0);
  });
});
