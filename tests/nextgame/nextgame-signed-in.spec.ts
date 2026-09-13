import { expect, test } from '@playwright/test';

// Imported, never hardcoded: a policy bump must move the stored-row expectation with it.
import { POLICY_VERSION } from '../../../nextgame-web/src/shared/privacyFacts';
import {
  birthYearFor,
  browserCookie,
  consentRowsFor,
  createSignedInUser,
  deleteUser,
  type NextGameUser,
} from '../../fixtures/nextgame-session';
import {
  AGE_CONSENT_FAILED_TEXT,
  collectConsoleErrors,
  interceptAnalytics,
  SPA_URL,
  TestIds,
} from '../../fixtures/nextgame-web';

const BIRTH_YEAR = '1991';
const RECOMMENDATIONS_PURPOSE = 0;
const INSIGHTS_PURPOSE = 1;

/**
 * Every other browser test is signed-out, so none of them could see a gate that blocks a REAL
 * user: an empty 204 from the consent write once threw in the client and stranded everyone on
 * this screen with `age.consentFailed`. This drives that exact path — a seeded user with the
 * API's own session cookie, through the served SPA behind nginx, into Postgres and back.
 */
test.describe('nextgame signed-in age and consent gate', () => {
  // The SW claims the page and reloads it twice within ~1s of a first visit, which can wipe a
  // half-typed form mid-test. SW behaviour has its own test; this one is about the gate.
  test.use({ serviceWorkers: 'block' });

  let user: NextGameUser;

  test.beforeEach(async ({ page }) => {
    await interceptAnalytics(page);
    user = createSignedInUser();
    await page.context().addCookies([browserCookie(user.cookie, SPA_URL)]);
  });

  test.afterEach(() => {
    deleteUser(user.userId);
  });

  test('records birth year and both consents through the UI and moves past the gate', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(`${SPA_URL}/age`);
    await expect(page.getByTestId(TestIds.AGE_SCREEN)).toBeVisible();

    await page.getByTestId(TestIds.AGE_BIRTH_YEAR).fill(BIRTH_YEAR);
    // Required and locked on. RN-web does not render accessibilityState.checked as aria-checked,
    // so the toggle's effect is proven by the stored rows below, not by the DOM.
    await expect(page.getByTestId(TestIds.AGE_CONSENT_RECOMMENDATIONS)).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId(TestIds.AGE_CONSENT_INSIGHTS).click();
    await page.getByTestId(TestIds.AGE_CONTINUE).click();

    // Wait for EITHER outcome so a blocked gate fails fast and names itself.
    const blocked = page.getByText(AGE_CONSENT_FAILED_TEXT, { exact: true });
    const importing = page.getByTestId(TestIds.IMPORTING_SCREEN);
    await expect(importing.or(blocked)).toBeVisible();
    await expect(blocked, 'gate blocked: age.consentFailed is shown').toHaveCount(0);
    await expect(page).toHaveURL(`${SPA_URL}/importing`);
    await expect(importing).toBeVisible();
    // Snapshot at arrival: what the import screen does next needs Steam and is out of scope.
    expect(errors, `console errors through the gate:\n${errors.join('\n')}`).toEqual([]);

    expect(birthYearFor(user.userId)).toBe(BIRTH_YEAR);
    expect(consentRowsFor(user.userId).sort()).toEqual([
      `${String(RECOMMENDATIONS_PURPOSE)}|true|${POLICY_VERSION}`,
      `${String(INSIGHTS_PURPOSE)}|true|${POLICY_VERSION}`,
    ]);
  });
});
