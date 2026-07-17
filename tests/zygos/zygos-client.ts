// A thin typed client over zygos-api, as reached THROUGH the BFF (ZY-18).
//
// Every shape here is taken from the C# in `zygos/backend/src/Zygos.Web/PaymentInstructions/`
// and `Zygos.Core/PaymentInstructionAggregate/` — the source of truth — never from zygos-web's
// TypeScript. The agora precedent: that frontend's types were written against an imagined
// server and were wrong in 13 places.
//
// 🔴 THE WIRE FORMAT IS camelCase PROPERTIES + PascalCase ENUM VALUES.
// Not a typo, and not tidy. `MiddlewareConfig.cs` registers a bare `new JsonStringEnumConverter()`
// with NO naming policy, so enum *values* serialize verbatim (`"Draft"`, `"PendingApproval"`),
// while `PropertyNamingPolicy = CamelCase` applies only to *property* names. The contract's §1
// diagram is drawn in snake_case and is CONCEPTUAL — the ZY-07 agent caught that trusting it
// would make every status filter silently match nothing. Reality wins; this file matches reality.
import type { APIResponse } from '@playwright/test';

import { ZYGOS_API_PREFIX, csrfHeaders, jsonCsrfHeaders } from './zygos-helpers.js';

import type { ZygosSession } from './zygos-session.js';

/** `PaymentInstructionStatus` — verbatim enum names, exactly as they appear on the wire. */
export type PaymentInstructionStatus =
  | 'Draft'
  | 'Validated'
  | 'PendingApproval'
  | 'Approved'
  | 'Rejected'
  | 'Submitted'
  | 'ProviderAck'
  | 'Settled'
  | 'Failed'
  | 'Returned';

/** `PaymentDirection`. */
export type PaymentDirection = 'Outgoing' | 'Incoming';

/** One end of a payment: an existing party to snapshot, or inline details. */
export interface CounterpartyBody {
  partyExternalId?: string | null;
  name?: string | null;
  iban?: string | null;
  bic?: string | null;
  country?: string | null;
  address?: string | null;
}

/**
 * `POST /payment-instructions` — the create body.
 *
 * 🔴 LOOK AT WHAT IS ABSENT: no `feeAmount`, no `status`, no `reference`, no `idempotencyKey`,
 * no `providerCode`. That absence IS the control (contract §3, the Agora ES-06 precedent):
 * tampering is UNREPRESENTABLE rather than rejected. `zygos-tampering.spec.ts` proves the
 * server ignores them even when a client sends them anyway — this interface is the honest
 * shape, that spec is the adversary.
 */
export interface CreateInstructionBody {
  amount: number;
  currency: string;
  /** `DateOnly` on the wire: `YYYY-MM-DD`. */
  valueDate: string;
  direction: PaymentDirection;
  debtor: CounterpartyBody;
  creditor: CounterpartyBody;
  remittanceInfo?: string | null;
}

/** `PUT /payment-instructions/{id}` — same shape; legal only in Draft/Validated. */
export type UpdateInstructionBody = CreateInstructionBody;

export interface InstructionDto {
  externalId: string;
  reference: string;
  status: PaymentInstructionStatus;
  amount: number;
  currency: string;
  valueDate: string;
  direction: PaymentDirection;
  feeAmount: number;
  idempotencyKey: string | null;
  providerCode: string | null;
  remittanceInfo: string | null;
}

export interface PagedInstructions {
  items: InstructionDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface AuditEntryDto {
  id: string;
  action: string;
  fromStatus: PaymentInstructionStatus | null;
  toStatus: PaymentInstructionStatus | null;
  actorUserId: string;
  occurredAt: string;
}

function url(path: string): string {
  return `${ZYGOS_API_PREFIX}${path}`;
}

/**
 * The instruction API for ONE logged-in user.
 *
 * Per-user by construction, not by convention: maker-checker is a statement about WHO acts, so a
 * shared client with a swappable actor would make the suite's central control a parameter you
 * could forget to pass. `new ZygosApi(sessionForB)` cannot act as C by accident.
 */
export class ZygosApi {
  private readonly session: ZygosSession;

  constructor(session: ZygosSession) {
    this.session = session;
  }

  /** Who this client acts as — for failure messages that name the actor. */
  get actor(): string {
    return this.session.username;
  }

  // ------------------------------------------------------------------ reads
  /**
   * `GET /payment-instructions`. Pass a raw query string INCLUDING the leading `?`.
   *
   * 🔴 Raw, not an object, on purpose. `Statuses` is a PLURAL REPEATED param
   * (`?Statuses=Draft&Statuses=Validated`). An object → `URLSearchParams` round-trip invites a
   * helper that "helpfully" emits `Statuses[]=Draft`, which binds EMPTY server-side and makes the
   * filter match EVERYTHING — silently, with a 200. `zygos-list-query.spec.ts` pins both encodings
   * precisely because the difference is invisible in the status code.
   */
  list(query = ''): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-instructions${query}`));
  }

  get(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-instructions/${id}`));
  }

  /** `GET /payment-instructions/{id}/audit` — the append-only trail, oldest first. */
  audit(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-instructions/${id}/audit`));
  }

  // ---------------------------------------------------------------- writes
  create(body: CreateInstructionBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url('/payment-instructions'), {
      headers: jsonCsrfHeaders(),
      data: body,
    });
  }

  /** `PUT /{id}` — 🔴 a material edit makes the editor a Contributor ⇒ they can no longer approve. */
  update(id: string, body: UpdateInstructionBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.put(url(`/payment-instructions/${id}`), {
      headers: jsonCsrfHeaders(),
      data: body,
    });
  }

  // ----------------------------------------------------------- transitions
  validate(id: string): Promise<APIResponse> {
    return this.transition(id, 'validate');
  }

  submitForApproval(id: string): Promise<APIResponse> {
    return this.transition(id, 'submit-for-approval');
  }

  /** 🔴 → Approved. 403 when the approver ∈ Contributors. 409 when not PendingApproval. */
  approve(id: string): Promise<APIResponse> {
    return this.transition(id, 'approve');
  }

  reject(id: string, reason: string): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-instructions/${id}/reject`), {
      headers: jsonCsrfHeaders(),
      data: { reason },
    });
  }

  /**
   * 🔴 `POST /{id}/submit` — Approved → Submitted; mints the idempotency key.
   *
   * Sent with NO BODY, because per contract §3 the endpoint takes none: the provider is derived
   * from the tenant's `RoutingRule` rows and the client cannot name the rail its own payment
   * leaves on. `submitWithBody` exists ONLY so the tampering spec can prove that.
   */
  submit(id: string): Promise<APIResponse> {
    return this.transition(id, 'submit');
  }

  /** Adversarial: submit WITH a body. Used only by `zygos-tampering.spec.ts`. */
  submitWithBody(id: string, body: Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-instructions/${id}/submit`), {
      headers: jsonCsrfHeaders(),
      data: body,
    });
  }

  private transition(id: string, action: string): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-instructions/${id}/${action}`), {
      headers: csrfHeaders(),
    });
  }
}

/** A valid create body, tagged so the row is findable via `Search` forever. See `zygosTag`. */
export function instructionBody(tag: string, overrides: Partial<CreateInstructionBody> = {}): CreateInstructionBody {
  return {
    amount: 100.5,
    currency: 'EUR',
    valueDate: '2026-08-01',
    direction: 'Outgoing',
    debtor: { name: `Debtor ${tag}`, iban: 'CY17002001280000001200527600', country: 'CY' },
    creditor: { name: `Creditor ${tag}`, iban: 'DE89370400440532013000', country: 'DE' },
    remittanceInfo: tag,
    ...overrides,
  };
}
