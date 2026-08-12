/**
 * Kefi CREW & COMMISSIONS + PRICING — authenticated interactive verification.
 *
 * The organizer `promoters` tab now renders the merged `CrewCommissionsSurface`
 * (kefi-web crew/index.tsx) and `passes` is re-labelled "Pricing". The tab KEYS
 * are unchanged (`organizer-tab-passes` / `organizer-tab-promoters`) — only the
 * LABELS and the promoters-tab CONTENT changed. This is the human-equivalent
 * proof those two surfaces OPERATE when a real signed-in organizer clicks
 * through them — the gap wired+deployed checks (401/403-not-404, strings-in-
 * bundle) cannot close.
 *
 * WITNESSES: (1) Pricing label + closed-by-default add-a-ticket accordion that
 * opens the pass form; (2) Crew & Commissions label + the unified roster; (3) the
 * commission policy ("who gets what": three type options + baseline→role→
 * exception→effective per-person breakdown); (4) personal-link presence + Copy +
 * an Expire action; (5) phone-width caret-menu reachability.
 *
 * AUTH (no form typing): same-origin `POST /bff/login` (ROPC terminated server-
 * side, opaque `__Host-bff-kefi` cookie). Uses the suite's `KEFI_TEST_*` UBS
 * organizer from `.env.<target>.secrets`; these surfaces are tenant-agnostic.
 *
 * PROD SAFETY — STRICTLY READ-ONLY: opens the accordion + a per-person detail
 * modal and reads the Copy/Expire controls. NEVER writes: no pass saved, no
 * policy PUT, Copy (which would create a link) and Expire are never pressed.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';
import { KefiOrganizerTabsPage } from '../../pages/kefi/KefiOrganizerTabsPage.js';

test.describe.configure({ mode: 'serial' });

const USERNAME = process.env.KEFI_TEST_USERNAME ?? '';
const PASSWORD = process.env.KEFI_TEST_PASSWORD ?? '';
const HAVE_CREDS = USERNAME !== '' && PASSWORD !== '';

/** Where the PASS/FAIL evidence screenshots land. */
const SHOT_DIR = 'qa-screenshots/crew-commissions-pricing';

/** The BFF proxy prefix + the organizer events read-model (used to resolve the event). */
const BFF_EVENTS_PATH = '/bff/api/kefi/api/v1/admin/events';

/** A phone viewport wide enough to trip the shared Tabs collapse (<768dp). */
const PHONE = { width: 390, height: 844 } as const;

/**
 * Same-origin `POST /bff/login` inside a loaded page — the exact call the SPA's
 * BffAuthClient makes. After it resolves the context holds the `__Host-bff-kefi`
 * session cookie. No token touches the browser; no form is typed.
 */
async function bffLogin(page: Page): Promise<void> {
  const { webUrl } = getKefiUrls();
  await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const result = await page.evaluate(
    async (creds: { username: string; password: string }) => {
      const res = await fetch('/bff/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
        body: JSON.stringify(creds),
      });
      let body = '';
      try {
        body = await res.text();
      } catch {
        /* no body */
      }
      return { status: res.status, body };
    },
    { username: USERNAME, password: PASSWORD },
  );
  expect(
    result.status,
    `POST /bff/login must succeed for ${USERNAME} — got ${result.status}: ${result.body.slice(0, 200)}`,
  ).toBe(200);
  // Re-bootstrap the SPA from the cookie before navigating to a protected route.
  await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

/** Resolve the organizer's first event externalId via the BFF read-model. */
async function resolveEventExternalId(page: Page): Promise<string> {
  const { webUrl } = getKefiUrls();
  const res = await page.request.get(`${webUrl}${BFF_EVENTS_PATH}`, {
    headers: { 'X-BFF-Csrf': '1' },
  });
  expect(res.status(), 'the organizer events read-model returned OK').toBe(200);
  const body = (await res.json()) as { events: Array<{ externalId: string; name: string }> };
  expect(body.events.length, 'the UBS organizer owns at least one event').toBeGreaterThan(0);
  return body.events[0].externalId;
}

test.describe('Kefi Crew & Commissions + Pricing organizer surfaces', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface (E2E_TARGET=prod|staging)');
  test.skip(!HAVE_CREDS, 'KEFI_TEST_USERNAME/PASSWORD unset in .env.<target>.secrets');

  let context: BrowserContext;
  let page: Page;
  let organizer: KefiOrganizerTabsPage;
  let eventExternalId: string;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await bffLogin(page);
    eventExternalId = await resolveEventExternalId(page);
    organizer = new KefiOrganizerTabsPage(page);
    await organizer.gotoEvent(eventExternalId);
    await organizer.waitForShell();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('@ui Pricing tab: label is "Pricing"; the Add-a-ticket-type accordion is closed by default and opens the pass form', async () => {
    await organizer.gotoEvent(eventExternalId);
    await organizer.waitForShell();

    // Label — the `passes` tab now reads "Pricing".
    await expect(organizer.tab('passes'), 'the passes tab is re-labelled "Pricing"').toContainText(
      'Pricing',
    );

    await organizer.selectTab('passes');
    await organizer.expectActiveTab('passes'); // signature: organizer-passes

    const accordion = page.getByTestId('organizer-passes-add-accordion');
    const toggle = page.getByTestId('organizer-passes-add-toggle');
    const codeField = page.getByTestId('organizer-pass-code');

    await expect(accordion, 'the add-a-ticket-type accordion is present').toBeVisible();
    await expect(toggle, 'the accordion toggle is present').toBeVisible();
    // Closed by default: the pass form fields are NOT in the DOM until opened.
    await expect(codeField, 'the pass form is CLOSED by default (no code field rendered)').toHaveCount(
      0,
    );
    await page.screenshot({ path: `${SHOT_DIR}/01a-pricing-accordion-closed.png`, fullPage: true });

    // Pressing the toggle OPENS the pass form.
    await toggle.click();
    await expect(codeField, 'pressing the toggle opened the pass form (code field visible)').toBeVisible();
    await expect(
      page.getByTestId('organizer-pass-label'),
      'the opened pass form renders the label field',
    ).toBeVisible();
    await expect(
      page.getByTestId('organizer-pass-price'),
      'the opened pass form renders the price field',
    ).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/01b-pricing-accordion-open.png`, fullPage: true });

    // Close it again — leave no dirty UI state (nothing was ever submitted).
    await toggle.click();
    await expect(codeField, 'the pass form closed again after re-pressing the toggle').toHaveCount(0);
  });

  test('@ui Crew & Commissions tab: label is "Crew & Commissions"; the unified roster renders real rows', async () => {
    await organizer.gotoEvent(eventExternalId);
    await organizer.waitForShell();

    await expect(
      organizer.tab('promoters'),
      'the promoters tab is re-labelled "Crew & Commissions"',
    ).toContainText('Crew & Commissions');

    await organizer.selectTab('promoters');
    await organizer.expectActiveTab('promoters'); // signature: organizer-crew-roster (RosterSection container)

    // The merged surface's unified roster.
    const roster = page.getByTestId('organizer-crew-roster');
    await expect(roster, 'the unified crew roster section rendered').toBeVisible();
    await expect(
      roster.getByText('Roster', { exact: false }).first(),
      'the roster section carries its title',
    ).toBeVisible();

    // Real rows — the roster read-model returns the tenant's crew (promoters +
    // crew), so at least one "view" row action must be present.
    const viewButtons = page.locator('[data-testid^="organizer-crew-roster-view-"]');
    await expect(
      viewButtons.first(),
      'the roster rendered real rows (at least one per-person view action)',
    ).toBeVisible();
    const rowCount = await viewButtons.count();
    expect(rowCount, 'the roster is a non-empty unified list').toBeGreaterThan(0);

    await page.screenshot({ path: `${SHOT_DIR}/02-crew-roster.png`, fullPage: true });
  });

  test('@ui Commission policy: the "who gets what" surface shows the three type options and a per-person breakdown', async () => {
    await organizer.gotoEvent(eventExternalId);
    await organizer.waitForShell();
    await organizer.selectTab('promoters');
    await organizer.expectActiveTab('promoters');

    // Layer 2 (per-role rates) + Layer 3 (per-person exceptions) — the visible
    // "who gets what".
    const roles = page.getByTestId('organizer-commission-roles');
    const exceptions = page.getByTestId('organizer-commission-exceptions');
    await expect(roles, 'the per-ROLE commission section is visible').toBeVisible();
    await expect(exceptions, 'the per-PERSON exceptions section is visible').toBeVisible();

    // The three commission type options render as always-visible pills inside the
    // matrix cells (SelectField = row of pressable pills, not a native select).
    await expect(
      roles.getByText('Flat', { exact: false }).first(),
      'the Flat €/pass commission type option is visible',
    ).toBeVisible();
    await expect(
      roles.getByText('% of price', { exact: false }).first(),
      'the Percentage commission type option is visible',
    ).toBeVisible();
    await expect(
      roles.getByText('per head', { exact: false }).first(),
      'the Per-head commission type option is visible',
    ).toBeVisible();

    await roles.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOT_DIR}/03a-commission-policy.png`, fullPage: true });

    // A per-person detail — baseline → role → exception → effective breakdown.
    const firstView = page.locator('[data-testid^="organizer-crew-roster-view-"]').first();
    await firstView.scrollIntoViewIfNeeded();
    await firstView.click();

    const modal = page.getByTestId('organizer-crew-detail-modal');
    await expect(modal, 'the per-person detail modal opened').toBeVisible();
    await expect(
      page.getByTestId('organizer-crew-detail'),
      'the detail body rendered',
    ).toBeVisible();
    // The breakdown table (renders once the detail read resolves).
    await expect(
      page.getByTestId('organizer-crew-detail-commission'),
      'the effective-commission breakdown (baseline → role → exception → effective) rendered',
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/03b-commission-person-detail.png`, fullPage: true });

    await page.getByTestId('organizer-crew-detail-close').click();
    await expect(modal, 'the detail modal closed').toBeHidden();
  });

  test('@ui Personal links: a roster row exposes presence + Copy; the per-person detail exposes the link + an Expire action (never pressed)', async () => {
    await organizer.gotoEvent(eventExternalId);
    await organizer.waitForShell();
    await organizer.selectTab('promoters');
    await organizer.expectActiveTab('promoters');

    // Row-level: the personal-link cell = presence text + a Copy control.
    const copyButtons = page.locator('[data-testid^="organizer-crew-copy-link-"]');
    await expect(
      copyButtons.first(),
      'a roster row exposes a personal-link Copy control',
    ).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/04a-personal-link-row.png`, fullPage: true });

    // Per-person detail: the link URL + Copy + an Expire action.
    const firstView = page.locator('[data-testid^="organizer-crew-roster-view-"]').first();
    await firstView.scrollIntoViewIfNeeded();
    await firstView.click();
    await expect(page.getByTestId('organizer-crew-detail-modal'), 'the detail modal opened').toBeVisible();

    await expect(
      page.getByTestId('organizer-crew-detail-link-url'),
      'the detail shows the personal link (URL or an explicit absent state)',
    ).toBeVisible({ timeout: 20_000 });

    // The Copy + Expire controls always render in the detail; both are gated on
    // whether the member owns a LIVE link. A member with no link yet shows the
    // absent state, a copyable Copy control (a copy CREATES the link on demand —
    // a write, so it is NEVER pressed here) and a correctly-DISABLED Expire (there
    // is nothing to expire). We witness the controls are present and record their
    // gated state; we never press Copy or Expire.
    const expire = page.getByTestId('organizer-crew-detail-expire');
    const copy = page.getByTestId('organizer-crew-detail-copy');
    await expect(copy, 'the Copy-link action is present in the detail').toBeVisible();
    await expect(expire, 'the Expire-link action is present in the detail').toBeVisible();
    const expireEnabled = await expire.isEnabled();
    const linkText = (await page.getByTestId('organizer-crew-detail-link-url').innerText()).trim();
    // Record the read-only witnessed state on the test report (not a console log).
    test.info().annotations.push({
      type: 'personal-link-witness',
      description: `detail link-url="${linkText}" · Expire ${expireEnabled ? 'ENABLED (live link)' : 'DISABLED (no live link — correct gating)'}`,
    });
    await page.screenshot({ path: `${SHOT_DIR}/04b-personal-link-detail.png`, fullPage: true });

    await page.getByTestId('organizer-crew-detail-close').click();
  });

  test('@ui @mobile Phone width (390px): the tab bar collapses to the caret menu and both surfaces are reachable', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const phoneContext = await browser.newContext({
      viewport: PHONE,
      isMobile: true,
      hasTouch: true,
    });
    const phone = await phoneContext.newPage();
    try {
      await bffLogin(phone);
      const phoneOrganizer = new KefiOrganizerTabsPage(phone);
      const { webUrl } = getKefiUrls();
      await phone.goto(`${webUrl}/organizer?event=${encodeURIComponent(eventExternalId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });

      // Header up + the wide tab strip collapsed to the single caret trigger.
      await expect(phoneOrganizer.eventHeader, 'the organizer header mounted at phone width').toBeVisible({
        timeout: 45_000,
      });
      const menuTrigger = phone.getByTestId('organizer-menu');
      await expect(menuTrigger, 'the tab bar collapsed to the caret menu at phone width').toBeVisible();
      await expect(
        phone.getByRole('tablist'),
        'the wide horizontal tab strip is NOT rendered at phone width',
      ).toHaveCount(0);
      await phone.screenshot({ path: `${SHOT_DIR}/05a-mobile-collapsed-closed.png`, fullPage: true });

      // Opening the menu surfaces both re-labelled sections.
      await menuTrigger.click();
      await expect(
        phone.getByTestId('organizer-tab-passes'),
        'the Pricing section is reachable through the collapsed menu',
      ).toBeVisible();
      await expect(
        phone.getByTestId('organizer-tab-promoters'),
        'the Crew & Commissions section is reachable through the collapsed menu',
      ).toBeVisible();
      await phone.screenshot({ path: `${SHOT_DIR}/05b-mobile-collapsed-open.png`, fullPage: true });

      // Reaching Crew & Commissions through the phone path actually renders it.
      await phone.getByTestId('organizer-tab-promoters').click();
      await expect(
        phone.getByTestId('organizer-crew-roster'),
        'selecting Crew & Commissions from the caret menu renders the roster',
      ).toBeVisible({ timeout: 20_000 });
      // Wait for the roster READ to resolve into real rows before capturing —
      // the card mounts (with a transient empty state) before the React Query
      // roster settles, so screenshotting on the card alone can catch "0 crew".
      await expect(
        phone.locator('[data-testid^="organizer-crew-roster-view-"]').first(),
        'the roster populated real rows at phone width (same read-model as desktop)',
      ).toBeVisible({ timeout: 20_000 });
      await phone.screenshot({ path: `${SHOT_DIR}/05c-mobile-crew-surface.png`, fullPage: true });
    } finally {
      await phoneContext.close();
    }
  });
});
