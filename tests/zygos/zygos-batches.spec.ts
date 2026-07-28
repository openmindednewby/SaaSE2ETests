// Zygos payment batches @api (FINREG P-04) — the list + detail read surface.
//
// The demo tenant's batch list may legitimately be EMPTY, so nothing here asserts "there are rows".
// The list assertions pin the PAGED SHAPE (a silently un-paged list is the failure mode), and the
// detail assertions run against a batch this test creates itself, so they never depend on seed data.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ConsoleApi } from './zygos-console-client.js';
import { ZYGOS_USERS, bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto } from './zygos-client.js';
import type { PagedResponse, PaymentBatchDetailDto, PaymentBatchDto } from './zygos-console-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

test.describe('Zygos payment batches @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let instr: ZygosApi;
  let batches: ConsoleApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    makerA = await loginAs(ZYGOS_USERS.MAKER_A);
    if (makerA) {
      instr = new ZygosApi(makerA);
      batches = new ConsoleApi(makerA);
    }
  });

  test.beforeEach(() => {
    test.skip(!makerA, SKIP_REASON);
  });

  /** Create a Draft batch of one PendingApproval instruction. Returns the batch DTO. */
  async function createDraftBatch(label: string): Promise<PaymentBatchDto> {
    const tag = zygosTag(label);
    const createRes = await instr.create(instructionBody(tag));
    expect(createRes.status(), `create instruction failed: ${await bodyText(createRes)}`).toBe(201);
    const created = (await createRes.json()) as InstructionDto;
    expect((await instr.validate(created.externalId)).status()).toBe(200);
    expect((await instr.submitForApproval(created.externalId)).status()).toBe(200);

    const res = await batches.createBatch({ instructionIds: [created.externalId], failurePolicy: 'HoldForCorrection' });
    expect(res.status(), `create batch failed: ${await bodyText(res)}`).toBe(201);
    return (await res.json()) as PaymentBatchDto;
  }

  test('GET /payment-batches returns a well-formed paged envelope', async () => {
    const res = await batches.listBatches();
    const body = await bodyJson<PagedResponse<PaymentBatchDto>>(res);

    expect(res.status(), `list failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(body?.items), 'items must be an array').toBe(true);
    expect(body?.page, 'lists are 1-based').toBe(1);
    expect(body?.pageSize, 'the documented default page size').toBe(DEFAULT_PAGE_SIZE);
    expect(body?.totalCount ?? -1, 'totalCount is a non-negative integer').toBeGreaterThanOrEqual(0);
  });

  test('pageSize=101 is rejected with 400 — never silently trimmed', async () => {
    const res = await batches.listBatches('?pageSize=101');
    expect(res.status(), `over-cap pageSize must be 400; body: ${await bodyText(res)}`).toBe(400);
  });

  test('DISCRIMINATION: pageSize=100 (at the cap) is honoured', async () => {
    const res = await batches.listBatches(`?pageSize=${MAX_PAGE_SIZE}`);
    const body = await bodyJson<PagedResponse<PaymentBatchDto>>(res);
    expect(res.status(), `pageSize=100 is AT the cap and must succeed; body: ${await bodyText(res)}`).toBe(200);
    expect(body?.pageSize, 'a request at the cap is honoured exactly').toBe(MAX_PAGE_SIZE);
  });

  test('a freshly created Draft batch loads on the detail endpoint with its instruction', async () => {
    const batch = await createDraftBatch('batch-detail');

    const res = await batches.getBatch(batch.externalId);
    const detail = await bodyJson<PaymentBatchDetailDto>(res);

    expect(res.status(), `get batch failed: ${await bodyText(res)}`).toBe(200);
    expect(detail?.batch.externalId, 'the detail returns the batch we asked for').toBe(batch.externalId);
    expect(detail?.batch.status, 'a new batch is Draft').toBe('Draft');
    expect(detail?.batch.instructionIds.length, 'the batch references its one instruction').toBe(1);
    expect(detail?.instructions.length, 'the detail resolves the instruction by value').toBe(1);
  });

  test('a bogus batch id is 404, not a 200 with empty data', async () => {
    const res = await batches.getBatch('00000000-0000-0000-0000-000000000000');
    expect(res.status(), `an unknown batch must be 404; body: ${await bodyText(res)}`).toBe(404);
  });

  test('the batch list is filtered server-side by status', async () => {
    // Seed a known Draft batch, then narrow to Rejected: a Draft batch must NOT appear. If the
    // filter were ignored the row would leak through, which a status code alone cannot reveal.
    const batch = await createDraftBatch('batch-filter');

    const draftPage = await bodyJson<PagedResponse<PaymentBatchDto>>(await batches.listBatches('?status=Draft&pageSize=100'));
    const rejectedPage = await bodyJson<PagedResponse<PaymentBatchDto>>(
      await batches.listBatches('?status=Rejected&pageSize=100'),
    );

    expect(rejectedPage?.items.some((b) => b.externalId === batch.externalId), 'a Draft batch must not match status=Rejected').toBe(
      false,
    );
    // Not asserting presence in the Draft page: with a 100-row cap and an accumulating tenant the
    // batch may be off-page. The filter's EXCLUSION is the discriminating signal, and it is exact.
    expect(draftPage?.items.every((b) => b.status === 'Draft'), 'every row of a status=Draft page is Draft').toBe(true);
  });
});
