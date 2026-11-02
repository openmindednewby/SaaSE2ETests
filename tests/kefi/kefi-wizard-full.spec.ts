import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test, type Page } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import { KefiMailbox, extractVerifyUrl, loadKefiMailboxConfig } from '../../helpers/kefi/kefiMailboxClient.js';
import { setFirstPassPrice } from '../../helpers/kefi/kefiOnboardingApi.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { getKefiUrls, tenantPathUrl } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';
import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';

test.describe.configure({ mode: 'serial' });

const ERROR_BOUNDARY_TITLE = 'Something went wrong';
const VISIBLE_TEXT_SELECTOR = 'body *:not([id^="a11y-hint"]):not(.visually-hidden)';
const STEPS_FROM_PASSES_TO_REVIEW = 5;
const PUBLIC_SITE_BUDGET_MS = 120_000;
const BLANK_PASS_NAME_ISSUE = 'review-issue-onboarding.review.issueField.passName';

async function signUpAndOpenWizard(page: Page, ctx: ReturnType<typeof newCanaryContext>): Promise<KefiOnboardingWizardPage> {
  const marketing = new KefiMarketingPage(page);
  await marketing.goto();
  await marketing.signupAndExpectSuccess({ email: ctx.email, password: ctx.password, tenantName: ctx.tenantName });
  await new KefiSignupSuccessPage(page).expectLoaded();
  const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 60_000, pollIntervalMs: 2_000 });
  const captured = await mailbox.waitForMessageTo(ctx.email);
  const verifyUrl = extractVerifyUrl(captured);
  expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();
  await page.goto(verifyUrl!);
  const wizard = new KefiOnboardingWizardPage(page);
  await wizard.expectLoaded();
  return wizard;
}

test.describe('KEFI-WIZARD-FULL-1 "Setup wizard creates the full site and form"', () => {
  test.skip(!isRemoteTarget(), 'needs a real Keycloak, mailbox and publish job');

  test('canary signup without the admin bearer, is refused and the canary routes stay closed', async ({ request }) => {
    const ctx = newCanaryContext();
    const { apiUrl } = getKefiUrls();

    try {
      const signup = await request.post(`${apiUrl}/api/v1/public/signup`, {
        data: { email: ctx.email, password: ctx.password, tenantName: ctx.tenantName },
      });
      const cleanupAnon = await request.delete(`${apiUrl}/api/v1/internal/canary-cleanup?canaryId=${ctx.canaryId}`);
      const seedAnon = await request.post(`${apiUrl}/api/v1/admin/lifecycle/seed-canary-event`, { data: {} });

      expect(signup.status(), 'signup with a reserved slug and no bearer').toBe(400);
      expect(await signup.text(), 'refusal names the address').toContain('not available');
      expect(cleanupAnon.status(), 'anonymous canary cleanup').toBe(401);
      expect(seedAnon.status(), 'anonymous seed-canary-event').toBe(401);
    } finally {
      await cleanupKefiCanary(ctx.canaryId);
    }
  });

  test('a canary walks all 12 steps with a blank pass row, is refused on Review, then finishes and publishes name, date and pass', async ({ page }) => {
    const ctx = newCanaryContext();
    const adminClient = new KefiAdminClient();
    const eventName = `${ctx.slugPrefix}Wizard Full Night`;
    const eventYear = new Date().getUTCFullYear() + 1;
    const eventDateIso = `${String(eventYear)}-03-14`;
    const eventDateOnPage = /14[^\n]{0,12}Mar|Mar[^\n]{0,12}14/i;
    const passName = 'Full Weekend Pass';
    const passPrice = '45 EUR';
    const pageErrors: string[] = [];
    const textFitFailures: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const checkTextFit = async (where: string): Promise<void> => {
      await expectTextFits(page, VISIBLE_TEXT_SELECTOR, { where }).catch((error: Error) => textFitFailures.push(`${where}: ${error.message}`));
    };
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });

    try {
      const wizard = await signUpAndOpenWizard(page, ctx);

      await wizard.eventNameInput.fill(eventName);
      await wizard.eventLocationInput.fill('Test Venue Nicosia');
      await wizard.eventDateInput.fill(eventDateIso);
      await page.getByTestId('onboarding-event-type-festival').click();
      await checkTextFit('event-basics');
      await wizard.continueToNextStep();

      await wizard.kucyTemplateOption.click();
      await checkTextFit('template-choice');
      await wizard.continueToNextStep();

      await wizard.brandNameInput.fill(eventName);
      await wizard.taglineInput.fill('Three nights of social dancing');
      await checkTextFit('landing-copy');
      await wizard.continueToNextStep();

      await page.getByTestId('landing-form-event-eyebrow').fill('Salsa weekend');
      await checkTextFit('site-about');
      await wizard.continueToNextStep();
      await checkTextFit('site-people');
      await wizard.continueToNextStep();
      await checkTextFit('site-schedule');
      await wizard.continueToNextStep();

      await page.getByTestId('landing-passes-add').click();
      await expect(page.getByTestId('landing-pass-0-name')).toBeVisible();
      await checkTextFit('site-passes');
      await wizard.continueToNextStep();
      await checkTextFit('site-registration');
      await wizard.continueToNextStep();

      await page.getByTestId('landing-form-venue-name').fill('Test Venue Nicosia');
      await checkTextFit('site-venue');
      await wizard.continueToNextStep();
      await checkTextFit('site-media');
      await wizard.continueToNextStep();
      await checkTextFit('site-settings');
      await wizard.continueToNextStep();

      await expect(page.getByTestId('onboarding-step-review')).toBeVisible();
      await expect(page.getByTestId(BLANK_PASS_NAME_ISSUE), 'Review names the blank pass').toBeVisible();
      await expect(wizard.continueButton, 'Finish refuses a blank pass').toBeDisabled();
      await checkTextFit('review-with-issues');

      await wizard.backSteps(STEPS_FROM_PASSES_TO_REVIEW);
      await page.getByTestId('landing-pass-0-name').fill(passName);
      const hasPriceInput = await wizard.passPriceInput(0).isVisible();
      expect.soft(hasPriceInput, 'the wizard pass row offers a price input, Review demands a price').toBe(true);
      if (hasPriceInput) {
        await wizard.passPriceInput(0).fill(passPrice);
      } else {
        await wizard.continueToNextStep();
        await wizard.backSteps(1);
        const bearer = await adminClient.getTenantOwnerBearer({ email: ctx.email, password: ctx.password });
        await setFirstPassPrice({ apiUrl: getKefiUrls().apiUrl, bearer, price: passPrice });
        await page.reload();
        await wizard.expectLoaded();
      }
      await expect(page.getByTestId('landing-pass-0-name')).toHaveValue(passName);
      await wizard.continueSteps(STEPS_FROM_PASSES_TO_REVIEW);

      await expect(page.getByTestId('onboarding-step-review')).toBeVisible();
      await expect(page.getByTestId('review-issues'), 'Review is clean once the pass is filled').toBeHidden();
      await checkTextFit('review-clean');
      await wizard.finishFromReview();

      await expect(page, 'Finish lands on the organizer home').toHaveURL(/\/organizer\/?$/, { timeout: 30_000 });
      await expect(page.getByText(ERROR_BOUNDARY_TITLE), 'no error boundary on /organizer').toBeHidden();
      await expect(page.getByTestId('onboarding-wizard'), 'the wizard does not bounce back').toBeHidden();
      await checkTextFit('organizer-home');

      const published = await adminClient.publishLanding({ ownerEmail: ctx.email, ownerPassword: ctx.password });
      const terminal = await adminClient.pollPublishStatus({
        ownerEmail: ctx.email,
        ownerPassword: ctx.password,
        jobName: published.jobName,
      });
      expect(terminal.status, `publish job ${published.jobName}`).toBe('Succeeded');

      const siteUrl = tenantPathUrl(published.tenantSlug);
      await expect(async () => {
        const response = await page.goto(siteUrl);
        expect(response?.status(), `GET ${siteUrl}`).toBe(200);
        await expect(page.locator('body')).toContainText(eventName, { timeout: 5_000 });
      }).toPass({ timeout: PUBLIC_SITE_BUDGET_MS });
      await expect(page.locator('body'), 'public site shows the date').toContainText(eventDateOnPage);
      await expect(page.locator('body'), 'public site shows the pass').toContainText(passName);
      await expect(page.locator('body'), 'public site shows the price').toContainText(passPrice);
      await checkTextFit('public-site');

      expect(pageErrors, 'uncaught browser errors').toEqual([]);
      expect(textFitFailures, 'TEXT-FIT-1 on every wizard step').toEqual([]);
    } finally {
      const swept = await cleanupKefiCanary(ctx.canaryId, { adminClient });
      test.info().annotations.push({ type: 'canarySwept', description: JSON.stringify(swept) });
    }
  });
});
