// Zygos console @ui (ZY-18) — the SAME features as the @api tier, driven in a real browser.
//
// Two-tier is the platform standard, and this suite is the argument for it: the @api tier here
// is GREEN while the console cannot create a payment instruction at all. A client-name/server-name
// divergence on the create DTO (see "the console cannot create" test below) is invisible to an
// API-only suite by construction — the API tier speaks the server's shape and is right; the
// console speaks a different one and is broken. API-only is not done.
import { expect, test } from '@playwright/test';

import { ZygosApi, instructionBody } from './zygos-client.js';
import { ZYGOS_TEST_PASSWORD, ZYGOS_USERS, zygosTag } from './zygos-helpers.js';
import { loginAs, parkedCookies } from './zygos-session.js';

import type { InstructionDto } from './zygos-client.js';
import type { Page } from '@playwright/test';

/**
 * testIDs mirrored from `zygos/zygos-web/src/shared/testIds.ts` — whose header says
 * "Keep this in sync with E2ETests/shared/testIds". Mirrored here rather than added to the
 * global barrel because they are Zygos-only and that barrel already carries an
 * `eslint-disable max-file-lines` for being over-length.
 *
 * The login ids are DERIVED, not literal: the shared `<LoginForm>` from `@dloizides/auth-web`
 * builds its ids from a prefix (`withTestIdPrefix`) and zygos passes `testIdPrefix="zygos"`
 * ⇒ `auth-login-username` becomes `zygos-auth-login-username`.
 */
const T = {
  loginPage: 'zygos-login-page',
  username: 'zygos-auth-login-username',
  password: 'zygos-auth-login-password',
  submit: 'zygos-auth-login-submit',
  loginError: 'zygos-auth-login-error',

  shell: 'zygos-app-shell',
  logout: 'logout-button',
  dashboard: 'zygos-dashboard-screen',

  instructionsScreen: 'zygos-instructions-screen',
  instructionsNew: 'zygos-instructions-new',
  // The list's search box moved onto the shared `@dloizides/ui-tables` `Filters` bar, whose
  // text field renders its input at `${fieldTestID}-input` (the field's testID is the wrapper).
  instructionsSearch: 'zygos-instructions-search-input',

  formScreen: 'zygos-instruction-form-screen',
  formSubmit: 'zygos-instruction-form-submit',
  formAmount: 'instruction-form-amount',
  formValueDate: 'instruction-form-value-date',
  formRemittance: 'instruction-form-remittance',
  debtorName: 'instruction-form-debtor-name',
  creditorName: 'instruction-form-creditor-name',

  detailScreen: 'zygos-instruction-detail-screen',
  auditTrail: 'zygos-instruction-audit-trail',
  makerNotice: 'zygos-instruction-maker-notice',

  approvalsScreen: 'zygos-approvals-screen',
} as const;

/** `zygos-instruction-action-approve`, etc. — see `actionTestID` in zygos-web. */
const action = (name: string): string => `zygos-instruction-action-${name}`;
const id = (testId: string): string => `[data-testid="${testId}"]`;

/** Drive the real login FORM. Used where logging in IS the subject of the test. */
async function loginViaUi(page: Page, username: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'commit' });
  await expect(page.locator(id(T.loginPage))).toBeVisible();

  await page.locator(id(T.username)).fill(username);
  await page.locator(id(T.password)).fill(ZYGOS_TEST_PASSWORD);
  await page.locator(id(T.submit)).click();

  // The shell renders only behind the protected-route guard, so seeing it IS the assertion that
  // auth succeeded — no need to also poll the URL.
  await expect(page.locator(id(T.shell))).toBeVisible({ timeout: 20_000 });
}

/**
 * Enter the console as `username` using an already-minted session cookie.
 *
 * The login budget is 5/60s PER IP and shared by both tiers (see zygos-helpers.parkedCookies).
 * A UI tier that retypes the password in every test needs ~7 logins, 429s, and then reports a
 * throttle as a product failure. The cookie injected here is real and server-issued; the login
 * FORM has its own dedicated tests above. Nothing is mocked — only a redundant retype is skipped.
 */
async function enterConsoleAs(page: Page, username: string): Promise<void> {
  const cookies = await parkedCookies(username);
  expect(cookies.length, `no session could be minted for ${username}`).toBeGreaterThan(0);

  await page.context().clearCookies();
  await page.context().addCookies(cookies);

  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator(id(T.shell))).toBeVisible({ timeout: 20_000 });
}

/** Fill the create form with the fields a real operator must type. */
async function fillCreateForm(page: Page, tag: string): Promise<void> {
  await expect(page.locator(id(T.formScreen))).toBeVisible();

  // Only the text inputs. `currency` and `direction` are ModalDropdowns (a button that opens a
  // modal — NOT an input; `.fill()` fails with "Element is not an <input>") and both already
  // default sensibly via `emptyFormValues()`, as does `valueDate`. Leaving them exercises the
  // default path a real operator gets.
  await page.locator(id(T.formAmount)).fill('150.25');
  await page.locator(id(T.formValueDate)).fill('2026-08-01');
  await page.locator(id(T.debtorName)).fill(`Debtor ${tag}`);
  await page.locator(id(T.creditorName)).fill(`Creditor ${tag}`);
  await page.locator(id(T.formRemittance)).fill(tag);
}

test.describe('Zygos console @zygos-ui @ui', () => {
  // NOT serial. Each test mints/injects its own session and owns its data, so they are
  // independent and re-runnable in any order. This is load-bearing rather than stylistic: under
  // `mode: 'serial'` the (genuinely failing) create test cascade-SKIPPED every approval test
  // after it, hiding the maker-checker UI coverage behind an unrelated defect.

  test('🔴 login lands on the console — and logout locks it again', async ({ page }) => {
    await loginViaUi(page, ZYGOS_USERS.MAKER_A);
    await expect(page.locator(id(T.dashboard))).toBeVisible();

    await page.locator(id(T.logout)).click();

    // Both assertions matter: a logout that leaves the shell mounted has not locked anything.
    await expect(page.locator(id(T.loginPage))).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(id(T.shell))).not.toBeVisible();
  });

  test('a protected route is not reachable without a session', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/instructions', { waitUntil: 'commit' });

    // The guard must bounce to login rather than render an empty, broken console.
    await expect(page.locator(id(T.loginPage))).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(id(T.instructionsScreen))).not.toBeVisible();
  });

  test('bad credentials show an error and do not enter the console', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'commit' });
    await page.locator(id(T.username)).fill(ZYGOS_USERS.MAKER_A);
    await page.locator(id(T.password)).fill('definitely-not-the-password');
    await page.locator(id(T.submit)).click();

    await expect(page.locator(id(T.loginError))).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(id(T.shell))).not.toBeVisible();
  });

  test('🔴 an operator can create a payment instruction through the console', async ({ page }) => {
    // 🔴 THIS IS THE TEST AN API-ONLY SUITE CANNOT WRITE, AND IT FAILS.
    //
    // The console POSTs `{debtorSnapshot, creditorSnapshot}` — named after the DOMAIN ENTITY's
    // properties (`PaymentInstruction.DebtorSnapshot`). The API's create DTO expects
    // `{debtor, creditor}` (`CreatePaymentInstructionRequest`). The mismatched fields bind to
    // empty objects, and the handler answers 400 "Supply either a partyExternalId or a
    // counterparty name."
    //
    // This is the EXACT failure contract §3 pinned the canonical list query for: "the two halves
    // diverged (backend `Statuses` plural vs frontend `status` singular) — a silent integration
    // break neither side owned". Same shape, different field, still unowned. The response DTO
    // also returns `debtor`/`creditor` while the console reads `debtorSnapshot`/`creditorSnapshot`,
    // so the divergence runs in both directions.
    await enterConsoleAs(page, ZYGOS_USERS.MAKER_A);

    const tag = `ZY18UI-create-${Date.now().toString(36)}`;
    await page.goto('/instructions', { waitUntil: 'commit' });
    await page.locator(id(T.instructionsNew)).click();
    await fillCreateForm(page, tag);

    // Wait for the POST specifically — "the next screen appeared" would also be satisfied by a
    // validation error re-render.
    const posted = page.waitForResponse(
      (r) => r.url().includes('/payment-instructions') && r.request().method() === 'POST',
    );
    await page.locator(id(T.formSubmit)).click();
    const res = await posted;

    expect(
      res.status(),
      `The console cannot create a payment instruction. It sends {debtorSnapshot, creditorSnapshot}; ` +
        `the API's CreatePaymentInstructionRequest expects {debtor, creditor}. Server said: ${await res.text()}`,
    ).toBe(201);

    // And the operator can find what they made.
    await page.goto('/instructions', { waitUntil: 'commit' });
    await page.locator(id(T.instructionsSearch)).fill(tag);
    await expect(page.getByText(`Creditor ${tag}`)).toBeVisible({ timeout: 15_000 });
  });

  test.describe('the approval surface', () => {
    /**
     * Seed an instruction at PendingApproval via the API.
     *
     * ⚠️ Deliberate, narrow exception to "never bypass the UI" — and it is not the usual excuse
     * of "API setup is faster". The console's create path is BROKEN (the test above), so seeding
     * through it is impossible right now. Creation still has its own dedicated UI test above;
     * these tests are about the APPROVAL surface, and blocking every approval assertion on an
     * unrelated create defect would mean shipping zero UI coverage of maker-checker — the one
     * control that most needs it. When create is fixed, this can move back onto the UI.
     */
    async function seedPendingApproval(): Promise<{ instruction: InstructionDto; tag: string }> {
      const session = await loginAs(ZYGOS_USERS.MAKER_A);
      expect(session, 'API seeding needs a maker session').toBeTruthy();
      const api = new ZygosApi(session!);

      const tag = zygosTag('ui-approval');
      const created = (await (await api.create(instructionBody(tag))).json()) as InstructionDto;
      expect((await api.validate(created.externalId)).status()).toBe(200);
      expect((await api.submitForApproval(created.externalId)).status()).toBe(200);

      return { instruction: created, tag };
    }

    test('🔴 the detail screen shows the instruction and its audit trail', async ({ page }) => {
      // 🔴 THE DETAIL SCREEN CRASHES — the read half of the same field-name divergence.
      //
      // `formatInstruction.ts:72` reads `instruction.debtorSnapshot`, but the API's response DTO
      // returns `debtor`. So `debtorSnapshot` is `undefined`, `.name` throws
      // `TypeError: Cannot read properties of undefined (reading 'name')`, the ErrorBoundary
      // catches it, and the operator gets a blank page. Captured live from the browser console.
      //
      // ⚠️ Note WHY the unit tests do not catch this: `instructionSchema.test.ts` asserts the
      // mapper against the FRONTEND'S OWN `InstructionInput` type — the imagined shape checked
      // against itself. It is green and always will be. Only a request to the real server can
      // see the divergence, which is the entire argument for this tier.
      const { instruction } = await seedPendingApproval();

      const crashes: string[] = [];
      page.on('pageerror', (e) => crashes.push(e.message));

      await enterConsoleAs(page, ZYGOS_USERS.MAKER_A);
      await page.goto(`/instructions/${instruction.externalId}`, { waitUntil: 'commit' });

      await expect(
        page.locator(id(T.detailScreen)),
        `the instruction detail screen must render. Browser errors: ${JSON.stringify(crashes.slice(0, 2))}`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(id(T.auditTrail))).toBeVisible();

      // Every transition we drove must be visible to the operator, not merely stored.
      await expect(page.locator(id(T.auditTrail))).toContainText('Validated');
    });

    test('🔴 the console does not OFFER approve to a contributor — and does to an uninvolved user', async ({ page }) => {
      // The UI half of maker-checker. The server's 403 is the CONTROL (proven in the @api tier);
      // this is the courtesy: an operator should not have to click a button to discover it was
      // never theirs to click. Both halves must exist — a console that offers the button teaches
      // its users the control is arbitrary.
      const { instruction } = await seedPendingApproval();
      const detailUrl = `/instructions/${instruction.externalId}`;

      // maker-a created it ⇒ contributor ⇒ approve withheld, with a notice saying why.
      await enterConsoleAs(page, ZYGOS_USERS.MAKER_A);
      await page.goto(detailUrl, { waitUntil: 'commit' });
      await expect(page.locator(id(T.detailScreen))).toBeVisible({ timeout: 15_000 });

      await expect(
        page.locator(id(T.makerNotice)),
        'the console must tell the maker WHY approve is unavailable, not silently hide it',
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(id(action('approve'))), 'approve must not be offered to a contributor').toHaveCount(0);

      // ── DISCRIMINATION: the same screen, as an uninvolved checker ────────────────────────
      // Without this leg, "no approve button" is equally consistent with "the button never
      // renders for anyone" — a broken console rather than an enforced control.
      await enterConsoleAs(page, ZYGOS_USERS.CHECKER_C);
      await page.goto(detailUrl, { waitUntil: 'commit' });
      await expect(page.locator(id(T.detailScreen))).toBeVisible({ timeout: 15_000 });

      await expect(
        page.locator(id(action('approve'))),
        'an uninvolved checker MUST be offered approve — otherwise the maker seeing no button proves nothing',
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(id(T.makerNotice))).toHaveCount(0);

      // And it works end-to-end, not merely renders.
      await page.locator(id(action('approve'))).click();
      await expect(page.locator(id(T.auditTrail))).toContainText('Approved', { timeout: 15_000 });
    });

    test('the approvals queue renders for a checker', async ({ page }) => {
      await enterConsoleAs(page, ZYGOS_USERS.CHECKER_C);
      await page.goto('/approvals', { waitUntil: 'commit' });
      await expect(page.locator(id(T.approvalsScreen))).toBeVisible({ timeout: 15_000 });
    });
  });
});
