import { devices, expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

import { APP_URL } from './helpers/tracker';

const { defaultBrowserType: _phoneBrowser, ...pixel } = devices['Pixel 5'];
const { defaultBrowserType: _desktopBrowser, ...desktopChrome } = devices['Desktop Chrome'];
const PHONE_360 = { ...pixel, viewport: { width: 360, height: 640 } };
const DESKTOP_1280 = { ...desktopChrome, viewport: { width: 1280, height: 800 } };

const PROMPT = 'lozenge diamonds peyote 23 wide';
const PROMPT_WIDTH = '23';
const PROMPT_MOTIF = /Lozenge band/;
const PROMPT_MARKERS = [PROMPT, 'lozenge diamonds', '23 wide', encodeURIComponent(PROMPT), PROMPT.replace(/ /g, '+')];
const UNMATCHED_PROMPT = 'qwzx blorptastic vrrnk';
const UNMATCHED_NOTE = /^No motif matches those words/;
const MODEL_DOWNLOADS = /\.gguf|\.onnx|huggingface\.co|hf\.co|wllama/i;

async function openMake(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/make`);
  await expect(page.getByTestId('jinx-generator-screen'), '/make did not render').toBeVisible();
}

function carriesPrompt(request: Request): boolean {
  const sent = `${request.url()}\n${request.postData() ?? ''}`.toLowerCase();
  return PROMPT_MARKERS.some((marker) => sent.includes(marker.toLowerCase()));
}

test.describe('360x640', () => {
  test.use(PHONE_360);

  test(`AC-AI-1 prompt "${PROMPT}" at 360x640, submitted with Enter, fills the Make form with width ${PROMPT_WIDTH} and the Lozenge band motif`, async ({ page }) => {
    await openMake(page);
    const prompt = page.getByTestId('jinx-generator-prompt');
    await prompt.fill(PROMPT);

    await prompt.press('Enter');

    await expect(page.getByTestId('jinx-generator-width'), 'prompt width did not reach the form').toHaveValue(PROMPT_WIDTH);
    await expect(page.getByTestId('jinx-generator-motif-trigger'), 'prompt motif did not reach the form').toHaveText(PROMPT_MOTIF);
  });

  test(`AC-AI-2 prompt "${PROMPT}" at 360x640, submitted, sends no request carrying the prompt`, async ({ page }) => {
    await openMake(page);
    const leaks: string[] = [];
    page.on('request', (request) => {
      if (carriesPrompt(request)) leaks.push(`${request.method()} ${request.url()}`);
    });
    const prompt = page.getByTestId('jinx-generator-prompt');
    await prompt.fill(PROMPT);

    await prompt.press('Enter');

    await expect(page.getByTestId('jinx-generator-width'), 'prompt did not make a chart, so the spy saw nothing').toHaveValue(PROMPT_WIDTH);
    expect(leaks, `requests carried the prompt: ${leaks.join(', ')}`).toEqual([]);
  });

  test('AC-AI-6 prompt result at 360x640, shuffled, stays editable and leaves a trail tile', async ({ page }) => {
    await openMake(page);
    const prompt = page.getByTestId('jinx-generator-prompt');
    await prompt.fill(PROMPT);
    await prompt.press('Enter');
    await expect(page.getByTestId('jinx-generator-width'), 'prompt width did not reach the form').toHaveValue(PROMPT_WIDTH);

    await page.getByTestId('jinx-generator-shuffle').click();

    await expect(page.getByTestId('jinx-generator-trail-0'), 'Shuffle after a prompt left no trail tile').toBeVisible();
    await expect(page.getByTestId('jinx-generator-width'), 'Width field is not editable after a prompt').toBeEditable();
  });

  test('AC-AI-8 prompt field at 360x640, on open, is the first form row above the generator form', async ({ page }) => {
    await openMake(page);

    const block = await page.getByTestId('jinx-generator-prompt-block').boundingBox();
    const form = await page.getByTestId('jinx-generator-form').boundingBox();

    expect(block, 'prompt block has no layout box').not.toBeNull();
    expect(form, 'generator form has no layout box').not.toBeNull();
    expect(block?.y ?? Infinity, `prompt block top ${block?.y} is not above the form top ${form?.y}`).toBeLessThan(form?.y ?? -Infinity);
  });

  test(`AC-AI-9 unmatched prompt "${UNMATCHED_PROMPT}" at 360x640, submitted, says no motif matches and offers Search figures`, async ({ page }) => {
    await page.route(MODEL_DOWNLOADS, (route) => route.abort());
    await openMake(page);
    const prompt = page.getByTestId('jinx-generator-prompt');
    await prompt.fill(UNMATCHED_PROMPT);

    await prompt.press('Enter');

    await expect(page.getByTestId('jinx-generator-prompt-note'), 'unmatched prompt gave no note').toHaveText(UNMATCHED_NOTE);
    await page.getByTestId('jinx-generator-prompt-figures').click();
    await expect(page.getByTestId('jinx-generator-figure-search'), 'Search figures did not open the figure search').toBeVisible();
    await expect(page.getByTestId('jinx-generator-preview'), 'unmatched prompt left no chart').toBeVisible();
  });
});

test.describe('1280x800', () => {
  test.use(DESKTOP_1280);

  test('AC-AI-8 Describe tab at 1280x800, tapped, shows the prompt field that was hidden', async ({ page }) => {
    await openMake(page);
    await expect(page.getByTestId('jinx-generator-prompt'), 'prompt shows before Describe is tapped').toBeHidden();

    await page.getByTestId('jinx-generator-source-describe').click();

    await expect(page.getByTestId('jinx-generator-prompt'), 'Describe did not show the prompt field').toBeVisible();
  });

  test(`AC-AI-1 prompt "${PROMPT}" at 1280x800, submitted with Enter on the Describe tab, redraws the chart`, async ({ page }) => {
    await openMake(page);
    await page.getByTestId('jinx-generator-source-describe').click();
    const result = page.getByTestId('jinx-generator-result');
    const before = await result.innerText();
    const prompt = page.getByTestId('jinx-generator-prompt');
    await prompt.fill(PROMPT);

    await prompt.press('Enter');

    await expect(result, `chart summary still reads "${before}" after the prompt`).not.toHaveText(before);
  });
});
