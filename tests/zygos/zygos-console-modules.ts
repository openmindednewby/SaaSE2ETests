// A thin typed client over the FINREG console's TWO newest surfaces — CRM contacts (C-01) and the
// accounting module (A-01: chart of accounts, journals, trial balance, periods) — reached THROUGH
// the BFF, exactly like `zygos-console-client.ts` and `zygos-client.ts`. A SIBLING to those, not a
// replacement: it takes the SAME `ZygosSession`, so no new login is minted and the shared auth
// cache/rate budget is respected. Split into its own file only to keep each client under the
// 300-line cap — the transport, headers and wire-format rules are identical.
//
// 🔴 THE WIRE FORMAT IS camelCase PROPERTIES + PascalCase ENUM VALUES — same as the other clients.
// A bare `JsonStringEnumConverter` is registered, so enum *values* serialize verbatim (`"Person"`,
// `"Debit"`, `"Closed"`) while property names are camelCase. Every shape below is taken from the C#
// in `Finreg.Web` / `Finreg.UseCases.DTOs` — the source of truth — never from the frontend's TS.
import { ZYGOS_API_PREFIX, csrfHeaders, jsonCsrfHeaders } from './zygos-helpers.js';

import type { PagedResponse } from './zygos-console-client.js';
import type { ZygosSession } from './zygos-session.js';
import type { APIResponse } from '@playwright/test';

// ---------------------------------------------------------------- CRM contacts (C-01)
/** `ContactKind` — a natural person or a legal entity. Verbatim enum names on the wire. */
export type ContactKind = 'Person' | 'Organization';

/** `ContactStatus` — live in the directory, or archived. */
export type ContactStatus = 'Active' | 'Inactive';

export interface ContactDto {
  externalId: string;
  kind: ContactKind;
  displayName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  note: string | null;
  status: ContactStatus;
  createdDate: string;
  lastUpdatedDate: string | null;
}

export interface CreateContactBody {
  displayName: string;
  kind: ContactKind;
  email?: string;
  phone?: string;
  tags?: string[];
  note?: string;
}

export interface UpdateContactBody {
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  note?: string;
  status?: ContactStatus;
}

// ------------------------------------------------------------- accounting (A-01)
/** `AccountType` — the five classes of the accounting equation. Verbatim enum names on the wire. */
export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

/** `EntryDirection` — which side of the book a line lands on. The direction carries the sign. */
export type EntryDirection = 'Debit' | 'Credit';

/** `PeriodStatus` — whether a month still accepts postings. */
export type PeriodStatus = 'Open' | 'Closed';

export interface AccountDto {
  externalId: string;
  code: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  createdDate: string;
  lastUpdatedDate: string | null;
}

export interface CreateAccountBody {
  code: string;
  name: string;
  type: AccountType;
  isActive?: boolean;
}

export interface JournalLineDto {
  accountCode: string;
  direction: EntryDirection;
  amount: number;
  currency: string;
}

export interface JournalDto {
  externalId: string;
  reference: string;
  description: string | null;
  entryDate: string;
  periodId: string;
  postedAt: string;
  lines: JournalLineDto[];
}

/** One line of a post-journal-entry request. `amount` is ALWAYS positive; direction carries the sign. */
export interface JournalLineBody {
  accountCode: string;
  direction: EntryDirection;
  amount: number;
  currency: string;
}

export interface PostJournalEntryBody {
  entryDate: string;
  lines: JournalLineBody[];
  reference?: string;
  description?: string;
}

export interface TrialBalanceRowDto {
  accountCode: string;
  name: string | null;
  type: AccountType | null;
  debits: number;
  credits: number;
  balance: number;
}

export interface TrialBalanceDto {
  rows: TrialBalanceRowDto[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}

export interface PeriodDto {
  externalId: string;
  code: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
}

function url(path: string): string {
  return `${ZYGOS_API_PREFIX}${path}`;
}

/**
 * The CRM + accounting console API for ONE logged-in user. Per-user by construction (mirrors
 * `ConsoleApi`/`ZygosApi`) so a spec cannot act as the wrong identity by accident.
 */
export class ModulesApi {
  private readonly session: ZygosSession;

  constructor(session: ZygosSession) {
    this.session = session;
  }

  get actor(): string {
    return this.session.username;
  }

  // ---- CRM contacts (C-01) ----
  listContacts(query = ''): Promise<APIResponse> {
    return this.session.context.get(url(`/contacts${query}`));
  }

  getContact(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/contacts/${id}`));
  }

  createContact(body: CreateContactBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url('/contacts'), { headers: jsonCsrfHeaders(), data: body });
  }

  updateContact(id: string, body: UpdateContactBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.put(url(`/contacts/${id}`), { headers: jsonCsrfHeaders(), data: body });
  }

  deactivateContact(id: string): Promise<APIResponse> {
    return this.session.context.post(url(`/contacts/${id}/deactivate`), { headers: csrfHeaders() });
  }

  reactivateContact(id: string): Promise<APIResponse> {
    return this.session.context.post(url(`/contacts/${id}/reactivate`), { headers: csrfHeaders() });
  }

  // ---- accounting: chart of accounts (A-01) ----
  listAccounts(query = ''): Promise<APIResponse> {
    return this.session.context.get(url(`/accounts${query}`));
  }

  getAccount(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/accounts/${id}`));
  }

  createAccount(body: CreateAccountBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url('/accounts'), { headers: jsonCsrfHeaders(), data: body });
  }

  // ---- accounting: journals (A-01) ----
  postJournalEntry(body: PostJournalEntryBody | Record<string, unknown>): Promise<APIResponse> {
    return this.session.context.post(url('/journal-entries'), { headers: jsonCsrfHeaders(), data: body });
  }

  listJournals(query = ''): Promise<APIResponse> {
    return this.session.context.get(url(`/journals${query}`));
  }

  getJournal(id: string): Promise<APIResponse> {
    return this.session.context.get(url(`/journals/${id}`));
  }

  // ---- accounting: trial balance + periods (A-01) ----
  getTrialBalance(): Promise<APIResponse> {
    return this.session.context.get(url('/trial-balance'));
  }

  listPeriods(): Promise<APIResponse> {
    return this.session.context.get(url('/periods'));
  }

  closePeriod(id: string): Promise<APIResponse> {
    return this.session.context.post(url(`/periods/${id}/close`), { headers: csrfHeaders() });
  }
}

/** A paged list of contacts / accounts / journals, as the list endpoints return it. */
export type Paged<T> = PagedResponse<T>;
