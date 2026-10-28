import { test, expect } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext, type KefiCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import { KefiMailbox, extractVerifyUrl, loadKefiMailboxConfig } from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_DAYS_AHEAD = 60;
const VISIBLE_TIMEOUT_MS = 30_000;
const CUT_TIMEOUT_MS = 120_000;
const LOGO_SIZE_PX = 320;
const LOGO_NAME = 'bgremove-privacy-logo.png';
const LOCAL_SCHEMES = ['blob:', 'data:'];
const MODEL_PATH = '/bg-removal/';
const PREVIEW_PATH = '/bff/landing-preview';
const LOGO_URL_SET = /"logoUrl":"[^"]+"/;

interface RecordedRequest {
  method: string;
  url: string;
  bodyBytes: number;
}

function dateAhead(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function isLocal(url: string): boolean {
  return LOCAL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

function record(request: Request): RecordedRequest {
  return {
    method: request.method(),
    url: request.url(),
    bodyBytes: request.postDataBuffer()?.length ?? 0,
  };
}

test.describe('BGREMOVE-1 AC-2 Remove background stays on the device', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer landing editor');

  test('AC-2 with a picked logo cut in the Compare dialog, sends no request body off the device', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    let verifyUid: number | null = null;
    try {
      verifyUid = await signUpVerifyAndCompleteFreeWizard(page, ctx);
      await pickGeneratedLogo(page);
      const removeBackground = page.getByTestId('landing-palette-remove-background');
      await expect(removeBackground, 'Remove background is offered for the picked logo').toBeEnabled({ timeout: VISIBLE_TIMEOUT_MS });
      const sent: RecordedRequest[] = [];
      page.context().on('request', (request) => {
        if (!isLocal(request.url())) sent.push(record(request));
      });

      await removeBackground.click();
      await expect(page.getByTestId('kefi-cutout-use'), 'the cut finished and Use cut-out is ready').toBeEnabled({ timeout: CUT_TIMEOUT_MS });

      await expect(page.getByTestId('kefi-cutout-failed'), 'the cut did not fail').toHaveCount(0);
      expect(
        sent.some((r) => r.url.includes(MODEL_PATH)),
        `the recorder saw the model/runtime fetch (${sent.length} requests recorded)`,
      ).toBe(true);
      const withBody = sent.filter((r) => r.bodyBytes > 0);
      expect(withBody, `no request during the cut carried a body: ${JSON.stringify(withBody)}`).toEqual([]);
      await page.getByTestId('kefi-cutout-cancel').click();
    } finally {
      if (verifyUid !== null) {
        await new KefiMailbox(loadKefiMailboxConfig()).expungeMessages([verifyUid]).catch(() => undefined);
      }
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

async function signUpVerifyAndCompleteFreeWizard(page: Page, ctx: KefiCanaryContext): Promise<number> {
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
  await wizard.fillFastPath({ canaryPrefix: ctx.slugPrefix, eventDateIso: dateAhead(EVENT_DAYS_AHEAD) });
  await wizard.finishFromReview();
  return captured.uid;
}

async function pickGeneratedLogo(page: Page): Promise<void> {
  const { webUrl } = getKefiUrls();
  await page.goto(`${webUrl}/organizer/landing`);
  await expect(page.getByTestId('landing-editor-surface')).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
  await page.getByTestId('landing-builder-section-hero').click();
  await expect(page.getByTestId('landing-palette-upload'), 'the Hero section shows the palette card').toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
  const png = await page.evaluate((size: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#2f6f4f';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#f2c14e';
    g.beginPath();
    g.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2);
    g.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }, LOGO_SIZE_PX);
  const chooser = page.waitForEvent('filechooser');
  const previewWithLogo = page.waitForResponse(
    (r) => r.url().endsWith(PREVIEW_PATH) && LOGO_URL_SET.test(r.request().postData() ?? ''),
    { timeout: VISIBLE_TIMEOUT_MS },
  );
  await page.getByTestId('landing-palette-upload').click();
  await (await chooser).setFiles({ name: LOGO_NAME, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await previewWithLogo;
}
