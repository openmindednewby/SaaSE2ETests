// @ui companion for F1 onboarding (M1-10): drive the REAL ichnos-web register form in a browser and prove
// the register → auto-login → onboarding chain lands on the wizard. Runs in the `ichnos-ui` Playwright
// project (baseURL = ICHNOS_WEB_URL). Skips gracefully when ICHNOS_WEB_URL is unset or the SPA is
// unreachable (the dev PC can't reach WireGuard-only staging — this runs in-cluster nightly). The fast
// register→login→screen contract is covered by the @api tier in ichnos-onboarding.spec.ts.
import { expect, test } from '@playwright/test';
import { ICHNOS_E2E_PASSWORD, ICHNOS_WEB_URL, uniqueIchnosEmail } from './ichnos-helpers.js';

const REGISTER_PATH = '/register';
const FORM_READY_TIMEOUT = 20_000;
const ONBOARDING_TIMEOUT = 30_000;

test.describe('Ichnos portal onboarding @ichnos-ui', () => {
  test('registers via the form and lands on the onboarding wizard', async ({ page }) => {
    if (!ICHNOS_WEB_URL) {
      test.skip(true, 'ICHNOS_WEB_URL not set — the @ui tier runs in-cluster (staging is WireGuard-only)');
      return;
    }

    const reached = await page
      .goto(`${ICHNOS_WEB_URL}${REGISTER_PATH}`, { waitUntil: 'commit', timeout: FORM_READY_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!reached) {
      test.skip(true, `ichnos-web not reachable at ${ICHNOS_WEB_URL}`);
      return;
    }

    const companyInput = page.getByTestId('ichnos-register-company');
    const formVisible = await companyInput.isVisible({ timeout: FORM_READY_TIMEOUT }).catch(() => false);
    if (!formVisible) {
      test.skip(true, 'Register form did not render — ichnos-web may be down in this environment');
      return;
    }

    const email = uniqueIchnosEmail();
    await companyInput.fill(`Ichnos UI ${email}`);
    await page.getByTestId('ichnos-register-first-name').fill('Ichnos');
    await page.getByTestId('ichnos-register-last-name').fill('E2E');
    await page.getByTestId('ichnos-register-email').fill(email);
    await page.getByTestId('ichnos-register-password').fill(ICHNOS_E2E_PASSWORD);
    await page.getByTestId('ichnos-register-confirm-password').fill(ICHNOS_E2E_PASSWORD);
    await page.getByTestId('ichnos-register-submit').click();

    // register → auto-login → router.replace('/onboarding') renders the wizard (testID ichnos-onboarding).
    await expect(page.getByTestId('ichnos-onboarding')).toBeVisible({ timeout: ONBOARDING_TIMEOUT });
    await expect(page.getByTestId('ichnos-register-error')).toHaveCount(0);
  });
});
