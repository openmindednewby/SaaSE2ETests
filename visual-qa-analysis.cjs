const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:4444';

const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'pricing', path: '/pricing' },
  { name: 'dashboard-overview', path: '/dashboard/home/overview' },
  { name: 'dashboard-metrics', path: '/dashboard/home/metrics' },
  { name: 'dashboard-kpis', path: '/dashboard/home/kpis' },
];

async function analyze() {
  const browser = await chromium.launch({ headless: true });

  for (const pg of PAGES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`PAGE: ${pg.name} (${pg.path})`);
    console.log(`${'='.repeat(80)}`);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const tab = await context.newPage();

    // Track network requests
    const failedRequests = [];
    const slowRequests = [];
    tab.on('response', async (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400) {
        failedRequests.push({ url, status });
      }
    });

    const consoleErrors = [];
    tab.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    try {
      await tab.goto(`${BASE_URL}${pg.path}`, {
        waitUntil: 'networkidle',
        timeout: 15000
      });
      await tab.waitForTimeout(1500);
    } catch (e) {
      console.log(`  Navigation issue: ${e.message}`);
      await tab.waitForTimeout(3000);
    }

    // Page title
    const title = await tab.title();
    console.log(`  Title: ${title}`);

    // Current URL (to detect redirects)
    const currentUrl = tab.url();
    if (currentUrl !== `${BASE_URL}${pg.path}`) {
      console.log(`  REDIRECTED to: ${currentUrl}`);
    }

    // Failed network requests
    if (failedRequests.length > 0) {
      console.log(`  FAILED REQUESTS:`);
      failedRequests.forEach(r => console.log(`    [${r.status}] ${r.url}`));
    }

    // Console errors
    if (consoleErrors.length > 0) {
      console.log(`  CONSOLE ERRORS:`);
      consoleErrors.forEach(e => console.log(`    ${e}`));
    }

    // Check for visual issues via JS
    const analysis = await tab.evaluate(() => {
      const results = {};

      // Check overlapping elements (basic check)
      const body = document.body;
      const bodyRect = body.getBoundingClientRect();
      results.pageHeight = bodyRect.height;
      results.pageWidth = bodyRect.width;

      // Check for horizontal overflow
      results.hasHorizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;

      // Check all text elements for readability (font-size < 10px)
      const allText = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a, button, label, li, td, th');
      const tinyText = [];
      allText.forEach(el => {
        const cs = window.getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        if (fs < 10 && el.textContent.trim().length > 0) {
          tinyText.push({ tag: el.tagName, text: el.textContent.trim().substring(0, 50), fontSize: fs });
        }
      });
      results.tinyText = tinyText.slice(0, 10);

      // Check for missing alt on images
      const images = document.querySelectorAll('img');
      const missingAlt = [];
      images.forEach(img => {
        if (!img.alt && !img.getAttribute('aria-label')) {
          missingAlt.push(img.src.substring(0, 100));
        }
      });
      results.missingAltImages = missingAlt;

      // Check buttons without accessible names
      const buttons = document.querySelectorAll('button, [role="button"]');
      const unlabeledButtons = [];
      buttons.forEach(btn => {
        const text = btn.textContent?.trim();
        const ariaLabel = btn.getAttribute('aria-label');
        const title = btn.getAttribute('title');
        if (!text && !ariaLabel && !title) {
          unlabeledButtons.push(btn.outerHTML.substring(0, 150));
        }
      });
      results.unlabeledButtons = unlabeledButtons.slice(0, 10);

      // Check for hardcoded colors (inline styles)
      const allElements = document.querySelectorAll('*');
      let hardcodedColors = 0;
      allElements.forEach(el => {
        const style = el.getAttribute('style');
        if (style && (style.includes('color:') || style.includes('background'))) {
          hardcodedColors++;
        }
      });
      results.hardcodedInlineColors = hardcodedColors;

      // Check z-index stacking issues
      const highZIndex = [];
      allElements.forEach(el => {
        const cs = window.getComputedStyle(el);
        const z = parseInt(cs.zIndex);
        if (z > 1000) {
          highZIndex.push({ tag: el.tagName, class: el.className?.substring?.(0, 50), zIndex: z });
        }
      });
      results.highZIndex = highZIndex.slice(0, 5);

      // Count interactive elements
      const interactive = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex]');
      results.interactiveElementCount = interactive.length;

      // Check font families used
      const fontFamilies = new Set();
      allText.forEach(el => {
        const cs = window.getComputedStyle(el);
        fontFamilies.add(cs.fontFamily.split(',')[0].trim().replace(/"/g, ''));
      });
      results.fontFamilies = [...fontFamilies];

      // Color palette used (sample backgrounds and text colors)
      const bgColors = new Set();
      const textColors = new Set();
      const sampleElements = document.querySelectorAll('header, nav, main, section, footer, .card, .btn, button, h1, h2, h3, p');
      sampleElements.forEach(el => {
        const cs = window.getComputedStyle(el);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bgColors.add(cs.backgroundColor);
        textColors.add(cs.color);
      });
      results.backgroundColors = [...bgColors].slice(0, 15);
      results.textColors = [...textColors].slice(0, 15);

      return results;
    });

    console.log(`  Page dimensions: ${analysis.pageWidth}x${analysis.pageHeight}`);
    console.log(`  Horizontal overflow: ${analysis.hasHorizontalOverflow}`);
    console.log(`  Interactive elements: ${analysis.interactiveElementCount}`);
    console.log(`  Font families: ${analysis.fontFamilies.join(', ')}`);

    if (analysis.tinyText.length > 0) {
      console.log(`  TINY TEXT (<10px):`);
      analysis.tinyText.forEach(t => console.log(`    <${t.tag}> "${t.text}" (${t.fontSize}px)`));
    }

    if (analysis.missingAltImages.length > 0) {
      console.log(`  MISSING ALT on images:`);
      analysis.missingAltImages.forEach(i => console.log(`    ${i}`));
    }

    if (analysis.unlabeledButtons.length > 0) {
      console.log(`  UNLABELED BUTTONS:`);
      analysis.unlabeledButtons.forEach(b => console.log(`    ${b}`));
    }

    if (analysis.hardcodedInlineColors > 0) {
      console.log(`  Inline color styles: ${analysis.hardcodedInlineColors}`);
    }

    if (analysis.highZIndex.length > 0) {
      console.log(`  HIGH Z-INDEX elements:`);
      analysis.highZIndex.forEach(z => console.log(`    <${z.tag}> class="${z.class}" z-index=${z.zIndex}`));
    }

    console.log(`  Background colors: ${analysis.backgroundColors.join(', ')}`);
    console.log(`  Text colors: ${analysis.textColors.join(', ')}`);

    await context.close();
  }

  await browser.close();
  console.log('\n\nAnalysis complete.');
}

analyze().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
