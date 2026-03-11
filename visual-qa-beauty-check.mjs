/**
 * Visual Beauty & Quality QA Script
 * Tests 11 pages for beauty, professionalism, and visual quality.
 * Captures screenshots at Desktop, Tablet, and Mobile breakpoints.
 * Checks for console errors, layout issues, accessibility concerns.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4444';
const SCREENSHOT_DIR = path.resolve('qa-screenshots/visual-beauty-qa');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const PAGES = [
  { name: 'Syncfusion Grid', path: '/components/grid/syncfusion' },
  { name: 'Grid Playground', path: '/components/grid/playground' },
  { name: 'Native Button', path: '/components/button/native' },
  { name: 'Syncfusion Button', path: '/components/button/syncfusion' },
  { name: 'Native Input', path: '/components/input/native' },
  { name: 'Syncfusion Input', path: '/components/input/syncfusion' },
  { name: 'Native Select', path: '/components/select/native' },
  { name: 'Syncfusion Select', path: '/components/select/syncfusion' },
  { name: 'Native DatePicker', path: '/components/datepicker/native' },
  { name: 'Native Dialog', path: '/components/dialog/native' },
  { name: 'Syncfusion Dialog', path: '/components/dialog/syncfusion' },
];

const BREAKPOINTS = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 375, height: 812 },
];

const results = {};

function sanitizeName(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function analyzePageVisuals(page, pageName, routePath) {
  const pageResult = {
    name: pageName,
    path: routePath,
    consoleErrors: [],
    consoleWarnings: [],
    networkErrors: [],
    screenshots: {},
    domAnalysis: null,
    issues: [],
  };

  // Collect console messages
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      pageResult.consoleErrors.push(msg.text());
    } else if (msg.type() === 'warning') {
      pageResult.consoleWarnings.push(msg.text());
    }
  });

  // Collect network errors
  page.on('requestfailed', (request) => {
    pageResult.networkErrors.push({
      url: request.url(),
      failure: request.failure()?.errorText,
    });
  });

  // Navigate to the page
  try {
    await page.goto(`${BASE_URL}${routePath}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
  } catch (e) {
    pageResult.issues.push({
      severity: 'CRITICAL',
      category: 'Navigation',
      description: `Page failed to load: ${e.message}`,
    });
    return pageResult;
  }

  // Wait for content to render
  await page.waitForTimeout(2000);

  // Take screenshots at all breakpoints
  for (const bp of BREAKPOINTS) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(500);

    const filename = `${sanitizeName(pageName)}-${bp.name.toLowerCase()}.png`;
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, filename),
      fullPage: true,
    });
    pageResult.screenshots[bp.name] = filename;
  }

  // Reset to desktop for DOM analysis
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);

  // DOM Analysis
  const domAnalysis = await page.evaluate(() => {
    const analysis = {
      title: document.title,
      bodyText: document.body.innerText.substring(0, 500),
      totalElements: document.querySelectorAll('*').length,
      interactiveElements: document.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex]').length,
      images: document.querySelectorAll('img').length,
      headings: [],
      colorIssues: [],
      spacingIssues: [],
      overflowIssues: [],
      emptyContainers: [],
      missingAltText: [],
      fontSizes: new Set(),
      backgroundColors: new Set(),
      textColors: new Set(),
      layoutAnalysis: {},
    };

    // Check headings hierarchy
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      analysis.headings.push({
        level: h.tagName,
        text: h.textContent.trim().substring(0, 80),
      });
    });

    // Check for overflow issues
    document.querySelectorAll('*').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      if (rect.width > window.innerWidth && style.position !== 'fixed' && style.position !== 'absolute') {
        analysis.overflowIssues.push({
          tag: el.tagName,
          class: el.className?.toString().substring(0, 100),
          width: rect.width,
          windowWidth: window.innerWidth,
        });
      }
    });

    // Check images without alt text
    document.querySelectorAll('img').forEach((img) => {
      if (!img.alt && !img.getAttribute('aria-label')) {
        analysis.missingAltText.push({
          src: img.src?.substring(0, 100),
        });
      }
    });

    // Check for empty containers that might cause blank spaces
    document.querySelectorAll('div, section, main').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 50 && el.children.length === 0 && !el.textContent.trim()) {
        analysis.emptyContainers.push({
          tag: el.tagName,
          class: el.className?.toString().substring(0, 100),
          height: rect.height,
        });
      }
    });

    // Sample font sizes and colors from visible elements
    const visibleElements = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, button, a, label, td, th, li, div');
    let sampleCount = 0;
    visibleElements.forEach((el) => {
      if (sampleCount > 50) return;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        analysis.fontSizes.add(style.fontSize);
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          analysis.backgroundColors.add(style.backgroundColor);
        }
        if (el.textContent.trim()) {
          analysis.textColors.add(style.color);
        }
        sampleCount++;
      }
    });

    // Convert Sets to Arrays for JSON serialization
    analysis.fontSizes = [...analysis.fontSizes];
    analysis.backgroundColors = [...analysis.backgroundColors];
    analysis.textColors = [...analysis.textColors];

    // Check main content area layout
    const mainContent = document.querySelector('main, [role="main"], #root > div');
    if (mainContent) {
      const mainRect = mainContent.getBoundingClientRect();
      analysis.layoutAnalysis = {
        mainContentWidth: mainRect.width,
        mainContentHeight: mainRect.height,
        mainContentTop: mainRect.top,
        mainContentLeft: mainRect.left,
      };
    }

    // Check for buttons without accessible names
    const buttonsWithoutNames = [];
    document.querySelectorAll('button, [role="button"]').forEach((btn) => {
      const name = btn.textContent?.trim() || btn.getAttribute('aria-label') || btn.getAttribute('title');
      if (!name) {
        buttonsWithoutNames.push({
          tag: btn.tagName,
          class: btn.className?.toString().substring(0, 100),
          html: btn.outerHTML.substring(0, 200),
        });
      }
    });
    analysis.buttonsWithoutNames = buttonsWithoutNames;

    // Check for text that might be truncated or clipped
    const truncatedText = [];
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.overflow === 'hidden' && style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) {
        truncatedText.push({
          tag: el.tagName,
          text: el.textContent?.trim().substring(0, 50),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
      }
    });
    analysis.truncatedText = truncatedText;

    // Check z-index stacking issues
    const highZIndex = [];
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const zIndex = parseInt(style.zIndex);
      if (zIndex > 100) {
        highZIndex.push({
          tag: el.tagName,
          class: el.className?.toString().substring(0, 100),
          zIndex: zIndex,
        });
      }
    });
    analysis.highZIndex = highZIndex;

    return analysis;
  });

  pageResult.domAnalysis = domAnalysis;

  // Detailed visual quality checks
  const visualQuality = await page.evaluate(() => {
    const quality = {
      hasConsistentSpacing: true,
      hasProperAlignment: true,
      hasVisualHierarchy: true,
      hasColorHarmony: true,
      pageHasContent: false,
      contentAreaSize: { width: 0, height: 0 },
      sectionCount: 0,
      cardCount: 0,
      tableCount: 0,
      formCount: 0,
      buttonCount: 0,
      inputCount: 0,
      hasSidebar: false,
      hasHeader: false,
      hasFooter: false,
      darkModeClass: document.documentElement.classList.contains('dark'),
      visibleText: '',
    };

    // Check for major UI elements
    quality.sectionCount = document.querySelectorAll('section, [class*="section"]').length;
    quality.cardCount = document.querySelectorAll('[class*="card"], [class*="Card"]').length;
    quality.tableCount = document.querySelectorAll('table, [class*="e-grid"]').length;
    quality.formCount = document.querySelectorAll('form').length;
    quality.buttonCount = document.querySelectorAll('button').length;
    quality.inputCount = document.querySelectorAll('input, select, textarea').length;

    // Check for sidebar, header, footer
    quality.hasSidebar = !!document.querySelector('[class*="sidebar"], [class*="Sidebar"], nav, aside');
    quality.hasHeader = !!document.querySelector('header, [class*="header"], [class*="Header"], [class*="topbar"], [class*="Topbar"]');
    quality.hasFooter = !!document.querySelector('footer, [class*="footer"], [class*="Footer"]');

    // Get visible text content
    quality.visibleText = document.body.innerText.substring(0, 2000);
    quality.pageHasContent = document.body.innerText.trim().length > 50;

    // Content area dimensions
    const contentArea = document.querySelector('main, [role="main"]') || document.querySelector('#root > div > div:last-child');
    if (contentArea) {
      const rect = contentArea.getBoundingClientRect();
      quality.contentAreaSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
    }

    // Check alignment of sibling elements
    const sections = document.querySelectorAll('[class*="showcase"], [class*="Showcase"], [class*="section"], section');
    let lastLeft = null;
    sections.forEach((s) => {
      const rect = s.getBoundingClientRect();
      if (lastLeft !== null && Math.abs(rect.left - lastLeft) > 2) {
        quality.hasProperAlignment = false;
      }
      lastLeft = rect.left;
    });

    return quality;
  });

  pageResult.visualQuality = visualQuality;

  return pageResult;
}

async function main() {
  console.log('=== Visual Beauty & Quality QA ===');
  console.log(`Testing ${PAGES.length} pages at ${BASE_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const page = await context.newPage();

  for (const pageConfig of PAGES) {
    console.log(`\n--- Testing: ${pageConfig.name} (${pageConfig.path}) ---`);

    const result = await analyzePageVisuals(page, pageConfig.name, pageConfig.path);
    results[pageConfig.name] = result;

    // Print summary for this page
    console.log(`  Screenshots: ${Object.keys(result.screenshots).length}`);
    console.log(`  Console Errors: ${result.consoleErrors.length}`);
    console.log(`  Console Warnings: ${result.consoleWarnings.length}`);
    console.log(`  Network Errors: ${result.networkErrors.length}`);

    if (result.domAnalysis) {
      console.log(`  Total Elements: ${result.domAnalysis.totalElements}`);
      console.log(`  Interactive Elements: ${result.domAnalysis.interactiveElements}`);
      console.log(`  Headings: ${result.domAnalysis.headings.length}`);
      console.log(`  Overflow Issues: ${result.domAnalysis.overflowIssues.length}`);
      console.log(`  Missing Alt Text: ${result.domAnalysis.missingAltText.length}`);
      console.log(`  Buttons Without Names: ${result.domAnalysis.buttonsWithoutNames.length}`);
    }

    if (result.visualQuality) {
      console.log(`  Has Content: ${result.visualQuality.pageHasContent}`);
      console.log(`  Dark Mode: ${result.visualQuality.darkModeClass}`);
      console.log(`  Sections: ${result.visualQuality.sectionCount}, Cards: ${result.visualQuality.cardCount}`);
      console.log(`  Tables: ${result.visualQuality.tableCount}, Forms: ${result.visualQuality.formCount}`);
      console.log(`  Buttons: ${result.visualQuality.buttonCount}, Inputs: ${result.visualQuality.inputCount}`);
      console.log(`  Sidebar: ${result.visualQuality.hasSidebar}, Header: ${result.visualQuality.hasHeader}`);
    }

    if (result.consoleErrors.length > 0) {
      console.log(`  CONSOLE ERRORS:`);
      result.consoleErrors.forEach((e) => console.log(`    - ${e.substring(0, 200)}`));
    }

    if (result.networkErrors.length > 0) {
      console.log(`  NETWORK ERRORS:`);
      result.networkErrors.forEach((e) => console.log(`    - ${e.url}: ${e.failure}`));
    }
  }

  // Write full results to JSON
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'results.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('\n\n=== Full Page Text Content ===');
  for (const [name, result] of Object.entries(results)) {
    console.log(`\n--- ${name} ---`);
    if (result.visualQuality?.visibleText) {
      console.log(result.visualQuality.visibleText.substring(0, 3000));
    }
    console.log(`\nHeadings:`);
    result.domAnalysis?.headings?.forEach((h) => {
      console.log(`  ${h.level}: ${h.text}`);
    });
    console.log(`\nFont Sizes: ${result.domAnalysis?.fontSizes?.join(', ')}`);
    console.log(`Background Colors: ${result.domAnalysis?.backgroundColors?.join(', ')}`);
    console.log(`Text Colors: ${result.domAnalysis?.textColors?.join(', ')}`);
    console.log(`Content Area: ${JSON.stringify(result.visualQuality?.contentAreaSize)}`);
  }

  await browser.close();
  console.log(`\n\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('Results saved to: results.json');
}

main().catch(console.error);
