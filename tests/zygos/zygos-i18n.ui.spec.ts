// Zygos i18n guard (UX-6a) — no raw translation key may reach an operator's screen.
//
// The highest-value test of the wave, and the reason is arithmetic: 44 keys were missing at once,
// every one of them rendered its own dotted name into the UI, and NOTHING in lint, typecheck,
// unit tests or the build said a word. `FM()` has no fallback by design, the shared
// `@dloizides/ui-*` kit resolves its strings through the HOST app's `FM`, and so every kit upgrade
// can silently introduce user-visible garbage. This spec is the join that closes that gap.
//
// 🔴 A GREEN RUN PROVES NOTHING BY ITSELF — a guard nobody has watched fail is not a guard.
// Two independent demonstrations that this one does fail, both observed rather than assumed:
//
//   1. MUTATION. `common.showing` was deleted from
//      `zygos-web/src/localization/locales/en.json`, this spec run against the local dev server,
//      and it failed with:
//        • "common.showing"  [text]  div in [ui-pager-info]   …on "instructions list"
//      The key was then restored and the run went green again (restore verified byte-identical).
//
//   2. A REAL DEFECT, FOUND ON FIRST RUN. Against the DEPLOYED console this spec fails on three
//      surfaces — `quizTemplates.cancel` on the reject dialog's close button, and
//      `pageSkeleton.loadingLabel` on the instructions list and detail screens — all of them in
//      `aria-label`, none of them visible to a screenshot. Both keys EXIST in the repo's en.json,
//      so this is deploy lag: app.finreg.dloizides.com serves a pre-UX-6a build. See the task
//      report. Expect these three to go green the moment the wave ships.
//
// See `zygos-i18n-scan.ts` for the detector and, importantly, for why ATTRIBUTES are scanned
// alongside visible text (the `quizTemplates.cancel` defect lived in an `aria-label`).
//
import { expect, test } from '@playwright/test';

import { CONSOLE_TEST_IDS, enterConsole, gotoScreen, id, openRejectDialog, rowIdsFor } from './zygos-console-ui.js';
import { describeRawKeys, findRawKeys } from './zygos-i18n-scan.js';

import type { Page } from '@playwright/test';

/** `PageSkeleton`'s root — the transient loading placeholder. */
const PAGE_SKELETON = 'page-skeleton';

/**
 * Assert the currently-rendered page carries no raw keys, naming any that it does.
 *
 * 🔴 WAITS OUT THE LOADING SKELETON FIRST, and that is a correctness fix, not politeness.
 * `PageSkeleton` is mounted while a screen's data loads and it carries its own `aria-label`. Two
 * consecutive runs against the same host disagreed about WHICH screen reported
 * `pageSkeleton.loadingLabel` — instruction detail in one, approvals queue in the next — because
 * the scan raced a element that may or may not still be mounted. Same defect, different
 * scapegoat each run: precisely the "flaky test that looks like a product bug" this suite has a
 * documented history of.
 *
 * So each screen is scanned once it has actually finished loading, which is what "this screen
 * renders no raw keys" was always supposed to mean. Waiting on the skeleton's ABSENCE is a
 * canonical readiness signal, not a sleep. The skeleton's own strings are not thereby exempt —
 * they belong to a surface of their own and are covered by the @api dictionary tier.
 */
async function expectNoRawKeys(page: Page, screen: string): Promise<void> {
  await expect(page.locator(id(PAGE_SKELETON))).toHaveCount(0, { timeout: 30_000 });

  const hits = await findRawKeys(page);
  expect(hits, hits.length === 0 ? '' : describeRawKeys(screen, hits)).toEqual([]);
}

/**
 * The screens an operator actually reaches, each with the readiness signal that says it is done
 * rendering. Scanning before the screen's own testID is visible would scan a skeleton and pass
 * for the wrong reason — so every entry pairs a path with the element that proves it arrived.
 */
const SCREENS: readonly { name: string; path: string; testId: string }[] = [
  { name: 'dashboard', path: '/', testId: CONSOLE_TEST_IDS.dashboard },
  { name: 'instructions list', path: '/instructions', testId: CONSOLE_TEST_IDS.instructionsScreen },
  { name: 'new instruction form', path: '/instructions/new', testId: CONSOLE_TEST_IDS.formScreen },
  { name: 'approvals queue', path: '/approvals', testId: CONSOLE_TEST_IDS.approvalsScreen },
];

test.describe('Zygos i18n — no raw translation keys @zygos-ui @ui', () => {
  test.beforeEach(async ({ page }) => {
    await enterConsole(page, '/');
  });

  for (const screen of SCREENS) {
    test(`🔴 "${screen.name}" renders no raw translation keys (text or a11y attributes)`, async ({ page }) => {
      await gotoScreen(page, screen.path, screen.testId);
      await expectNoRawKeys(page, screen.name);
    });
  }

  test('🔴 the instruction DETAIL screen renders no raw translation keys', async ({ page }) => {
    // The detail screen has no fixed URL — it needs a real instruction id. Take the first row the
    // list actually rendered rather than hard-coding one, so this works against the seeded mock
    // and against a real tenant without editing.
    await gotoScreen(page, '/instructions', CONSOLE_TEST_IDS.instructionsScreen);

    // `rowIdsFor` rather than `.first()`: rows and their CELLS share a testID prefix, and while
    // DOM order happens to put the row first today, that is an accident of render order, not a
    // contract. See `rowIdsFor` for the structural rule that separates them.
    const rowIds = await rowIdsFor(page, CONSOLE_TEST_IDS.instructionsTable);
    expect(rowIds.length, 'the instructions list rendered no rows, so no detail screen could be opened').toBeGreaterThan(
      0,
    );

    await gotoScreen(page, `/instructions/${rowIds[0]}`, CONSOLE_TEST_IDS.detailScreen);

    // 🔴 THE DETAIL SCREEN HAS **TWO** INDEPENDENT ASYNC LOADS, and the page skeleton only covers
    // the first. `InstructionDetailScreen` wraps the instruction in `AsyncSurface` but renders
    // `<AuditTrail loading={audit.isLoading} />` beside it, and a loading AuditTrail prints
    // `FM('common.loading')`. So after the skeleton clears there is a SECOND window in which a
    // missing `common.loading` renders as a raw key — which is exactly why this test failed on one
    // deployed run and passed on the very next one against the identical build.
    //
    // Settling on the audit trail is what makes the scan mean "the loaded detail screen". The
    // loading-window defect is NOT thereby swept under the rug: `common.loading` is asserted
    // outright by the @api dictionary tier, which has no race to lose.
    const auditTrail = page.locator(id(CONSOLE_TEST_IDS.auditTrail));
    await expect(auditTrail).toBeVisible({ timeout: 30_000 });
    await expect(auditTrail).not.toHaveText(/^\s*(Loading…|common\.loading)\s*$/, { timeout: 30_000 });

    await expectNoRawKeys(page, 'instruction detail');
  });

  test('🔴 the reject dialog (ModalShell) renders no raw translation keys — including its close button', async ({
    page,
  }) => {
    // 🔴 THE SURFACE A PURELY VISUAL SCAN MISSES. `ModalShell`'s close button carried
    // `quizTemplates.cancel` as its aria-label: nothing on screen looked wrong, and only a
    // screen reader (or this assertion) would ever have caught it. The parallel visual-QA pass
    // never reached this dialog at all.
    await openRejectDialog(page);

    await expect(page.locator(id(CONSOLE_TEST_IDS.modalShell))).toBeVisible();
    await expectNoRawKeys(page, 'reject dialog (ModalShell)');
  });

  test('the detector itself rejects legitimate dotted text and catches key shapes', async () => {
    // A self-test of the guard's own predicate. Cheap, and it means a future "let us silence the
    // false positives" edit cannot quietly neuter the detector: loosen it enough to ignore
    // `common.selectPlaceholder` and this fails immediately.
    const { isRawTranslationKey } = await import('./zygos-i18n-scan.js');

    // The real defects from this wave.
    expect(isRawTranslationKey('common.selectPlaceholder')).toBe(true);
    expect(isRawTranslationKey('uiTables.filters.apply')).toBe(true);
    expect(isRawTranslationKey('quizTemplates.cancel')).toBe(true);
    expect(isRawTranslationKey('instructions.form.error.currencyInvalid')).toBe(true);

    // Legitimate strings this console can genuinely display.
    expect(isRawTranslationKey('statement.pdf')).toBe(false);
    expect(isRawTranslationKey('app.finreg.dloizides.com')).toBe(false);
    expect(isRawTranslationKey('v1.2.3')).toBe(false);
    expect(isRawTranslationKey('1.5')).toBe(false);
    expect(isRawTranslationKey('Choose a currency.')).toBe(false);
    expect(isRawTranslationKey('checker-c@zygos.test')).toBe(false);
    expect(isRawTranslationKey('EUR')).toBe(false);
  });
});
