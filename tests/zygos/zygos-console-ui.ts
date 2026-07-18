// Zygos console @ui entry (UX-6a) — one way into the authenticated console that works BOTH
// against the deployed host and against a local `expo start` dev server.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────────────
//
// The existing @ui specs enter via `parkedCookies()` — a real `/bff/login` session cookie
// injected into the browser context. That is the right mechanism and stays the default.
//
// It cannot work against a LOCAL dev server, and the reason is structural rather than a
// missing flag: `expo start --web` serves the SPA and NOTHING else. There is no BFF on
// :8090, so `/bff/me`, `/bff/login` and `/bff/api/...` all fall through to the SPA's
// index.html. `AuthProvider`'s bootstrap (`GET /bff/me`) therefore never sees a user, the
// protected-route guard bounces every URL to `/login`, and not one console screen renders.
// Verified by hand before writing a line of this file.
//
// So local mode stubs EXACTLY ONE THING — the `/bff/me` bootstrap — and nothing else:
//
//   * The DATA layer is not stubbed. `featureFlags.useMockApi` defaults to `__DEV__`, so a dev
//     bundle already serves every payment instruction from the app's OWN in-memory mock
//     (`src/api/mock`, 137 deterministically seeded instructions, fixed SEED). That mock is the
//     app's real, shipped dev mode — not a test fixture invented here.
//   * The UI under test is 100% real: the same components, the same `FM()` lookups against the
//     same `en.json`, the same shared `@dloizides/ui-*` kit.
//
// 🔴 THE HONEST LIMITATION, STATED PLAINLY: in local mode these specs prove nothing about
// authentication, the BFF, or the API contract. They are not trying to — the @api tier and the
// existing console specs own that, against the deployed host. What they prove is what the UX-6a
// wave actually changed: which STRINGS render, how the pager behaves, and how the form lays out.
//
// Against a deployed `ZYGOS_WEB_URL` this module transparently uses the real session cookie
// instead, so the SAME specs become full end-to-end coverage the moment the wave ships. Nothing
// here needs editing at that point — that is the whole point of the two modes living behind one
// function.
import { expect } from '@playwright/test';

import { ZYGOS_WEB_URL } from './zygos-helpers.js';
import { parkedCookies } from './zygos-session.js';

import type { Page } from '@playwright/test';

/** `[data-testid="x"]` — the selector form the rest of the zygos @ui suite uses. */
export const id = (testId: string): string => `[data-testid="${testId}"]`;

/**
 * Is `ZYGOS_WEB_URL` a local dev server?
 *
 * Deliberately narrow (loopback only). Anything else — staging, prod, a tunnel — is treated as
 * a real deployment and gets a real session, so nobody can accidentally point the auth stub at
 * a host where it would mask a genuine auth failure.
 */
export const IS_LOCAL_CONSOLE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ZYGOS_WEB_URL);

export const CONSOLE_TEST_IDS = {
  shell: 'zygos-app-shell',
  dashboard: 'zygos-dashboard-screen',

  instructionsScreen: 'zygos-instructions-screen',
  instructionsTable: 'zygos-instructions-table',
  instructionsPager: 'zygos-instructions-pager',
  instructionsFilters: 'zygos-instructions-filters',
  statusFilter: 'zygos-instructions-status-filter',

  approvalsScreen: 'zygos-approvals-screen',
  approvalsTable: 'zygos-approvals-table',
  /**
   * The empty states. Both screens render `EmptyListState` INSTEAD of the filters + pager, so an
   * empty list means there is legitimately no pager to test — not a missing one.
   */
  instructionsEmpty: 'zygos-instructions-empty',
  approvalsEmpty: 'approvals-empty',
  /** New in UX-6a — the approvals pager had no testID before this wave. */
  approvalsPager: 'zygos-approvals-pager',

  formScreen: 'zygos-instruction-form-screen',
  formSubmit: 'zygos-instruction-form-submit',
  formAmount: 'instruction-form-amount',
  formCurrency: 'instruction-form-currency',
  formValueDate: 'instruction-form-value-date',
  formDirection: 'instruction-form-direction',

  detailScreen: 'zygos-instruction-detail-screen',
  /** The detail screen's SECOND async load — settles independently of the page skeleton. */
  auditTrail: 'zygos-instruction-audit-trail',
  rejectAction: 'zygos-instruction-action-reject',
  /** `LAYOUT_TEST_IDS.modalShell` from `@dloizides/ui-layout` — the ModalShell root. */
  modalShell: 'template-modal',
} as const;

/** Shared `@dloizides/ui-tables` pager part ids (`TABLE_TEST_IDS`). Global, not per-table. */
export const PAGER_TEST_IDS = {
  info: 'ui-pager-info',
  first: 'ui-pager-first',
  prev: 'ui-pager-prev',
  next: 'ui-pager-next',
  last: 'ui-pager-last',
} as const;

/** `${pagerTestID}-size-trigger` / `${pagerTestID}-size-${n}` — the rowsVariant="dropdown" parts. */
export const sizeTrigger = (pagerTestId: string): string => `${pagerTestId}-size-trigger`;
export const sizeOption = (pagerTestId: string, size: number): string => `${pagerTestId}-size-${String(size)}`;

/**
 * The user the local harness presents.
 *
 * 🔴 `sub` MUST NOT be `zygos-demo-self`. That string is the mock seed's
 * `CURRENT_USER_PLACEHOLDER`: `mockStore.attributeToCurrentUser` rewrites it to whoever is
 * logged in, so a session claiming it inherits ~every seeded instruction as its own, becomes a
 * Contributor everywhere, and `canApprove` correctly withholds approve/reject on ALL of them.
 * The reject dialog — the one place `ModalShell` (and therefore the `quizTemplates.cancel`
 * a11y-label bug) is reachable — then never opens, and the i18n guard silently loses its most
 * important surface while still reporting green. Found the hard way.
 */
const LOCAL_USER = {
  sub: 'zygos-checker-c',
  preferred_username: 'zygos-checker-c',
  name: 'Checker C',
  email: 'checker-c@zygos.test',
} as const;

/**
 * Stub the session bootstrap for a local dev server.
 *
 * The envelope shape is not a guess: `@dloizides/auth-client`'s `extractUser` reads
 * `data.user`, so a bare user object is silently discarded and the app stays logged out
 * (which is exactly what a first attempt at this did).
 */
async function stubLocalSession(page: Page): Promise<void> {
  await page.route('**/bff/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: LOCAL_USER }),
    }),
  );
}

/**
 * Enter the authenticated console at `path` and wait for the shell.
 *
 * Seeing `zygos-app-shell` IS the readiness signal — it renders only behind the protected-route
 * guard, so there is nothing to poll afterwards and no reason to sleep.
 */
export async function enterConsole(page: Page, path = '/'): Promise<void> {
  if (IS_LOCAL_CONSOLE) {
    await stubLocalSession(page);
  } else {
    const cookies = await parkedCookies('zygos-checker-c');
    expect(cookies.length, 'no session could be minted for zygos-checker-c').toBeGreaterThan(0);
    await page.context().clearCookies();
    await page.context().addCookies(cookies);
  }

  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(CONSOLE_TEST_IDS.shell))).toBeVisible({ timeout: 30_000 });
}

/** Navigate within an already-entered console and wait for `screenTestId` to render. */
export async function gotoScreen(page: Page, path: string, screenTestId: string): Promise<void> {
  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.locator(id(screenTestId))).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the first instruction in the approvals queue that this user may actually REJECT, and
 * return its id.
 *
 * Why a scan rather than a fixed id: "can I reject this?" is a function of the four-eyes rule
 * (`canApprove` / `isContributor`), not of position — a checker is a Contributor on some rows
 * and not others, and which rows differ between the seeded mock and any real tenant. Hard-coding
 * one id would be green locally and mysteriously red everywhere else.
 *
 * Bounded, and a miss is a FAILURE rather than a skip: if no rejectable instruction exists, the
 * caller's surface genuinely was not reached, and silently passing would be the "guard nobody
 * proved can fail" this whole file is trying to avoid.
 */
export async function rowIdsFor(page: Page, tableTestId: string): Promise<string[]> {
  const prefix = `${tableTestId}-row-`;

  // 🔴 ROWS ARRIVE AFTER THE SCREEN DOES. The screen's own testID renders as soon as the route
  // mounts, but the rows come from a separate query that is still in flight — so reading them
  // immediately returns an EMPTY list and the caller reports "the list rendered no rows" against
  // a list that is merely still loading. Waiting for the first row is the canonical readiness
  // signal for "this table has data", and it is what makes a genuinely empty table fail loudly
  // (timeout) instead of silently.
  await expect(page.locator(`[data-testid^="${prefix}"]`).first()).toBeVisible({ timeout: 30_000 });

  const candidates = (await page.locator(`[data-testid^="${prefix}"]`).evaluateAll(
    (els, p) => [...new Set(els.map((el) => (el.getAttribute('data-testid') ?? '').slice(p.length)))].filter((v) => v !== ''),
    prefix,
  )) as string[];

  // 🔴 CELLS SHARE THE ROW'S PREFIX. `${table}-row-${id}` is the row, but every cell inside it is
  // `${table}-row-${id}-${column}` — so a naive prefix match returns `mock-0000043` AND
  // `mock-0000043-reference`, `mock-0000043-valueDate`, … A regex cannot separate them, because an
  // instruction id legitimately contains hyphens itself (mock ids and GUIDs both do); an earlier
  // version tried `[A-Za-z0-9-]+$` and happily accepted every cell. Navigating to those invented
  // ids renders no detail screen, so the caller times out 12 times over and reports "the reject
  // action regressed" when nothing regressed at all.
  //
  // The structural rule is exact and needs no pattern: a candidate is a CELL iff some OTHER
  // candidate is a proper prefix of it followed by `-`. Keep only the minimal ones.
  return candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && candidate.startsWith(`${other}-`)),
  );
}

export async function openRejectDialog(page: Page): Promise<string> {
  await gotoScreen(page, '/approvals', CONSOLE_TEST_IDS.approvalsScreen);

  const rowIds = await rowIdsFor(page, CONSOLE_TEST_IDS.approvalsTable);

  expect(rowIds.length, 'the approvals queue is empty — no instruction to open a reject dialog on').toBeGreaterThan(0);

  const MAX_CANDIDATES = 12;
  for (const instructionId of rowIds.slice(0, MAX_CANDIDATES)) {
    await gotoScreen(page, `/instructions/${instructionId}`, CONSOLE_TEST_IDS.detailScreen);
    const reject = page.locator(id(CONSOLE_TEST_IDS.rejectAction));
    if ((await reject.count()) === 0) continue;

    await reject.click();
    await expect(page.locator(id(CONSOLE_TEST_IDS.modalShell))).toBeVisible({ timeout: 15_000 });
    return instructionId;
  }

  throw new Error(
    `no instruction among the first ${String(MAX_CANDIDATES)} approvals rows offered Reject, so the ModalShell ` +
      `surface was never opened. Either every candidate has this user as a Contributor (check the session's ` +
      `sub against the mock's CURRENT_USER_PLACEHOLDER), or the reject action regressed.`,
  );
}
