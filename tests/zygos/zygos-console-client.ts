// A thin typed client over the FINREG console's four new surfaces, reached THROUGH the BFF —
// batches (P-04), commission (P-06), imports (P-07) and schedules (P-08). Sibling to
// `zygos-client.ts` (payment instructions); same transport, same rules.
//
// 🔴 THE WIRE FORMAT IS camelCase PROPERTIES + PascalCase ENUM VALUES — see `zygos-client.ts`.
// `MiddlewareConfig` registers a bare `JsonStringEnumConverter`, so enum *values* serialize verbatim
// (`"Draft"`, `"PendingAuthorization"`, `"RejectedNothingImported"`) while property names are
// camelCase. Every shape here is taken from the C# in `Finreg.Web` / `Finreg.UseCases.DTOs` — the
// source of truth — never from the frontend's TypeScript.
import { ZYGOS_API_PREFIX, csrfHeaders, jsonCsrfHeaders } from './zygos-helpers.js';

import type { ZygosSession } from './zygos-session.js';
import type { APIResponse } from '@playwright/test';

/** `PagedResponse<T>` — the shape every list endpoint returns (`Finreg.UseCases.DTOs`). */
export interface PagedResponse<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
}

// ---------------------------------------------------------------- batches (P-04)
/** `PaymentBatchStatus` — verbatim enum names on the wire. */
export type PaymentBatchStatus =
  | 'Draft'
  | 'PendingApproval'
  | 'Approved'
  | 'Rejected'
  | 'Completed'
  | 'CompletedWithFailures'
  | 'Failed'
  | 'HeldForCorrection';

/** `BatchFailurePolicy` — client-choosable per D11. */
export type BatchFailurePolicy = 'AcceptValid' | 'RejectAll' | 'HoldForCorrection' | 'AskOperator';

export interface PaymentBatchDto {
  externalId: string;
  reference: string;
  title: string | null;
  status: PaymentBatchStatus;
  failurePolicy: BatchFailurePolicy;
  instructionIds: string[];
  contributors: string[];
  approvedByUserId: string | null;
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  succeededCount: number;
  failedCount: number;
}

export interface PaymentBatchDetailDto {
  batch: PaymentBatchDto;
  instructions: { externalId: string; reference: string; status: string }[];
}

export interface CreateBatchBody {
  instructionIds: string[];
  failurePolicy: BatchFailurePolicy;
  title?: string;
}

// ------------------------------------------------------------- schedules (P-08)
/** `ScheduleStatus` — verbatim enum names on the wire. */
export type ScheduleStatus = 'PendingAuthorization' | 'Active' | 'Paused' | 'Rejected' | 'Cancelled';

export interface PaymentScheduleDto {
  externalId: string;
  reference: string;
  title: string | null;
  status: ScheduleStatus;
  payeePartyExternalId: string;
  amount: number;
  currency: string;
  direction: 'Outgoing' | 'Incoming';
  frequency: 'Monthly' | 'Weekly';
  dayOfMonth: number;
  startDate: string;
  contributors: string[];
  standingAuthorization: { amountCeiling: number; ceilingCurrency: string; expiresOn: string } | null;
}

export interface CreateScheduleBody {
  payeePartyExternalId: string;
  amount: number;
  currency: string;
  direction: 'Outgoing' | 'Incoming';
  frequency: 'Monthly' | 'Weekly';
  dayOfMonth: number;
  startDate: string;
  orderingAccount: { name: string; iban: string; country: string };
  title?: string;
  remittanceInfo?: string;
}

export interface AuthorizeScheduleBody {
  amountCeiling: number;
  ceilingCurrency: string;
  expiresOn: string;
}

// ------------------------------------------------------------ commission (P-06)
export type CommissionRemainderPolicy = 'LargestRemainder' | 'FirstLine' | 'LastLine';

export interface CommissionRuleDto {
  key: string;
  rateBps: number;
  remainderAllocation: CommissionRemainderPolicy;
  isActive: boolean;
  priority: number;
}

export interface CommissionResultDto {
  sourceTotal: { amount: number; currency: string };
  allocations: { recipientId: string; amount: { amount: number; currency: string } }[];
}

export interface UpsertCommissionRuleBody {
  rateBps: number;
  remainderAllocation: CommissionRemainderPolicy;
  isActive?: boolean;
}

export interface CalculateCommissionBody {
  currency: string;
  bases: { recipientId: string; baseAmount: number }[];
}

// --------------------------------------------------------------- imports (P-07)
export type ImportStatus = 'Imported' | 'ImportedWithRejections' | 'RejectedNothingImported';

export interface RowRejection {
  rowNumber: number;
  field: string;
  reason: string;
}

export interface PaymentImportOutcome {
  status: ImportStatus;
  batchExternalId: string | null;
  batchReference: string | null;
  totalRows: number;
  importedCount: number;
  rejectedRowCount: number;
  rejections: RowRejection[];
}

/** The run-level fields of an import, minus the file (which is passed as a Buffer). */
export interface ImportFields {
  fundingAccountName: string;
  fundingIban: string;
  valueDate: string;
  policy: 'RejectAllOnAnyInvalid' | 'AcceptValidRows';
  title?: string;
}

function url(path: string): string {
  return `${ZYGOS_API_PREFIX}${path}`;
}

/** A payee party create body (`CreatePartyRequest`), for seeding a schedule's live payee reference. */
export interface CreatePartyBody {
  name: string;
  country: string;
  kind: 'Customer' | 'Counterparty';
  iban?: string;
}

/**
 * The console API for ONE logged-in user. Per-user by construction so a maker-checker spec cannot
 * act as the wrong identity by accident (mirrors `ZygosApi`).
 */
export class ConsoleApi {
  private readonly session: ZygosSession;

  constructor(session: ZygosSession) {
    this.session = session;
  }

  get actor(): string {
    return this.session.username;
  }

  // ---- parties (payee seeding) ----
  createParty(body: CreatePartyBody): Promise<APIResponse> {
    return this.session.context.post(url('/parties'), { headers: jsonCsrfHeaders(), data: body });
  }

  // ---- batches (P-04) ----
  listBatches(query = ''): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-batches${query}`));
  }

  getBatch(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-batches/${id}`));
  }

  createBatch(body: CreateBatchBody): Promise<APIResponse> {
    return this.session.context.post(url('/payment-batches'), { headers: jsonCsrfHeaders(), data: body });
  }

  submitBatchForApproval(id: string): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-batches/${id}/submit-for-approval`), { headers: csrfHeaders() });
  }

  approveBatch(id: string): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-batches/${id}/approve`), { headers: csrfHeaders() });
  }

  rejectBatch(id: string, reason: string): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-batches/${id}/reject`), {
      headers: jsonCsrfHeaders(),
      data: { reason },
    });
  }

  // ---- schedules (P-08) ----
  listSchedules(query = ''): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-schedules${query}`));
  }

  getSchedule(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/payment-schedules/${id}`));
  }

  createSchedule(body: CreateScheduleBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url('/payment-schedules'), { headers: jsonCsrfHeaders(), data: body });
  }

  authorizeSchedule(id: string, body: AuthorizeScheduleBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url(`/payment-schedules/${id}/authorize`), {
      headers: jsonCsrfHeaders(),
      data: body,
    });
  }

  // ---- commission (P-06) ----
  listCommissionRules(): Promise<APIResponse> {
    return this.session.context.get(url('/commission-rules'));
  }

  upsertCommissionRule(key: string, body: UpsertCommissionRuleBody): Promise<APIResponse> {
    return this.session.context.put(url(`/commission-rules/${encodeURIComponent(key)}`), {
      headers: jsonCsrfHeaders(),
      data: body,
    });
  }

  calculateCommission(body: CalculateCommissionBody): Promise<APIResponse> {
    return this.session.context.post(url('/commission/calculate'), { headers: jsonCsrfHeaders(), data: body });
  }

  // ---- imports (P-07) ----
  /** `POST /payment-imports` — a real multipart .xlsx upload (see `zygos-xlsx.ts`). */
  importPayments(file: Buffer, fields: ImportFields): Promise<APIResponse> {
    const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
      File: {
        name: 'import.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: file,
      },
      FundingAccountName: fields.fundingAccountName,
      FundingIban: fields.fundingIban,
      ValueDate: fields.valueDate,
      Policy: fields.policy,
    };
    if (fields.title !== undefined) multipart.Title = fields.title;
    // csrfHeaders (not jsonCsrfHeaders): Playwright sets the multipart Content-Type + boundary.
    return this.session.context.post(url('/payment-imports'), { headers: csrfHeaders(), multipart });
  }
}
