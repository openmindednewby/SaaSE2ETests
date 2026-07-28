// Zygos payment import @api (FINREG P-07) — a spreadsheet upload becomes a Draft batch, and the
// per-row report makes a partial import impossible to misread as a full one.
//
// 🔴 THE COUNTS ARE THE WHOLE POINT. "Silently accepting 497 of 500 means the operator believes
// they paid 500." So every assertion here checks what the import actually DID — the status, the
// counts, the rejections, and whether a Draft batch exists — never merely that the POST returned
// 200. A 200 with `RejectedNothingImported` and 0 imported is a SUCCESSFUL response reporting that
// NOTHING was imported; treating that as "the import worked" is the exact failure this proves against.
import { expect, test } from '@playwright/test';

import { ConsoleApi } from './zygos-console-client.js';
import { ZYGOS_USERS, bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';
import { IMPORT_HEADERS, buildXlsx } from './zygos-xlsx.js';

import type { ImportFields, PaymentBatchDetailDto, PaymentImportOutcome } from './zygos-console-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

/** A creditor IBAN that passes mod-97 (from the backend's own import integration test). */
const GOOD_IBAN = 'FR7630006000011234567890189';
/** The same IBAN with one digit flipped — fails mod-97, exactly as the backend's RejectAll test uses. */
const BAD_IBAN = 'DE89370400440532013001';
const FUNDING_IBAN = 'DE89370400440532013000';

test.describe('Zygos payment import @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let api: ConsoleApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    makerA = await loginAs(ZYGOS_USERS.MAKER_A);
    if (makerA) api = new ConsoleApi(makerA);
  });

  test.beforeEach(() => {
    test.skip(!makerA, SKIP_REASON);
  });

  function fields(policy: ImportFields['policy'], tag: string): ImportFields {
    return { fundingAccountName: 'Acme Payer Ltd', fundingIban: FUNDING_IBAN, valueDate: '2026-08-01', policy, title: tag };
  }

  test('a fully valid spreadsheet imports every row into a Draft batch', async () => {
    const tag = zygosTag('import-ok');
    const xlsx = buildXlsx(IMPORT_HEADERS, [
      [`Payee A ${tag}`, GOOD_IBAN, '100.00', 'EUR'],
      [`Payee B ${tag}`, GOOD_IBAN, '250.50', 'EUR'],
    ]);

    const res = await api.importPayments(xlsx, fields('RejectAllOnAnyInvalid', tag));
    const outcome = await bodyJson<PaymentImportOutcome>(res);

    expect(res.status(), `import failed: ${await bodyText(res)}`).toBe(200);
    expect(outcome?.status, 'a clean file imports fully').toBe('Imported');
    expect(outcome?.totalRows).toBe(2);
    expect(outcome?.importedCount).toBe(2);
    expect(outcome?.rejectedRowCount).toBe(0);
    expect(outcome?.rejections.length).toBe(0);
    expect(outcome?.batchExternalId, 'a successful import creates a batch').toBeTruthy();

    // 🔴 The created batch must be DRAFT — an import is a faster way to ASSEMBLE a run, never a side
    // door to AUTHORISE one. It enters the same central approval as a hand-built batch.
    const detailRes = await api.getBatch(outcome!.batchExternalId!);
    const detail = await bodyJson<PaymentBatchDetailDto>(detailRes);
    expect(detailRes.status(), `the import's batch must be fetchable: ${await bodyText(detailRes)}`).toBe(200);
    expect(detail?.batch.status, 'an import produces a Draft batch, never an approved one').toBe('Draft');
    expect(detail?.batch.instructionIds.length, 'every imported row became an instruction').toBe(2);
  });

  test('🔴 under the default reject-all policy, one bad row imports NOTHING — 0 imported is not success', async () => {
    const tag = zygosTag('import-rejectall');
    const xlsx = buildXlsx(IMPORT_HEADERS, [
      [`Payee A ${tag}`, GOOD_IBAN, '100.00', 'EUR'],
      [`Payee B ${tag}`, BAD_IBAN, '100.00', 'EUR'], // one bad IBAN refuses the whole file
      [`Payee C ${tag}`, GOOD_IBAN, '99.99', 'EUR'],
    ]);

    const res = await api.importPayments(xlsx, fields('RejectAllOnAnyInvalid', tag));
    const outcome = await bodyJson<PaymentImportOutcome>(res);

    // The POST succeeds (200) — but the outcome must state, unambiguously, that nothing was created.
    expect(res.status(), `import request failed: ${await bodyText(res)}`).toBe(200);
    expect(outcome?.status, 'reject-all with a bad row imports nothing').toBe('RejectedNothingImported');
    expect(outcome?.importedCount, '0 imported').toBe(0);
    expect(outcome?.batchExternalId, 'reject-all creates NO batch').toBeNull();
    expect(outcome?.rejections.length, 'the operator gets a per-row report to fix').toBeGreaterThan(0);
    // The rejection names the offending row and field — the operator can open the file at that row.
    expect(outcome?.rejections.some((r) => r.field === 'iban'), 'the bad IBAN row is reported against its field').toBe(true);
  });

  test('accept-valid imports the good rows and reports the rest — the split is stated, never silent', async () => {
    const tag = zygosTag('import-partial');
    const xlsx = buildXlsx(IMPORT_HEADERS, [
      [`Payee A ${tag}`, GOOD_IBAN, '100.00', 'EUR'],
      [`Payee B ${tag}`, BAD_IBAN, '100.00', 'EUR'],
      [`Payee C ${tag}`, GOOD_IBAN, '99.99', 'EUR'],
    ]);

    const res = await api.importPayments(xlsx, fields('AcceptValidRows', tag));
    const outcome = await bodyJson<PaymentImportOutcome>(res);

    expect(res.status(), `import failed: ${await bodyText(res)}`).toBe(200);
    expect(outcome?.status, 'the valid rows import, the split is reported').toBe('ImportedWithRejections');
    expect(outcome?.totalRows).toBe(3);
    expect(outcome?.importedCount, 'two good rows').toBe(2);
    expect(outcome?.rejectedRowCount, 'one bad row').toBe(1);
    expect(outcome?.batchExternalId, 'the valid rows form a Draft batch').toBeTruthy();

    const detail = await bodyJson<PaymentBatchDetailDto>(await api.getBatch(outcome!.batchExternalId!));
    expect(detail?.batch.status).toBe('Draft');
    expect(detail?.batch.instructionIds.length, 'only the valid rows became instructions').toBe(2);
  });

  test('a file that is not a valid .xlsx is rejected with 400, not accepted as an empty import', async () => {
    const notASpreadsheet = Buffer.from('this is plainly not a spreadsheet', 'utf-8');
    const res = await api.importPayments(notASpreadsheet, fields('RejectAllOnAnyInvalid', zygosTag('import-garbage')));
    expect(res.status(), `a corrupt upload must be 400; body: ${await bodyText(res)}`).toBe(400);
  });
});
