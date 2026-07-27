/**
 * UBB mobile-viewport visual review (375x812) with UBS as reference.
 *
 * Read-only public-landing visual QA. Does NOT log in, deploy, or edit app source.
 * Captures full-page screenshots + measures horizontal overflow + extracts DOM facts
 * (registration-stats strip presence, footer, organiser card width, pass-tile heights).
 *
 * Usage:  node scripts/ubb-mobile-visual-review.mjs <outDir>
 *
 * Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUT = process.argv[2] || path.join(process.cwd(), 'ubb-review-out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 375, height: 812 };

const SITES = [
  { name: 'ubb', url: 'https://ubb.kefi.dloizides.com/' },
  { name: 'ubs', url: 'https://unitedbysalsa.dloizides.com/' },
];

function log(...a) { console.log(...a); }

async function measure(page) {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - window.innerWidth;

    // Find any elements wider than the viewport (overflow culprits)
    const wide = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth + 1 && r.width < 99999) {
        wide.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 60),
          w: Math.round(r.width),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    });

    const bodyText = document.body.innerText || '';
    // Registration stats strip detection
    const hasRegistered = /\bRegistered\b/i.test(bodyText);
    const hasMenWomen = /\bMen\b/.test(bodyText) && /\bWomen\b/.test(bodyText);
    const numRegMatch = bodyText.match(/(\d+)\s*Registered/i);

    // Organiser card: look for an element/section referencing organiser/organizer
    const orgCards = [];
    document.querySelectorAll('*').forEach((el) => {
      const t = (el.innerText || '').trim();
      if (/organi[sz]er/i.test(t) && t.length < 120 && el.children.length <= 6) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        orgCards.push({
          text: t.slice(0, 60),
          w: Math.round(r.width),
          maxWidth: cs.maxWidth,
        });
      }
    });

    // Pass tiles: find elements whose text mentions Party / Class / Full pass
    const passTiles = [];
    document.querySelectorAll('*').forEach((el) => {
      const t = (el.innerText || '').trim();
      if (/(Party|Class|Full)\s*Pass/i.test(t) && el.children.length >= 1 && el.children.length <= 8) {
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.width < window.innerWidth + 5 && r.height > 40) {
          passTiles.push({
            label: t.split('\n')[0].slice(0, 30),
            w: Math.round(r.width),
            h: Math.round(r.height),
            top: Math.round(r.top + window.scrollY),
          });
        }
      }
    });

    // Footer facts
    const footer = document.querySelector('footer');
    let footerInfo = null;
    if (footer) {
      const cs = getComputedStyle(footer);
      const r = footer.getBoundingClientRect();
      footerInfo = {
        bg: cs.backgroundColor,
        color: cs.color,
        w: Math.round(r.width),
        text: (footer.innerText || '').slice(0, 200).replace(/\n+/g, ' | '),
      };
    }

    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      overflow,
      wide: wide.slice(0, 15),
      hasRegistered,
      hasMenWomen,
      registeredCount: numRegMatch ? numRegMatch[1] : null,
      orgCards: orgCards.slice(0, 8),
      passTiles: passTiles.slice(0, 12),
      footer: footerInfo,
      docHeight: doc.scrollHeight,
    };
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  for (const site of SITES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    log(`\n=== ${site.name.toUpperCase()} :: ${site.url} ===`);
    try {
      await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      log(`  nav warn: ${e.message}`);
    }
    await page.waitForTimeout(2500);

    // Full page screenshot
    await page.screenshot({ path: path.join(OUT, `${site.name}-landing-full.png`), fullPage: true });
    // Above-the-fold
    await page.screenshot({ path: path.join(OUT, `${site.name}-landing-fold.png`), fullPage: false });

    const m = await measure(page);
    results[site.name] = { ...m, consoleErrors: consoleErrors.slice(0, 10) };

    // Capture segmented viewport-height slices for footer / passes / register form
    const slices = Math.min(Math.ceil(m.docHeight / VIEWPORT.height), 12);
    for (let i = 0; i < slices; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), i * VIEWPORT.height);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${site.name}-slice-${String(i).padStart(2, '0')}.png`), fullPage: false });
    }

    log(JSON.stringify(m, null, 2));
    if (consoleErrors.length) log('  consoleErrors:', consoleErrors.slice(0, 5));

    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'landing-measurements.json'), JSON.stringify(results, null, 2));
  await browser.close();
  log('\nDONE. Output in', OUT);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
