// Zygos tampering @api (ZY-18) — "make it unrepresentable, not merely rejected" (contract §3).
//
// The create/edit DTOs have no `feeAmount`, no `status`, no `reference`, no `idempotencyKey`;
// `submit` takes no body at all. This spec is the ADVERSARY: it sends those fields anyway and
// proves the server does not care. A field that isn't in the DTO can't be validated wrong,
// can't be forgotten in a later refactor, and can't be re-enabled by a config flag — which is
// exactly why absence is a stronger control than rejection.
//
// 🔴 Note the assertion style throughout: it is never "the request was rejected". A tampered
// field being IGNORED is a pass; the test asserts the RESULTING RECORD, because that is the
// thing the tampering was trying to change. `400` and `201-but-ignored` are both fine. `201`
// with the attacker's value on the record is not.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_USERS, bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { InstructionDto } from './zygos-client.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe('Zygos tampering is unrepresentable @zygos-api @api', () => {
  let makerA: ZygosSession | null;
  let checkerC: ZygosSession | null;
  let a: ZygosApi;
  let c: ZygosApi;

  test.beforeAll(async () => {
    // The login budget (5/60s per IP) is shared by the whole run, so a COLD start — where no
    // session is parked yet — can legitimately hit a 429 and must wait the window out. The
    // default 30s hook timeout is shorter than that window, which would turn a transient
    // throttle into a hard beforeAll failure and cascade-fail the file. `loginAs` polls; this
    // gives it room to. On a warm run every session comes from playwright/.auth/ and this costs
    // nothing.
    test.setTimeout(180_000);
    [makerA, checkerC] = await Promise.all([loginAs(ZYGOS_USERS.MAKER_A), loginAs(ZYGOS_USERS.CHECKER_C)]);
    if (makerA && checkerC) {
      a = new ZygosApi(makerA);
      c = new ZygosApi(checkerC);
    }
  });

  test.beforeEach(() => {
    test.skip(!makerA || !checkerC, SKIP_REASON);
  });

  test('🔴 a client-supplied feeAmount is ignored — the fee is server-derived', async () => {
    const tag = zygosTag('tamper-fee');

    // The fee is derived from the tenant's TenantConfig rows. A client that names its own fee is
    // the Agora ES-06 shape; the answer is that there is no field to name it with.
    const res = await a.create({ ...instructionBody(tag), feeAmount: 999_999.99 });
    expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);

    const dto = (await res.json()) as InstructionDto;
    expect(dto.feeAmount, 'a client-supplied feeAmount must never reach the record').not.toBe(999_999.99);
  });

  test('🔴 a client-supplied status is ignored — a new instruction is always Draft', async () => {
    const tag = zygosTag('tamper-status');

    // If this were honoured, an instruction could be born Approved and skip maker-checker
    // entirely — the whole state machine bypassed by one JSON field.
    const res = await a.create({ ...instructionBody(tag), status: 'Approved' });
    expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);

    const dto = (await res.json()) as InstructionDto;
    expect(dto.status, 'status moves ONLY via the transition endpoints — never from a create body').toBe('Draft');
  });

  test('a client-supplied reference is ignored — references are allocated server-side', async () => {
    const tag = zygosTag('tamper-ref');

    const res = await a.create({ ...instructionBody(tag), reference: 'ZY-1999-9999999' });
    expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);

    const dto = (await res.json()) as InstructionDto;
    expect(dto.reference, 'the reference is server-allocated and unique per tenant').not.toBe('ZY-1999-9999999');
    expect(dto.reference).toMatch(/^ZY-\d{4}-\d+$/);
  });

  test('a client-supplied idempotencyKey is ignored — it is minted once, at Submit', async () => {
    const tag = zygosTag('tamper-idem');

    // The key is THE control that stops a retry paying twice. A client that could choose it
    // could collide two different payments onto one key, or force a fresh key on a retry.
    const res = await a.create({ ...instructionBody(tag), idempotencyKey: 'attacker-chosen-key' });
    expect(res.status(), `create failed: ${await bodyText(res)}`).toBe(201);

    const dto = (await res.json()) as InstructionDto;
    expect(dto.idempotencyKey, 'no key exists before Submitted, whatever the client sends').toBeNull();
  });

  test('🔴 the client cannot name the provider its own payment leaves on', async () => {
    // Contract §3, added 2026-07-17 by ZY-13:
    //   "no ProviderCode, anywhere … the client named the rail its own payment left on, past
    //    whatever the tenant had configured. Same hole as a client-supplied fee, same answer:
    //    the provider is derived from RoutingRule rows and the endpoint now takes NO BODY AT ALL.
    //    There is nothing to tamper with and nothing to validate, which is the strongest version
    //    of this rule."
    //
    // So: submitting WITH `{providerCode}` must not put the payment on the client's chosen rail.
    // Either the body is refused, or it is ignored and routing picks the provider — but the
    // attacker's value must never end up on the record.
    const tag = zygosTag('tamper-provider');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    expect((await a.validate(created.externalId)).status()).toBe(200);
    expect((await a.submitForApproval(created.externalId)).status()).toBe(200);
    expect((await c.approve(created.externalId)).status()).toBe(200);

    const res = await a.submitWithBody(created.externalId, { providerCode: 'attacker-rail' });
    const body = await bodyText(res);

    // The record is the evidence, not the status code.
    if (res.status() === 200) {
      const dto = (await bodyJson<InstructionDto>(res))!;
      expect(
        dto.providerCode,
        'THE CLIENT NAMED THE RAIL ITS OWN PAYMENT LEFT ON. `submit` must take no body and derive the ' +
          'provider from the tenant\'s RoutingRule rows (contract §3 / ZY-13). A client-chosen provider ' +
          'routes a payment past whatever the tenant configured.',
      ).not.toBe('attacker-rail');
    } else {
      // A refusal is also a correct answer — the field simply does not exist.
      expect([400, 415], `submit with a body should be refused or ignored, not ${res.status()}; body: ${body}`).toContain(
        res.status(),
      );
    }
  });

  test('the approver is taken from the session, never from the request', async () => {
    // If a client could name the approver, segregation of duties would be an honour system.
    // `approve` is EndpointWithoutRequest — the approver comes from the validated JWT.
    const tag = zygosTag('tamper-approver');
    const created = (await (await a.create(instructionBody(tag))).json()) as InstructionDto;

    expect((await a.validate(created.externalId)).status()).toBe(200);
    expect((await a.submitForApproval(created.externalId)).status()).toBe(200);

    // A (a contributor) tries to approve while claiming to be C. It must still be refused —
    // the body is not consulted.
    const res = await makerA!.context.post(
      `/bff/api/zygos/api/v1/payment-instructions/${created.externalId}/approve`,
      {
        headers: { 'X-BFF-Csrf': '1', Origin: 'https://app.zygos.dloizides.com', 'Content-Type': 'application/json' },
        data: { approverUserId: '00000000-0000-0000-0000-000000000001', userId: 'zygos-checker-c' },
      },
    );

    expect(
      res.status(),
      `naming another approver in the body must not grant approval; body: ${await bodyText(res)}`,
    ).not.toBe(200);
  });
});
