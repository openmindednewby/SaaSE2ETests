/**
 * Targeted region capture for UBB/UBS mobile visual review.
 * Scrolls to named sections (organiser grid, pass tiles, register form, footer)
 * and screenshots the viewport + reports pass-tile geometry.
 *
 * Usage: node scripts/ubb-region-capture.mjs <outDir>
 * Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUT = process.argv[2];
const VIEWPORT = { width: 375, height: 812 };
const SITES = [
  { name: 'ubb', url: 'https://ubb.kefi.dloizides.com/' },
  { name: 'ubs', url: 'https://unitedbysalsa.dloizides.com/' },
];

// Section anchors by heading text (case-insensitive contains)
const SECTIONS = ['TEACHERS', 'THE TEAM', 'ORGANISERS', 'PASSES', 'REGISTER'];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const report = {};
  for (const site of SITES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    report[site.name] = {};

    for (const sec of SECTIONS) {
      const y = await page.evaluate((label) => {
        const els = Array.from(document.querySelectorAll('h1,h2,h3,h4,section,div'));
        for (const el of els) {
          const t = (el.innerText || '').trim().toUpperCase();
          if (t.startsWith(label) && t.length < 400) {
            const r = el.getBoundingClientRect();
            return Math.max(0, r.top + window.scrollY - 40);
          }
        }
        return null;
      }, sec);
      if (y == null) { report[site.name][sec] = 'not-found'; continue; }
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(500);
      const safe = sec.replace(/\s+/g, '-').toLowerCase();
      await page.screenshot({ path: path.join(OUT, `${site.name}-sec-${safe}.png`) });
      report[site.name][sec] = Math.round(y);
    }

    // Footer capture: scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${site.name}-sec-footer.png`) });

    // Pass-tile precise geometry: find tiles inside the PASSES section
    const passGeo = await page.evaluate(() => {
      const tiles = [];
      document.querySelectorAll('*').forEach((el) => {
        const t = (el.innerText || '').trim();
        // A pass tile: starts with a pass name and has a price-ish body, single card
        if (/^(PARTY|CLASS|FULL)\s*PASS/i.test(t) && t.length < 200) {
          const r = el.getBoundingClientRect();
          if (r.width > 120 && r.width < 380 && r.height > 120) {
            tiles.push({ label: t.split('\n')[0], w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
      });
      return tiles;
    });
    report[site.name].passTiles = passGeo;

    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'region-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
