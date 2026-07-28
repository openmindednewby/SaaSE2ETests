// Zygos payment schedules @api (FINREG P-08) — recurring runs, gated by a bounded standing
// authorization that a DIFFERENT user must grant.
//
// A schedule is the highest-leverage maker-checker surface: one authorization licenses many future
// payments. So the create path is proven to land in PendingAuthorization (never Active), and the
// authorize path is proven to (a) validate its bounds and (b) refuse a self-authorization while
// letting an uninvolved checker through — the same discrimination pair as the instruction/batch specs.
//
// The demo tenant may have zero schedules, so the list assertions pin only the PAGED SHAPE, and
// every detail/authorize assertion runs against a schedule this test creates itself.
import { expect, test } from '@playwright/test';

import { ConsoleApi } from './zygos-console-client.js';
import { ZYGOS_USERS, bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { CreateScheduleBody, PagedResponse, PaymentScheduleDto } from './zygos-console-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';
const DEFAULT_PAGE_SIZE = 50;
const PAYEE_IBAN = 'FR7630006000011234567890189';
const ORDERING_IBAN = 'DE89370400440532013000';
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Zygos payment schedules @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let checkerC: ZygosSession | null;
  let a: ConsoleApi;
  let c: ConsoleApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    [makerA, checkerC] = await Promise.all([loginAs(ZYGOS_USERS.MAKER_A), loginAs(ZYGOS_USERS.CHECKER_C)]);
    if (makerA) a = new ConsoleApi(makerA);
    if (checkerC) c = new ConsoleApi(checkerC);
  });

  test.beforeEach(() => {
    test.skip(!makerA || !checkerC, SKIP_REASON);
  });

  /** Create a payee party (a schedule holds a LIVE reference to it) and return its externalId. */
  async function payeePartyId(tag: string): Promise<string> {
    const res = await a.createParty({ name: `Payee ${tag}`, country: 'FR', kind: 'Counterparty', iban: PAYEE_IBAN });
    expect(res.status(), `create party failed: ${await bodyText(res)}`).toBe(201);
    return ((await res.json()) as { externalId: string }).externalId;
  }

  function scheduleBody(payeeId: string, tag: string): CreateScheduleBody {
    return {
      payeePartyExternalId: payeeId,
      amount: 500,
      currency: 'EUR',
      direction: 'Outgoing',
      frequency: 'Monthly',
      dayOfMonth: 15,
      startDate: '2026-09-01',
      orderingAccount: { name: `Payer ${tag}`, iban: ORDERING_IBAN, country: 'DE' },
      title: tag,
      remittanceInfo: tag,
    };
  }

  /** Create a schedule as maker-a; assert it lands in PendingAuthorization. Returns its DTO. */
  async function createSchedule(tag: string): Promise<PaymentScheduleDto> {
    const payeeId = await payeePartyId(tag);
    const res = await a.createSchedule(scheduleBody(payeeId, tag));
    expect(res.status(), `create schedule failed: ${await bodyText(res)}`).toBe(201);
    const dto = (await res.json()) as PaymentScheduleDto;
    expect(dto.status, 'a new schedule awaits a checker — never born Active').toBe('PendingAuthorization');
    return dto;
  }

  test('GET /payment-schedules returns a well-formed paged envelope', async () => {
    const res = await a.listSchedules();
    const body = await bodyJson<PagedResponse<PaymentScheduleDto>>(res);
    expect(res.status(), `list failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(body?.items), 'items must be an array').toBe(true);
    expect(body?.page).toBe(1);
    expect(body?.pageSize, 'the documented default page size').toBe(DEFAULT_PAGE_SIZE);
    expect(body?.totalCount ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('pageSize=101 is rejected with 400', async () => {
    const res = await a.listSchedules('?pageSize=101');
    expect(res.status(), `over-cap pageSize must be 400; body: ${await bodyText(res)}`).toBe(400);
  });

  test('a created schedule loads on the detail endpoint; a bogus id is 404', async () => {
    const schedule = await createSchedule(zygosTag('sched-detail'));

    const res = await a.getSchedule(schedule.externalId);
    const detail = await bodyJson<PaymentScheduleDto>(res);
    expect(res.status(), `get schedule failed: ${await bodyText(res)}`).toBe(200);
    expect(detail?.externalId).toBe(schedule.externalId);
    expect(detail?.status).toBe('PendingAuthorization');
    expect(detail?.standingAuthorization, 'a pending schedule has no standing authorization yet').toBeNull();

    const missing = await a.getSchedule(UNKNOWN_ID);
    expect(missing.status(), `an unknown schedule must be 404; body: ${await bodyText(missing)}`).toBe(404);
  });

  test('create validation rejects an empty payee, a bad currency, and an out-of-range day', async () => {
    const payeeId = await payeePartyId(zygosTag('sched-invalid'));

    const noPayee = await a.createSchedule({ ...scheduleBody(payeeId, 'x'), payeePartyExternalId: UNKNOWN_ID });
    expect(noPayee.status(), 'an empty payee guid is a 400').toBe(400);

    const badCurrency = await a.createSchedule({ ...scheduleBody(payeeId, 'x'), currency: 'EURO' });
    expect(badCurrency.status(), 'a non-3-letter currency is a 400').toBe(400);

    const badDay = await a.createSchedule({ ...scheduleBody(payeeId, 'x'), dayOfMonth: 40 });
    expect(badDay.status(), 'a monthly day-of-month above 31 is a 400').toBe(400);
  });

  test('authorize validation rejects a non-positive ceiling and a bad currency', async () => {
    const schedule = await createSchedule(zygosTag('sched-auth-invalid'));

    const zeroCeiling = await a.authorizeSchedule(schedule.externalId, {
      amountCeiling: 0,
      ceilingCurrency: 'EUR',
      expiresOn: '2027-01-01',
    });
    expect(zeroCeiling.status(), 'a zero ceiling authorises nothing — 400').toBe(400);

    const badCurrency = await a.authorizeSchedule(schedule.externalId, {
      amountCeiling: 1000,
      ceilingCurrency: 'EURO',
      expiresOn: '2027-01-01',
    });
    expect(badCurrency.status(), 'a non-3-letter ceiling currency is a 400').toBe(400);
  });

  test('authorizing an unknown schedule (with a valid body) is 404', async () => {
    const res = await a.authorizeSchedule(UNKNOWN_ID, { amountCeiling: 1000, ceilingCurrency: 'EUR', expiresOn: '2027-01-01' });
    expect(res.status(), `an unknown schedule must be 404; body: ${await bodyText(res)}`).toBe(404);
  });

  test('🔴 the schedule creator CANNOT authorize their own schedule — an uninvolved checker CAN', async () => {
    const schedule = await createSchedule(zygosTag('sched-mc'));
    const bounds = { amountCeiling: 5000, ceilingCurrency: 'EUR', expiresOn: '2027-06-30' };

    // ── The control: maker-a created it ⇒ a contributor ⇒ refused. ──
    const refused = await a.authorizeSchedule(schedule.externalId, bounds);
    const refusedBody = await bodyText(refused);
    expect(refused.status(), `the creator must be refused with 403; body: ${refusedBody}`).toBe(403);
    expect(refusedBody, `the 403 must be a maker-checker refusal, not CSRF/auth; body: ${refusedBody}`).toContain(
      'Maker-checker violation',
    );

    // ── The discrimination proof: SAME schedule, SAME bounds, uninvolved checker succeeds. ──
    const granted = await c.authorizeSchedule(schedule.externalId, bounds);
    expect(
      granted.status(),
      `checker-c MUST authorize — otherwise the creator's 403 proves nothing; body: ${await bodyText(granted)}`,
    ).toBe(200);
    const active = (await granted.json()) as PaymentScheduleDto;
    expect(active.status, 'a granted authorization activates the schedule').toBe('Active');
    expect(active.standingAuthorization?.amountCeiling, 'the granted bounds are recorded').toBe(5000);
  });
});
