// FINREG payments form @ui — the PURE-CLIENT surfaces: inline IBAN/BIC validation (P-PAY-1/2),
// account-type field switching (P-PAY-3) and the FX cross-currency reveal (P-PAY-10).
//
// These are the most deterministic UI tests in the suite: they touch only the create form's own
// client state, save NOTHING, and so cannot trip maker-checker, screening or the shared tenant's
// append-only book. The form is entered as the DEMO user only because that is a real seeded login
// the browser can carry — no seeded ROW is needed; a fresh form is enough.
//
// The identifier fields render INLINE by default (a fresh form has no picked payee, so the
// <PartyFieldset> fields are editable), and errors are the shared `Field`'s `role="alert"` node —
// the same readiness signal `zygos-form-fields.ui.spec.ts` relies on. No sleeps.
import { expect, test } from '@playwright/test';

import {
  PAYMENT_FORM_IDS,
  accountTypeOption,
  enterConsoleAsDemo,
  gotoScreen,
  id,
} from './zygos-payments.js';

import type { Locator, Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };
const SKIP_REASON = 'Zygos console unreachable or demo credentials not published';

/** A structurally-invalid IBAN (country IN, non-digit check chars) — a pure client-side reject. */
const BAD_IBAN = 'INVALIDIBAN';
/** A syntactically valid German IBAN (passes mod-97) — clears the error. */
const GOOD_IBAN = 'DE89370400440532013000';
/** 6 chars — a BIC is 8 or 11, never in between. */
const BAD_BIC = 'BADBIC';

/** Error nodes inside the form whose text mentions the given word (IBAN / BIC). */
function fieldError(page: Page, word: RegExp): Locator {
  return page
    .locator(id(PAYMENT_FORM_IDS.screen))
    .locator('[role="alert"]')
    .filter({ hasText: word });
}

test.describe('FINREG payments form @zygos-ui @ui', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(DESKTOP);
    const session = await enterConsoleAsDemo(page, '/');
    test.skip(!session, SKIP_REASON);
    await gotoScreen(page, '/instructions/new', PAYMENT_FORM_IDS.screen);
  });

  test('P-PAY-1 a bad creditor IBAN shows an inline error, and a valid one clears it', async ({ page }) => {
    const iban = page.locator(id(PAYMENT_FORM_IDS.creditorIban));
    await iban.fill(BAD_IBAN);
    await iban.blur();

    await expect(
      fieldError(page, /IBAN/i),
      'a structurally invalid IBAN produced no inline error',
    ).toBeVisible();

    // Correcting it must clear the message — validation that never recovers is its own bug.
    await iban.fill(GOOD_IBAN);
    await iban.blur();
    await expect(
      fieldError(page, /IBAN/i),
      'a valid IBAN did not clear the inline error',
    ).toHaveCount(0);
  });

  test('P-PAY-2 a bad creditor BIC shows an inline error', async ({ page }) => {
    const bic = page.locator(id(PAYMENT_FORM_IDS.creditorBic));
    await bic.fill(BAD_BIC);
    await bic.blur();

    await expect(
      fieldError(page, /BIC/i),
      'a wrong-length BIC produced no inline error',
    ).toBeVisible();
  });

  test('P-PAY-3 selecting UK sort-code swaps the IBAN field for sort-code + account number', async ({ page }) => {
    // A fresh form defaults to IBAN, so the IBAN field is the starting truth.
    await expect(page.locator(id(PAYMENT_FORM_IDS.creditorIban))).toBeVisible();

    await page.locator(id(PAYMENT_FORM_IDS.creditorAccountType)).click();
    await page
      .locator(id(accountTypeOption(PAYMENT_FORM_IDS.creditorAccountType, 'DomesticSortCode')))
      .click();

    await expect(
      page.locator(id(PAYMENT_FORM_IDS.creditorSortCode)),
      'the UK sort-code field did not appear',
    ).toBeVisible();
    await expect(page.locator(id(PAYMENT_FORM_IDS.creditorAccountNumber))).toBeVisible();
    await expect(
      page.locator(id(PAYMENT_FORM_IDS.creditorIban)),
      'the IBAN field should be gone for a domestic sort-code account',
    ).toHaveCount(0);
    await expect(
      page.locator(id(PAYMENT_FORM_IDS.creditorRoutingNumber)),
      'a sort-code account must not show a US routing field',
    ).toHaveCount(0);
  });

  test('P-PAY-3 selecting US routing swaps in routing + account number', async ({ page }) => {
    await page.locator(id(PAYMENT_FORM_IDS.creditorAccountType)).click();
    await page
      .locator(id(accountTypeOption(PAYMENT_FORM_IDS.creditorAccountType, 'DomesticRouting')))
      .click();

    await expect(
      page.locator(id(PAYMENT_FORM_IDS.creditorRoutingNumber)),
      'the US routing field did not appear',
    ).toBeVisible();
    await expect(page.locator(id(PAYMENT_FORM_IDS.creditorAccountNumber))).toBeVisible();
    await expect(
      page.locator(id(PAYMENT_FORM_IDS.creditorSortCode)),
      'a routing account must not show a UK sort-code field',
    ).toHaveCount(0);
    await expect(page.locator(id(PAYMENT_FORM_IDS.creditorIban))).toHaveCount(0);
  });

  test('P-PAY-10 toggling cross-currency reveals the settlement currency, rate and amount', async ({ page }) => {
    // Hidden until asked for — a same-currency payment has no settlement leg.
    await expect(page.locator(id(PAYMENT_FORM_IDS.settlementCurrency))).toHaveCount(0);
    await expect(page.locator(id(PAYMENT_FORM_IDS.fxRate))).toHaveCount(0);
    await expect(page.locator(id(PAYMENT_FORM_IDS.settlementAmount))).toHaveCount(0);

    await page.locator(id(PAYMENT_FORM_IDS.crossCurrencyToggle)).click();

    await expect(
      page.locator(id(PAYMENT_FORM_IDS.settlementCurrency)),
      'enabling cross-currency did not reveal the settlement currency picker',
    ).toBeVisible();
    await expect(page.locator(id(PAYMENT_FORM_IDS.fxRate))).toBeVisible();
    await expect(
      page.locator(id(PAYMENT_FORM_IDS.settlementAmount)),
      'the (read-only) settlement amount field did not appear',
    ).toBeVisible();
  });
});
