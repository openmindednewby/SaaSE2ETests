import { writeFile } from 'node:fs/promises';

import { expect, type BrowserContext, type Page } from '@playwright/test';

import { APP_URL } from './tracker';

export const FLAG_APP_URL = process.env.JINX_APP_FLAG_URL ?? 'http://unconfigured.invalid';
export const VISIBLE_TEXT = 'body *:not(.skip):not(.dlz-consent__sr):not([id^="a11y-hint-"])';

const PHOTO_WIDTH_PX = 4000;
const PHOTO_HEIGHT_PX = 3000;
const JPEG_QUALITY = 0.92;
const NOISE_SPREAD = 28;
const MIN_FILE_BYTES = 2_000_000;
const SAMPLE_BYTES = 256;
const LONGEST_HONEST_URL = 2048;
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export interface Traffic {
  method: string;
  url: string;
  body: Buffer | null;
}

export interface Recorder {
  requests: Traffic[];
  sockets: string[];
}

export async function makePhoto(page: Page, path: string): Promise<Buffer> {
  await page.goto('about:blank');
  const made = await page.evaluate(
    async ({ width, height, quality, spread }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context');
      const image = context.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const at = (y * width + x) * 4;
          const noise = Math.random() * spread;
          const left = x < width / 2;
          image.data[at] = (left ? 176 : 24) + noise;
          image.data[at + 1] = (left ? 48 : 60) + noise;
          image.data[at + 2] = (left ? 32 : 150) + noise;
          image.data[at + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const parts: string[] = [];
      for (let i = 0; i < bytes.length; i += 32_768) parts.push(String.fromCharCode(...bytes.subarray(i, i + 32_768)));
      return btoa(parts.join(''));
    },
    { width: PHOTO_WIDTH_PX, height: PHOTO_HEIGHT_PX, quality: JPEG_QUALITY, spread: NOISE_SPREAD },
  );
  const file = Buffer.from(made, 'base64');
  expect(file.length, 'the generated JPEG is too small to stand in for a 12 MP photo').toBeGreaterThan(MIN_FILE_BYTES);
  await writeFile(path, file);
  return file;
}

export async function recordTraffic(page: Page, context: BrowserContext): Promise<Recorder> {
  const recorder: Recorder = { requests: [], sockets: [] };
  context.on('request', (request) => {
    recorder.requests.push({ method: request.method(), url: request.url(), body: request.postDataBuffer() });
  });
  page.on('websocket', (socket) => recorder.sockets.push(socket.url()));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const local = new URL(request.url()).hostname === new URL(APP_URL).hostname;
    if (local || READ_METHODS.includes(request.method())) await route.fallback();
    else await route.abort();
  });
  return recorder;
}

export function bodiesOf(requests: Traffic[]): string[] {
  return requests
    .filter((request) => request.body !== null || !READ_METHODS.includes(request.method))
    .map((request) => `${request.method} ${request.url} ${request.body?.toString('base64') ?? ''}`)
    .sort();
}

export function requestsCarryingPhoto(requests: Traffic[], file: Buffer): string[] {
  const middle = Math.floor(file.length / 2);
  const samples = [file.subarray(0, SAMPLE_BYTES), file.subarray(middle, middle + SAMPLE_BYTES)];
  return requests
    .filter((request) => request.url.length > LONGEST_HONEST_URL || samples.some((sample) => request.body?.includes(sample) === true))
    .map((request) => `${request.method} ${request.url.slice(0, 80)}`);
}

export async function chooseFile(page: Page, buttonTestId: string, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(buttonTestId).click();
  await (await chooser).setFiles(path);
}

export async function openPhotoTab(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/make`);
  await page.getByTestId('jinx-generator-source-photo').click();
  await expect(page.getByTestId('jinx-photo-form')).toBeVisible();
}

export async function watchMainThread(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { last: 0, longest: 0 };
    Object.assign(window, { jinxFrames: state });
    const tick = (now: number): void => {
      if (state.last > 0) state.longest = Math.max(state.longest, now - state.last);
      state.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function resetFrameWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { jinxFrames: { longest: number } }).jinxFrames.longest = 0;
  });
}

export async function longestFrameMs(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { jinxFrames: { longest: number } }).jinxFrames.longest);
}

export async function pick(page: Page, selectTestId: string, value: string): Promise<void> {
  await page.getByTestId(`${selectTestId}-trigger`).click();
  await page.getByTestId(`${selectTestId}-option-${value}`).click();
}
