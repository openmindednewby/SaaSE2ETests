#!/usr/bin/env node
// ANALYTICS-ASYNC-1 "Analytics tag must never block render" — one-off probe (exits; no server, no watcher).
//
// For each URL: iPhone 13 device descriptor (run on Chromium), every request to
// analytics.dloizides.com is routed to NEVER respond, then time from navigation COMMIT
// (first response byte) to DOMContentLoaded. A `defer` Umami tag holds DOMContentLoaded
// until the script arrives, so a hung analytics host blocks render; an `async` tag does not.
//
// PASS  = DCL < 2000 ms after commit.  FAIL = slower, capped at 10 s, or navigation error.
// NOREQ = page made no analytics request (PASS, but the probe observed nothing — noted).
//
// Usage:  node scripts/analytics-hang-probe.mjs [urls.txt | url ...]
//         default list: scripts/analytics-hang-urls.txt ('#' starts a comment)
// Exit:   1 if any URL FAILs, else 0.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const PASS_MS = 2000;
const CAP_MS = 10000;
const GOTO_TIMEOUT_MS = 20000;
const ANALYTICS_ROUTE = '**analytics.dloizides.com/**';
const DEFAULT_LIST = join(dirname(fileURLToPath(import.meta.url)), 'analytics-hang-urls.txt');

function parseList(text) {
  return text.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

function loadUrls(argv) {
  if (argv.length === 0) return parseList(readFileSync(DEFAULT_LIST, 'utf8'));
  return argv.flatMap((a) => (existsSync(a) ? parseList(readFileSync(a, 'utf8')) : [a]));
}

async function probe(browser, url) {
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13'];
  const context = await browser.newContext(iphone);
  let hung = 0;
  // Never fulfil / continue / abort: the request stays pending, like an unresponsive host.
  await context.route(ANALYTICS_ROUTE, () => { hung += 1; });
  const page = await context.newPage();
  try {
    const dcl = page.waitForEvent('domcontentloaded', { timeout: GOTO_TIMEOUT_MS + CAP_MS })
      .then(() => Date.now(), () => null);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'commit', timeout: GOTO_TIMEOUT_MS });
    const tCommit = Date.now();
    const tDcl = await Promise.race([dcl, new Promise((r) => setTimeout(() => r(null), CAP_MS))]);
    const ttfb = tCommit - t0;
    if (tDcl === null) return { url, ok: false, ms: `>${CAP_MS}`, ttfb, hung, tag: '?' };
    const ms = Math.max(0, tDcl - tCommit);
    const tag = await page.evaluate(() => {
      const s = document.querySelector('script[src*="analytics.dloizides.com"]');
      if (!s) return 'none';
      return s.async ? 'async' : s.defer ? 'defer' : 'blocking';
    }).catch(() => '?');
    return { url, ok: ms < PASS_MS, ms, ttfb, hung, tag };
  } catch (err) {
    return { url, ok: false, ms: 'ERR', ttfb: '-', hung, tag: '?', err: String(err.message).split('\n')[0] };
  } finally {
    await context.close().catch(() => {});
  }
}

const urls = loadUrls(process.argv.slice(2));
const browser = await chromium.launch();
let failed = 0;
for (const url of urls) {
  const r = await probe(browser, url);
  if (!r.ok) failed += 1;
  const verdict = r.ok ? (r.hung === 0 ? 'PASS(NOREQ)' : 'PASS') : 'FAIL';
  const extra = r.err ? ` err="${r.err}"` : '';
  console.log(`${verdict.padEnd(11)} dcl=${String(r.ms).padStart(6)}ms ttfb=${r.ttfb}ms hung=${r.hung} tag=${r.tag} ${r.url}${extra}`);
}
await browser.close();
console.log(`TALLY: ${urls.length - failed} pass, ${failed} fail, ${urls.length} total (threshold ${PASS_MS} ms, cap ${CAP_MS} ms)`);
process.exit(failed > 0 ? 1 : 0);
