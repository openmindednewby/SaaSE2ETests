// Zygos list query @api (ZY-18) — the page cap and the canonical filter shape (contract §3).
//
// Both controls here share a nasty property: WHEN THEY FAIL, THEY FAIL WITH A 200. A silently
// trimmed page and a silently-empty filter are both "successful" responses carrying the wrong
// data. So no test in this file may assert on a status code alone — each asserts what the server
// actually DID with the request.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_USERS, bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto, PagedInstructions } from './zygos-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

/** Contract §3: `pageSize` defaults to 50, hard maximum 100; above that is a 400. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

test.describe('Zygos list query @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let a: ZygosApi;

  test.beforeAll(async () => {
    // The login budget (5/60s per IP) is shared by the whole run, so a COLD start — where no
    // session is parked yet — can legitimately hit a 429 and must wait the window out. The
    // default 30s hook timeout is shorter than that window, which would turn a transient
    // throttle into a hard beforeAll failure and cascade-fail the file. `loginAs` polls; this
    // gives it room to. On a warm run every session comes from playwright/.auth/ and this costs
    // nothing.
    test.setTimeout(180_000);
    makerA = await loginAs(ZYGOS_USERS.MAKER_A);
    if (makerA) a = new ZygosApi(makerA);
  });

  test.beforeEach(() => {
    test.skip(!makerA, SKIP_REASON);
  });

  /**
   * Fetch a page. `body` is the PARSED response; `raw` is a truncated copy for failure messages.
   *
   * They come from different helpers on purpose: `bodyText` truncates at 500 chars, so parsing it
   * yields "Unterminated string in JSON" on any real page — a self-inflicted error that reads
   * exactly like a server fault. (It did, twice, while writing this file.) Parse `bodyJson`;
   * print `bodyText`.
   */
  async function page(query: string): Promise<{ status: number; body: PagedInstructions | null; raw: string }> {
    const res = await a.list(query);
    const [body, raw] = await Promise.all([bodyJson<PagedInstructions>(res), bodyText(res)]);
    return { status: res.status(), body, raw };
  }

  test.describe('🔴 the page cap (contract §3)', () => {
    // "pageSize: default 50, max 100. > 100 → 400. Never honoured."
    //
    // The contract is emphatic that over-cap is a REJECTION, not a trim, and the backend's own
    // validator says why in as many words: "Trimming would be friendlier and wrong: a client that
    // asks for 1,000 and receives 100 without being told will happily build a feature on the
    // assumption it got all of them."
    //
    // Measured reason (ZY-02 spike): ~2–3 ms/row ⇒ 100 rows = 367 ms, 5,000 rows = 14 s.
    // A big page is indistinguishable from an outage.

    test('pageSize=101 is REJECTED with 400 — never silently trimmed', async () => {
      const { status, body, raw } = await page('?pageSize=101');

      expect(status, `pageSize=101 must be 400 per contract §3; got ${status}, body: ${raw}`).toBe(400);
      // If the server ever answers 200 here, this pins the exact failure mode the contract
      // forbids: a trimmed page presented as a complete one.
      expect(
        body?.pageSize,
        'an over-cap request must not be answered with a quietly trimmed page — the client is never told it did not get what it asked for',
      ).toBeUndefined();
    });

    test('pageSize=1000 is REJECTED with 400', async () => {
      const { status, raw } = await page('?pageSize=1000');
      expect(status, `pageSize=1000 must be 400 per contract §3; got ${status}, body: ${raw}`).toBe(400);
    });

    test('DISCRIMINATION: pageSize=100 (at the cap) is honoured with 200', async () => {
      // Without this leg, the two 400s above are equally consistent with "the endpoint 400s
      // everything" — which would be a broken list, not an enforced cap. The cap only means
      // something if the boundary value works.
      const { status, body, raw } = await page(`?pageSize=${MAX_PAGE_SIZE}`);

      expect(status, `pageSize=100 is AT the cap and must succeed; body: ${raw}`).toBe(200);
      expect(body?.pageSize, 'a request at the cap must be honoured exactly').toBe(MAX_PAGE_SIZE);
    });

    test('the default page size is 50 when unasked', async () => {
      const { status, body, raw } = await page('');
      expect(status, `an unfiltered list must succeed; body: ${raw}`).toBe(200);
      expect(body?.pageSize, 'the documented default').toBe(DEFAULT_PAGE_SIZE);
    });

    test('page=0 is rejected — pages are 1-based', async () => {
      const { status, raw } = await page('?page=0');
      expect(status, `page=0 must be 400 (page must be 1 or greater); got ${status}, body: ${raw}`).toBe(400);
    });
  });

  test.describe('🔴 Statuses is a PLURAL, REPEATED param — never an array-encoded one', () => {
    // Contract §3 pins this after the two halves diverged (backend `Statuses` plural vs frontend
    // `status` singular) and every filter silently matched nothing.
    //
    // The trap: `Statuses[]=Draft` binds EMPTY server-side ⇒ `Statuses ?? []` ⇒ NO status filter
    // ⇒ the query matches EVERYTHING, with a 200. A test that only checks the status code cannot
    // see the difference between "filtered correctly" and "filter silently ignored".

    /** Create one instruction and drive it to a known status, tagged so it is findable forever. */
    async function seedTagged(): Promise<{ tag: string; instruction: InstructionDto }> {
      const tag = zygosTag('list-filter');
      const res = await a.create(instructionBody(tag));
      expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);
      return { tag, instruction: (await res.json()) as InstructionDto };
    }

    test('Statuses=Draft narrows to Draft — and the tagged row is found', async () => {
      const { tag } = await seedTagged();

      // Search by the unique tag so accumulated rows (and the incoming demo seed) cannot affect
      // the assertion. See zygos-helpers.zygosTag: instructions can never be deleted.
      const { status, body, raw } = await page(`?Search=${encodeURIComponent(tag)}&Statuses=Draft`);

      expect(status, `filtered list failed; body: ${raw}`).toBe(200);
      expect(body?.totalCount, 'the freshly created Draft must match a Draft filter').toBe(1);
      expect(body?.items[0]?.status).toBe('Draft');
    });

    test('DISCRIMINATION: Statuses=Approved excludes the same Draft row', async () => {
      const { tag } = await seedTagged();

      // The same Search, a different status. If the filter were ignored, this would return the
      // row anyway — which is precisely the silent failure mode. This pair is what proves
      // `Statuses` actually filters rather than merely being accepted.
      const { status, body, raw } = await page(`?Search=${encodeURIComponent(tag)}&Statuses=Approved`);

      expect(status, `filtered list failed; body: ${raw}`).toBe(200);
      expect(body?.totalCount, 'a Draft row must NOT match Statuses=Approved — if it does, the filter is being ignored').toBe(0);
    });

    test('Statuses repeats to mean OR — Draft or Validated', async () => {
      const { tag } = await seedTagged();

      // The whole reason the plural shape is canonical: "show me PendingApproval OR Validated"
      // is what an operator actually wants.
      const { status, body, raw } = await page(
        `?Search=${encodeURIComponent(tag)}&Statuses=Draft&Statuses=Validated`,
      );

      expect(status, `repeated Statuses failed; body: ${raw}`).toBe(200);
      expect(body?.totalCount, 'a Draft row must match (Draft OR Validated)').toBe(1);
    });

    test('🔴 the array-encoded form Statuses[]= binds EMPTY and matches everything — the documented trap', async () => {
      const { tag } = await seedTagged();

      // Prove the trap is real rather than folklore, and pin it so nobody "fixes" the client to
      // emit `Statuses[]=` and quietly disables every status filter in the product.
      //
      // `Statuses[]=Approved` should match NOTHING (the row is Draft). If it matches the row,
      // the param bound empty and the filter was silently dropped.
      const wrong = await page(`?Search=${encodeURIComponent(tag)}&${encodeURIComponent('Statuses[]')}=Approved`);
      const right = await page(`?Search=${encodeURIComponent(tag)}&Statuses=Approved`);

      expect(right.body?.totalCount, 'the correct encoding excludes the Draft row').toBe(0);
      expect(
        wrong.body?.totalCount,
        'ARRAY-ENCODED `Statuses[]=` BINDS EMPTY: the status filter is silently dropped and the query matches everything. ' +
          'It returns 200, so only the row count reveals it. Never emit this encoding.',
      ).toBe(1);
    });
  });
});
