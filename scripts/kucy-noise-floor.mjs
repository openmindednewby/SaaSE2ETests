#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const playwrightCoreDir = dirname(require.resolve('playwright-core/package.json'));
const pixelmatchModule = require(join(playwrightCoreDir, 'lib/third_party/pixelmatch.js'));
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;
const { PNG } = require(join(playwrightCoreDir, 'lib/utilsBundle.js'));

const SITE = 'https://kizombaunioncy.dloizides.com/';
const SECTIONS = ['top', 'mission', 'teachers', 'classes', 'prices', 'register', 'book', 'ambassadors', 'media', 'venue', 'posters', 'past'];
const VIEWPORTS = [{ name: '360', width: 360, height: 640 }, { name: '1280', width: 1280, height: 800 }];
const FROZEN_NOW = new Date('2027-04-01T10:00:00Z');
const PIXEL_THRESHOLD = 0.1;
const STEP_TIMEOUT_MS = 30_000;
const RUN_CAP_MS = 170_000;
const PERCENT = 100;
const IMAGE_SETTLE_CAP_MS = 10_000;
const DETERMINISM_CSS = '.reveal{opacity:1!important;transform:none!important;transition:none!important}'
  + '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

const outDir = resolve(process.argv[2] ?? 'test-results/kefi-tour-kucy/noise-floor');
const started = Date.now();
const log = (msg) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
const cap = setTimeout(() => { log('hung: run cap reached, aborting'); process.exit(2); }, RUN_CAP_MS);

async function captureRun(browser, vp) {
  log(`${vp.name}: opening page`);
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.goto(SITE, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS });
  await page.addStyleTag({ content: DETERMINISM_CSS });
  await page.evaluate(() => document.fonts.ready);
  log(`${vp.name}: loaded, settling images`);
  await page.evaluate(async (capMs) => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
    const images = [...document.images];
    images.forEach((img) => { img.loading = 'eager'; });
    const pending = images.map((img) => img.decode().catch(() => null));
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, capMs))]);
  }, IMAGE_SETTLE_CAP_MS);
  log(`${vp.name}: capturing sections`);
  const shots = {};
  for (const id of SECTIONS) {
    const loc = page.locator(`#${id}`).first();
    shots[id] = (await loc.count()) ? await loc.screenshot({ animations: 'disabled', caret: 'hide' }) : null;
  }
  shots.fullPage = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  await context.close();
  return shots;
}

function diffPair(a, b, diffPath) {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  const width = Math.min(pa.width, pb.width);
  const height = Math.min(pa.height, pb.height);
  const crop = (p) => { const out = new PNG({ width, height }); PNG.bitblt(p, out, 0, 0, width, height, 0, 0); return out; };
  const ca = crop(pa);
  const cb = crop(pb);
  const diff = new PNG({ width, height });
  const count = pixelmatch(ca.data, cb.data, diff.data, width, height, { threshold: PIXEL_THRESHOLD });
  writeFileSync(diffPath, PNG.sync.write(diff));
  return { width: pa.width, heightA: pa.height, heightB: pb.height, heightDelta: Math.abs(pa.height - pb.height), diffPixels: count, diffPercent: Number(((count / (width * height)) * PERCENT).toFixed(4)) };
}

const browser = await chromium.launch();
const report = { site: SITE, frozenNow: FROZEN_NOW.toISOString(), pixelThreshold: PIXEL_THRESHOLD, viewports: {} };
try {
  for (const vp of VIEWPORTS) {
    const dir = join(outDir, vp.name);
    mkdirSync(dir, { recursive: true });
    log(`${vp.name}: capture A`);
    const a = await captureRun(browser, vp);
    log(`${vp.name}: capture B`);
    const b = await captureRun(browser, vp);
    report.viewports[vp.name] = {};
    for (const key of [...SECTIONS, 'fullPage']) {
      if (!a[key] || !b[key]) { report.viewports[vp.name][key] = { missing: true }; log(`${vp.name} ${key}: not found`); continue; }
      writeFileSync(join(dir, `${key}-a.png`), a[key]);
      writeFileSync(join(dir, `${key}-b.png`), b[key]);
      const r = diffPair(a[key], b[key], join(dir, `${key}-diff.png`));
      report.viewports[vp.name][key] = r;
      log(`${vp.name} ${key}: ${r.diffPercent}% (${r.diffPixels} px), height delta ${r.heightDelta}px`);
    }
  }
} finally {
  await browser.close();
  clearTimeout(cap);
}
report.wallSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
writeFileSync(join(outDir, 'noise-floor.json'), JSON.stringify(report, null, 2));
log(`done, wall ${report.wallSeconds}s, report ${join(outDir, 'noise-floor.json')}`);
