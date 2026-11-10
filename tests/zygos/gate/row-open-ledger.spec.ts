import { expect, test } from '@playwright/test';

import { ModulesApi } from '../zygos-console-modules.js';
import { ZYGOS_USERS, bodyText, zygosTag } from '../zygos-helpers.js';
import { loginAs } from '../zygos-session.js';
import { VIEWPORTS, enterAs, sight } from './finreg-gate.js';
import { expectRowAffordances } from './row-open-check.js';

import type { AccountDto } from '../zygos-console-modules.js';

const LEDGER_ROW = '[data-testid^="zygos-account-ledger-table-fade-"] [data-testid^="zygos-account-ledger-table-row-"]';
const JOURNAL_URL = /\/accounting\/journals\//;
const SEED_AMOUNT = 100;

let cashAccountId = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const session = await loginAs(ZYGOS_USERS.ADMIN);
  expect(session, 'zygos-admin session').not.toBeNull();
  const api = new ModulesApi(session!);
  const create = async (label: string, type: AccountDto['type']): Promise<AccountDto> => {
    const code = zygosTag(label);
    const res = await api.createAccount({ code, name: `ROW-OPEN-1 ${label} ${code}`, type });
    expect(res.status(), `create account: ${await bodyText(res)}`).toBe(201);
    return (await res.json()) as AccountDto;
  };
  const cash = await create('cash', 'Asset');
  const revenue = await create('income', 'Income');
  const posted = await api.postJournalEntry({
    entryDate: new Date().toISOString().slice(0, 10),
    lines: [
      { accountCode: cash.code, direction: 'Debit', amount: SEED_AMOUNT, currency: 'EUR' },
      { accountCode: revenue.code, direction: 'Credit', amount: SEED_AMOUNT, currency: 'EUR' },
    ],
    reference: cash.code,
    description: `ROW-OPEN-1 seed ${cash.code}`,
  });
  expect(posted.status(), `post journal: ${await bodyText(posted)}`).toBeLessThan(300);
  const dto = cash;
  cashAccountId = dto.externalId;
  expect(cashAccountId, 'seeded account id').not.toBe('');
});

for (const vp of VIEWPORTS) {
  test.describe(`ROW-OPEN-1 FinReg ledger at ${vp.label} @finreg-gate`, () => {
    test.use(vp.use);

    test(`ROW-OPEN-1 seeded ledger line as Admin at ${vp.label}, pointer, tint, focus ring, Enter opens its journal`, async ({ page }) => {
      await enterAs(page, ZYGOS_USERS.ADMIN, `/accounting/accounts/${cashAccountId}`);
      const row = page.locator(LEDGER_ROW).first();
      await sight(page, 'ROW-OPEN-1', `finreg-ledger-${vp.label}`);

      await expectRowAffordances(page, row);

      await expect(page, 'Enter on a ledger line opens its journal').toHaveURL(JOURNAL_URL, { timeout: 20_000 });
    });

    test(`ROW-OPEN-1 seeded ledger line as Admin at ${vp.label}, click opens its journal`, async ({ page }) => {
      await enterAs(page, ZYGOS_USERS.ADMIN, `/accounting/accounts/${cashAccountId}`);
      const row = page.locator(LEDGER_ROW).first();
      await expect(row).toBeVisible({ timeout: 20_000 });

      await row.click();

      await expect(page, 'click on a ledger line opens its journal').toHaveURL(JOURNAL_URL, { timeout: 20_000 });
    });
  });
}
