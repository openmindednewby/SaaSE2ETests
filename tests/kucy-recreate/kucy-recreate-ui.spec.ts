import { expectTextFits } from '@dloizides/game-e2e';
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { newCanaryContext, type KefiCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import { probeDynamicLandingRender } from '../../helpers/kefi/kefiDynamicLandingProbe.js';
import { publicTenantPath } from '../../helpers/kefi/kefiLandingPeopleFixture.js';
import { KefiMailbox, extractVerifyUrl, loadKefiMailboxConfig } from '../../helpers/kefi/kefiMailboxClient.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { decodeHtml, loadKucyRecreate, matrixRows, missingFrom } from '../../helpers/kefi/kucyRecreate.js';
import { fieldGaps, gapRoots, type KucyWalkView } from '../../helpers/kefi/kucyRecreateUiGaps.js';
import { isRemoteTarget } from '../../helpers/target.js';
import { walkBookPay, walkParty, walkPeople, walkSchedule } from '../../helpers/kefi/kucyRecreateUiWalk.js';
import { KefiLandingEditorPage } from '../../pages/kefi/KefiLandingEditorPage.js';
import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DATE_ISO = '2027-04-24';
const SIGNUP_MIN_FILL_MS = 3_500;
const VISIBLE_TEXT_SELECTOR = 'body *:not([id^="a11y-hint"]):not(.visually-hidden):not(.nav-links a)';
const WIDE_MIN_WIDTH = 1280;
const STEPS_ABOUT_TO_PASSES = 3;
const STEPS_PASSES_TO_VENUE = 2;
const STEPS_VENUE_TO_REVIEW = 3;
const PUBLISH_RENDER_TIMEOUT_MS = 900_000;
const PAGE_FETCH_MS = 60_000;
const TEARDOWN_404_TIMEOUT_MS = 120_000;
const WALKED_ROWS = new Set(['CM-03', 'CM-04', 'CM-05', 'CM-08', 'CM-13', 'CM-14', 'CM-15', 'CM-29', 'CM-30', 'CM-32', 'CM-33', 'CM-35', 'CM-37', 'CM-43']);
const data = loadKucyRecreate();
const c = data.config as unknown as KucyWalkView;

const ctx = newCanaryContext();
const quickCtx = newCanaryContext();
const adminClient = new KefiAdminClient();
const pageErrors: string[] = [];
const noControl: string[] = [];
let slug = '';
let html = '';
let saved: object = {};

function priceDigits(price: string): string {
  return price.replace(/[^\d.]/g, '');
}

async function signUpThroughUi(page: Page, canary: KefiCanaryContext): Promise<KefiOnboardingWizardPage> {
  const marketing = new KefiMarketingPage(page);
  page.on('response', (resp) => {
    if (resp.url().includes('/public/signup')) void resp.text().catch(() => '').then((body) => test.info().annotations.push({ type: 'signup', description: `${String(resp.status())} ${body.slice(0, 300)}` }));
  });
  await marketing.goto();
  await delay(SIGNUP_MIN_FILL_MS);
  await marketing.signupAndExpectSuccess({ email: canary.email, password: canary.password, tenantName: canary.tenantName });
  await new KefiSignupSuccessPage(page).expectLoaded();
  const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: 60_000, pollIntervalMs: 2_000 });
  const verifyUrl = extractVerifyUrl(await mailbox.waitForMessageTo(canary.email));
  expect(verifyUrl, 'verify URL in the signup mail').not.toBeNull();
  await page.goto(verifyUrl!);
  const wizard = new KefiOnboardingWizardPage(page);
  await wizard.expectQuickStartLoaded();
  return wizard;
}

async function sight(page: Page, screen: string): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: join(process.env.SIGHTING_DIR ?? test.info().outputDir, `obq-${screen}-${project}.png`), fullPage: true });
  await expectTextFits(page, VISIBLE_TEXT_SELECTOR, { where: `${screen} ${project}` });
}

async function walkWizard(page: Page, wizard: KefiOnboardingWizardPage, editor: KefiLandingEditorPage): Promise<string> {
  await wizard.openStepByStep();
  await wizard.eventNameInput.fill(c.branding.name);
  await wizard.eventLocationInput.fill(c.eventDetails.locationLabel);
  await wizard.eventDateInput.fill(EVENT_DATE_ISO);
  await page.getByTestId('onboarding-event-type-festival').click();
  await wizard.continueToNextStep();
  await wizard.kucyTemplateOption.click();
  await wizard.continueToNextStep();
  await wizard.brandNameInput.fill(c.branding.name);
  await wizard.taglineInput.fill(c.branding.tagline);
  await wizard.editionInput.fill(c.branding.edition);
  await wizard.descriptionInput.fill(c.eventDetails.description);
  await wizard.continueToNextStep();
  await editor.fill('landing-form-event-eyebrow', c.eventDetails.eyebrow);
  await wizard.continueSteps(STEPS_ABOUT_TO_PASSES);
  for (const [index, pass] of c.passes.entries()) {
    await page.getByTestId('landing-passes-add').click();
    await editor.fill(`landing-pass-${String(index)}-name`, pass.name);
    await editor.fill(`landing-pass-${String(index)}-price`, priceDigits(pass.price));
    await editor.fill(`landing-pass-${String(index)}-description`, pass.description);
  }
  await wizard.continueSteps(STEPS_PASSES_TO_VENUE);
  await editor.fill('landing-form-venue-name', c.venue.name);
  await wizard.continueSteps(STEPS_VENUE_TO_REVIEW);
  await expect(page.getByTestId('onboarding-step-review')).toBeVisible();
  const published = await wizard.finishFromReview();
  await expect(page, 'Finish lands on the landing editor').toHaveURL(/\/organizer\/landing\/?(\?publish=started)?$/, { timeout: 30_000 });
  await wizard.waitForFinishPublish(ctx);
  return published.tenantSlug ?? '';
}

async function walkStats(editor: KefiLandingEditorPage): Promise<void> {
  for (const [index, stat] of c.eventDetails.stats.entries()) {
    const at = String(index);
    if (await editor.fillIfPresent(`landing-stat-${at}-value`, stat.value)) await editor.fill(`landing-stat-${at}-label`, stat.label);
    else noControl.push(`eventDetails.stats[${at}] (no landing-stat-${at}-value)`);
  }
}

async function walkEditor(page: Page, editor: KefiLandingEditorPage): Promise<void> {
  const b = c.branding;
  const e = c.eventDetails;
  await editor.openSection('hero');
  await editor.fill('landing-form-branding-hero', b.heroImageUrl);
  await editor.fill('landing-form-branding-logo', b.logoUrl);
  await editor.fill('landing-form-branding-primary-color', b.primaryColor);
  await editor.fill('landing-form-branding-accent-color', b.accentColor);
  await editor.openSection('about');
  await editor.fill('landing-form-event-heading', e.heading);
  await editor.fill('landing-form-event-date', e.dateLabel);
  await editor.fill('landing-form-event-location', e.locationLabel);
  await walkStats(editor);
  await editor.openSection('venue');
  await editor.fill('landing-form-venue-city', c.venue.city);
  await editor.fill('landing-form-venue-address', c.venue.address);
  await editor.fill('landing-form-venue-map', c.venue.mapUrl);
  await editor.openSection('book');
  await editor.fill('landing-form-register-label', c.register.label);
  await editor.fill('landing-form-register-url', c.register.url);
  await editor.fill('landing-form-register-note', c.register.note);
  await editor.fill('landing-form-register-secondary-label', c.register.secondaryLabel);
  await editor.fill('landing-form-register-secondary-url', c.register.secondaryUrl);
  await editor.openSection('prices');
  await editor.fill('landing-pass-1-badge', c.passes[1].badge ?? '');
  await editor.press('landing-pass-1-featured');
  await editor.openSection('posters');
  for (const [index, poster] of c.posters.entries()) {
    await editor.press('landing-posters-add');
    await editor.fill(`landing-poster-${String(index)}-title`, poster.title);
    await editor.fill(`landing-poster-${String(index)}-imageurl`, poster.imageUrl);
    await editor.fill(`landing-poster-${String(index)}-downloadurl`, poster.downloadUrl);
  }
  await walkPeople(page, editor, data.landing.config);
  await walkSchedule(editor, data.landing.config);
  await walkParty(editor, data.landing.config);
  await walkBookPay(page, editor, data.landing.config);
}

test.describe('KEFI-RECREATE-1 KUCY recreated by a UI walk on a throwaway tenant', () => {
  test.skip(!isRemoteTarget(), 'runs against a deployed kefi stack');

  test.afterAll(async ({ request }) => {
    const swept = await cleanupKefiCanary(ctx.canaryId, { adminClient });
    const quickSwept = await cleanupKefiCanary(quickCtx.canaryId, { adminClient });
    test.info().annotations.push({ type: 'canarySwept', description: JSON.stringify({ swept, quickSwept }) });
    if (!slug) return;
    await expect.poll(async () => (await request.get(`${getKefiUrls().apiUrl}${publicTenantPath(slug)}`)).status(), {
      message: `public GET ${publicTenantPath(slug)} after cleanup`,
      timeout: TEARDOWN_404_TIMEOUT_MS,
    }).toBe(404);
  });

  test('UI-01 e2c- organizer signs up, walks wizard and editor, publishes, /t/<slug> renders the brand', async ({ page, request }) => {
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const editor = new KefiLandingEditorPage(page);
    slug = await walkWizard(page, await signUpThroughUi(page, ctx), editor);
    expect(slug, 'Finish publish names an e2c- tenant').toMatch(/^e2c-/);
    await probeDynamicLandingRender({ slug, requiredMarkers: [c.branding.name], timeoutMs: PUBLISH_RENDER_TIMEOUT_MS });
    await editor.goto(getKefiUrls().webUrl);
    await walkEditor(page, editor);
    await editor.save();

    const published = await editor.publish();

    expect(published.tenantSlug, 'editor publish names the same tenant').toBe(slug);
    expect(published.jobName, 'editor publish returned a job name').toBeTruthy();
    await adminClient.pollPublishStatus({ ownerEmail: ctx.email, ownerPassword: ctx.password, jobName: published.jobName! });
    const probe = await probeDynamicLandingRender({ slug, requiredMarkers: [c.branding.name, c.eventDetails.heading], timeoutMs: PUBLISH_RENDER_TIMEOUT_MS });
    html = decodeHtml(await (await request.get(probe.url, { timeout: PAGE_FETCH_MS })).text());
    const landing = await request.get(`${getKefiUrls().apiUrl}${publicTenantPath(slug)}`, { timeout: PAGE_FETCH_MS });
    expect(landing.status(), 'public landing read').toBe(200);
    saved = ((await landing.json()) as { landing: object }).landing;
    expect(html, `/t/${slug}/ shows the brand`).toContain(c.branding.name);
  });

  test('UI-02 published page after the walk, shows the key KUCY content typed in the UI', () => {
    const expected = [c.branding.name, c.branding.tagline, c.branding.edition, c.eventDetails.heading, c.venue.name,
      ...c.passes.map((p) => p.name), ...c.posters.map((p) => p.title), c.register.label];

    const missing = missingFrom(html, expected);

    expect(missing, `key values absent from /t/${slug}/`).toEqual([]);
  });

  for (const row of matrixRows(data).filter((r) => WALKED_ROWS.has(r.id))) {
    test(`${row.id} published page with the ${row.scenario} typed in the UI, renders every data-file value`, () => {
      const expected = row.expected;

      const missing = missingFrom(html, expected);

      expect(missing, `${row.id} values absent from /t/${slug}/`).toEqual([]);
    });
  }

  test('UI-GAP saved config after the walk compared with kucy-recreate.json, lists what the walk did not set', async () => {
    const expected = data.config as unknown as object;

    const gaps = fieldGaps(expected, saved);

    const unwalked = matrixRows(data).filter((r) => !WALKED_ROWS.has(r.id)).map((r) => ({ id: r.id, missing: missingFrom(html, r.expected).length, of: r.expected.length }));
    const report = { roots: gapRoots(gaps), noControl, unwalked, gaps };
    await test.info().attach('ui-gaps.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    test.info().annotations.push({ type: 'UI-GAP', description: JSON.stringify({ roots: report.roots, noControl, unwalked }) });
    expect(pageErrors, 'uncaught browser errors during the walk').toEqual([]);
  });

  test('AC-OBQ-1 new organizer fills name, date and template in quick start, reaches go-live or the editor with coach marks', async ({ page }) => {
    test.info().annotations.push({ type: 'canaryId', description: quickCtx.canaryId });
    const wide = (page.viewportSize()?.width ?? 0) >= WIDE_MIN_WIDTH;
    const wizard = await signUpThroughUi(page, quickCtx);
    const quickStart = { name: `${quickCtx.slugPrefix}Quick Night`, dateIso: EVENT_DATE_ISO, templateKey: 'kucy' };
    await expect(page.getByTestId('onboarding-draft-behind'), 'AC-OBQ-7 draft page behind the quick start below 1280').toHaveCount(wide ? 0 : 1);
    await sight(page, 'quick-start');
    await page.getByTestId(`onboarding-look-example-open-${quickStart.templateKey}`).click();
    await expect(page.getByTestId('onboarding-look-example'), 'AC-OBQ-8 See example opens the larger look').toBeVisible();
    await sight(page, 'look-example');
    await page.getByTestId('onboarding-look-example-close').click();
    await expect(page.getByTestId('onboarding-look-example'), 'AC-OBQ-8 example modal closes').toHaveCount(0);

    await wizard.submitQuickStart(quickStart);

    if (wide) {
      await expect(page, 'AC-OBQ-11 quick start at 1280 lands on the go-live review').toHaveURL(/\/organizer\/go-live\/?$/, { timeout: 30_000 });
      await expect(page.getByTestId('onboarding-go-live-publish'), 'AC-OBQ-11 Publish inside the review').toBeVisible({ timeout: 30_000 });
      await sight(page, 'go-live');
      const posted = page.waitForResponse((r) => r.url().includes('/admin/landing-config/publish') && r.request().method() === 'POST');
      await page.getByTestId('onboarding-go-live-publish').click();
      expect((await posted).status(), 'AC-OBQ-11 go-live Publish POST').toBeLessThan(300);
    }
    await expect(page, 'lands on the landing editor').toHaveURL(/\/organizer\/landing\/?(\?publish=started)?$/, { timeout: 30_000 });
    await expect(page.getByTestId('organizer-setup-guide'), 'AC-OBQ-9 coach marks above the editor').toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('organizer-coach-mark'), 'AC-OBQ-9 one coach mark tip open').toBeVisible();
    await sight(page, 'coach-marks');
    if (wide) return;
    await new KefiLandingEditorPage(page).publish();
    await expect(page.getByTestId('landing-live-moment'), 'AC-OBQ-10 live moment after publish at 360').toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('landing-live-share'), 'AC-OBQ-10 Share on the live moment').toBeVisible();
    await sight(page, 'live-moment');
  });
});
