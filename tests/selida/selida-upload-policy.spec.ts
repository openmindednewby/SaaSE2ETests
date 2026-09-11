// Selida @api — the upload gate (UploadPolicy.cs + CreatePage.cs:44-61).
//
// The extension alone decides what gets published and how it is served; the caller's part
// Content-Type is never consulted. Every rejection below sends VALID HTML bytes, so the only
// thing that can make it fail is the name or the size — not the content.
//
// Budget: 7 of the project's 9 uploads (limit 10/min per IP). If a rejection ever comes back 201
// the page is tracked and deleted in afterEach, so a regression here cannot leave a page public.
import { expect, test } from '@playwright/test';

import {
  HTTP,
  MAX_ANONYMOUS_UPLOAD_BYTES,
  PageLedger,
  SERVED_CONTENT_TYPE,
  anonymousApi,
  describeResponse,
  htmlFixture,
  publish,
  upload,
} from './selida-helpers.js';

import type { APIRequestContext } from '@playwright/test';
import type { CreatedPage, UploadFile } from './selida-helpers.js';

/** A 5 MB upload over a slow uplink needs more than the 30 s default. */
const LARGE_UPLOAD_TIMEOUT_MS = 90_000;

/** Names outside the `.html`/`.htm` allowlist (UploadPolicy.cs:17-22, 40-52). */
const DISALLOWED_NAMES: { name: string; mimeType: string; why: string }[] = [
  { name: 'page.txt', mimeType: 'text/plain', why: 'plain text' },
  { name: 'page.svg', mimeType: 'image/svg+xml', why: 'SVG is a script-capable document' },
  { name: 'page.js', mimeType: 'text/javascript', why: 'script' },
  { name: 'page', mimeType: 'text/html', why: 'no extension, even with an HTML content type' },
];

test.describe('Selida upload policy @selida-api @selida', () => {
  const ledger = new PageLedger();
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await anonymousApi();
  });

  test.afterEach(async () => {
    expect(await ledger.drain(api), 'these pages are still PUBLIC — delete them by hand').toEqual([]);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  /** Uploads, tracks an unexpected 201 for cleanup, then asserts the rejection status. */
  async function expectRejected(file: UploadFile, status: number): Promise<void> {
    const response = await upload(api, file);
    const failure = await describeResponse(response);
    if (response.status() === HTTP.CREATED) ledger.track((await response.json()) as CreatedPage);
    expect(response.status(), failure).toBe(status);
  }

  test('the caller\'s Content-Type is ignored: x.html sent as image/svg+xml is served as text/html', async () => {
    // CreatePage.cs:50-51 — the extension decides; UploadPolicy.cs:20 — the only served type.
    const page = await publish(api, ledger, {
      name: 'x.html',
      mimeType: 'image/svg+xml',
      buffer: htmlFixture('ctype').buffer,
    });

    const served = await api.get(page.url, { maxRedirects: 0 });
    expect(served.status(), await describeResponse(served)).toBe(HTTP.OK);
    expect(served.headers()['content-type']).toBe(SERVED_CONTENT_TYPE);
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
  });

  for (const { name, mimeType, why } of DISALLOWED_NAMES) {
    test(`"${name}" is refused with 415 (${why})`, async () => {
      // CreatePage.cs:51-54 — checked BEFORE size, so a valid-size body still gets 415.
      await expectRejected({ name, mimeType, buffer: htmlFixture('ext').buffer }, HTTP.UNSUPPORTED_MEDIA_TYPE);
    });
  }

  test('an empty .html file is refused with 413', async () => {
    // CreatePage.cs:57-60 + UploadPolicy.cs:57-58: `sizeBytes > 0` is part of the size gate.
    await expectRejected({ name: 'empty.html', mimeType: 'text/html', buffer: Buffer.alloc(0) }, HTTP.PAYLOAD_TOO_LARGE);
  });

  test('a .html file one byte over 5 MB is refused with 413', async () => {
    test.setTimeout(LARGE_UPLOAD_TIMEOUT_MS);
    // UploadPolicy.cs:12 (cap) + 57-58 (inclusive bound) · CreatePage.cs:57-60 (413).
    const buffer = Buffer.alloc(MAX_ANONYMOUS_UPLOAD_BYTES + 1, 'a');
    await expectRejected({ name: 'big.html', mimeType: 'text/html', buffer }, HTTP.PAYLOAD_TOO_LARGE);
  });
});
