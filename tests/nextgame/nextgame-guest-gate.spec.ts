import { expect, test, type Page } from '@playwright/test';

import {
  AGE_ROUTE,
  CONSENT_ROUTE,
  EMPTY_LIBRARY_ROUTE,
  GATED_ROUTES,
  interceptAnalytics,
  SPA_URL,
  TestIds,
} from '../../fixtures/nextgame-web';
import { GUEST_SESSION_PREFIX } from '../../../nextgame-web/src/store/guestSession/guestSessionTypes';
import { POLICY_VERSION } from '../../../nextgame-web/src/shared/privacyFacts';

/**
 * GUEST-GATE-E2E-1. `useSetupGate` (nextgame-web/src/stage/hooks/useSetupGate.ts) over
 * `setupRedirect` (src/stage/utils/setupGate.ts) is mounted on seven routes, and before this spec
 * existed the whole nextgame suite stayed green with the gate deleted: nextgame-browser.spec.ts
 * hard-loads UNGATED_ROUTES only, and nextgame-signed-in.spec.ts drives the SIGNED-IN path.
 *
 * A fresh Playwright context IS the guest: nextgame has no anonymous cookie, and the session probe
 * resolves to 'signedOut' with no `__Host-nextgame-session` present. Nothing is seeded by hand.
 *
 * A guest's ANSWERS now outlive the tab: attachGuestSession (src/store/guestSession/) mirrors
 * birthYearKnown + guestConsent to localStorage under GUEST_SESSION_PREFIX, so a hard reload no
 * longer throws a guest back to /age. The two tests at the foot of this file cover that, and each
 * one asserts its converse in the same test - a persistence-only assertion would pass just as well
 * with the gate deleted, which is the hole this spec exists to close.
 *
 * The tests above predate the persistence and still hold: a context that has STORED nothing is
 * still the never-been-here visitor, and the mid-session hop still never touches storage by hand.
 */
const BIRTH_YEAR = '1991';

test.describe('nextgame guest setup gate', () => {
  test.beforeEach(async ({ page }) => {
    // Runs against a deployed host as well as the Tilt resource: never record a test pageview.
    await interceptAnalytics(page);
  });

  for (const route of GATED_ROUTES) {
    test(`a guest with no birth year who hard-loads ${route.path} lands on /age`, async ({ page }) => {
      await page.goto(`${SPA_URL}${route.path}`);

      // The redirect, not a coincidence: the URL is /age AND the age step is what rendered.
      await expect(page).toHaveURL(`${SPA_URL}${AGE_ROUTE.path}`);
      await expect(page.getByTestId(AGE_ROUTE.screenTestId)).toBeVisible();
      // The static export ships the destination screen's markup, so this is the assertion that
      // separates "the gate blanked and replaced it" from "it painted and stayed".
      await expect(page.getByTestId(route.screenTestId)).toHaveCount(0);
    });
  }

  test('a guest who gives a birth year reaches /consent and the consent step does NOT bounce', async ({ page }) => {
    await giveBirthYear(page);

    // app/consent.tsx passes REQUIRE_CONSENT false, so the step that COLLECTS the acceptance must
    // render for a guest who has none. Asserted after the screen is interactive, because a bounce
    // fires from an effect one tick after paint.
    await expect(page).toHaveURL(`${SPA_URL}${CONSENT_ROUTE.path}`);
    await expect(page.getByTestId(TestIds.CONSENT_SCREEN)).toBeVisible();
    await expect(page.getByTestId(TestIds.CONSENT_CONTINUE)).toBeVisible();
    await expect(page).toHaveURL(`${SPA_URL}${CONSENT_ROUTE.path}`);
  });

  test('a guest with a birth year but no consent lands on /consent when entering /quiz', async ({ page }) => {
    await giveBirthYear(page);
    await expect(page.getByTestId(TestIds.CONSENT_CONTINUE)).toBeVisible();

    await navigateClientSide(page, '/quiz');

    await expect(page).toHaveURL(`${SPA_URL}${CONSENT_ROUTE.path}`);
    await expect(page.getByTestId(TestIds.CONSENT_SCREEN)).toBeVisible();
    await expect(page.getByTestId(TestIds.QUIZ_SCREEN)).toHaveCount(0);
  });
  /**
   * GUEST-GATE-E2E-2. Before the SlotStore landed, this reload bounced to /age. Both halves live in
   * ONE test on purpose: the persistence assertion alone would stay green with the gate deleted.
   */
  test('a completed guest survives a hard reload of a gated route, and a context that stored nothing still bounces to /age', async ({ browser, page }) => {
    await completeGuestSetup(page);

    // The reload. Same browser context, so localStorage is the only thing carrying the answers over.
    await page.goto(`${SPA_URL}${EMPTY_LIBRARY_ROUTE.path}`);

    await expect(page).toHaveURL(`${SPA_URL}${EMPTY_LIBRARY_ROUTE.path}`);
    await expect(page.getByTestId(EMPTY_LIBRARY_ROUTE.screenTestId)).toBeVisible();
    await expect(page.getByTestId(AGE_ROUTE.screenTestId)).toHaveCount(0);
    // Re-read after the screen is interactive: the old bounce fired from an effect one tick after paint.
    await expect(page).toHaveURL(`${SPA_URL}${EMPTY_LIBRARY_ROUTE.path}`);

    // The converse, in the same test: a context with nothing stored is still gated.
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await interceptAnalytics(freshPage);
      await freshPage.goto(`${SPA_URL}${EMPTY_LIBRARY_ROUTE.path}`);

      await expect(freshPage).toHaveURL(`${SPA_URL}${AGE_ROUTE.path}`);
      await expect(freshPage.getByTestId(AGE_ROUTE.screenTestId)).toBeVisible();
      await expect(freshPage.getByTestId(EMPTY_LIBRARY_ROUTE.screenTestId)).toHaveCount(0);
    } finally {
      await freshContext.close();
    }
  });

  /**
   * GUEST-GATE-E2E-3. restoreGuestSession.ts:20 compares the stored policyVersion on READ and drops a
   * superseded consent while KEEPING the age answer. The destination IS the assertion: a new policy
   * version is not an age problem, and sending someone to /age for one is a lie they then act on.
   */
  test('a stored consent stamped with a superseded POLICY_VERSION re-asks on /consent, not /age', async ({ page }) => {
    // Guards the test against decaying into a no-op if POLICY_VERSION is ever rolled back to '1'.
    expect(SUPERSEDED_POLICY_VERSION).not.toBe(POLICY_VERSION);
    await completeGuestSetup(page);

    const stamped = await supersedeStoredPolicyVersion(page);
    // The edit is verified before it is relied on: a no-op write would make the assertions below vacuous.
    expect(stamped).toEqual({ birthYearKnown: true, policyVersion: SUPERSEDED_POLICY_VERSION });

    await page.goto(`${SPA_URL}${EMPTY_LIBRARY_ROUTE.path}`);

    await expect(page).toHaveURL(`${SPA_URL}${CONSENT_ROUTE.path}`);
    await expect(page.getByTestId(TestIds.CONSENT_SCREEN)).toBeVisible();
    // The age answer SURVIVED the drop, so /age is the wrong destination and must not be where we are.
    await expect(page.getByTestId(AGE_ROUTE.screenTestId)).toHaveCount(0);
    await expect(page.getByTestId(EMPTY_LIBRARY_ROUTE.screenTestId)).toHaveCount(0);
    await expect(page).toHaveURL(`${SPA_URL}${CONSENT_ROUTE.path}`);
  });
});

/** One below the live POLICY_VERSION ('2'), i.e. a version this build no longer accepts. */
const SUPERSEDED_POLICY_VERSION = '1';

/** Drives the real /age and /consent screens end to end, so storage is written the way the app writes it. */
async function completeGuestSetup(page: Page): Promise<void> {
  await giveBirthYear(page);
  await expect(page.getByTestId(TestIds.CONSENT_SCREEN)).toBeVisible();
  await page.getByTestId(TestIds.CONSENT_CONTINUE).click();
  await expect(page).toHaveURL(`${SPA_URL}${EMPTY_LIBRARY_ROUTE.path}`);
  await expect(page.getByTestId(EMPTY_LIBRARY_ROUTE.screenTestId)).toBeVisible();
}

/**
 * Rewrites ONLY the policyVersion of the record the app itself just wrote - the one edit a visitor's
 * browser genuinely undergoes when the policy text is bumped under a stored consent. The record is
 * found by GUEST_SESSION_PREFIX rather than a hardcoded key, so SlotStore's slot naming stays its own.
 */
async function supersedeStoredPolicyVersion(page: Page): Promise<{ birthYearKnown: boolean; policyVersion: string }> {
  return page.evaluate(
    ([prefix, superseded]) => {
      const key = Object.keys(window.localStorage).find((candidate) => candidate.startsWith(prefix));
      if (key === undefined) throw new Error(`no localStorage key under ${prefix}: the guest flow stored nothing`);
      const record = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      if (record?.guestConsent == null) throw new Error(`${key} holds no guestConsent to supersede`);
      record.guestConsent.policyVersion = superseded;
      window.localStorage.setItem(key, JSON.stringify(record));
      const written = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      return { birthYearKnown: written.birthYearKnown === true, policyVersion: written.guestConsent.policyVersion };
    },
    [GUEST_SESSION_PREFIX, SUPERSEDED_POLICY_VERSION] as const,
  );
}

/** Drives the real /age screen, so the year is set the way the app sets it - never written by hand. */
async function giveBirthYear(page: Page): Promise<void> {
  await page.goto(`${SPA_URL}${AGE_ROUTE.path}`);
  await expect(page.getByTestId(AGE_ROUTE.screenTestId)).toBeVisible();
  await page.getByTestId(TestIds.AGE_BIRTH_YEAR).fill(BIRTH_YEAR);
  await page.getByTestId(TestIds.AGE_CONTINUE).click();
}

/**
 * The app offers a birth-year-known guest no link into a consent-requiring route - by design, the
 * only way on is through the consent step - and a hard load would drop the in-memory year. So the
 * entry is made the way the router itself makes one: push the URL, then the popstate that
 * expo-router's web linking listens on. No app state is touched.
 */
async function navigateClientSide(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
