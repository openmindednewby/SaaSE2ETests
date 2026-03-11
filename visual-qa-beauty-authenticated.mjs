/**
 * Visual Beauty & Quality QA Script (Authenticated)
 * Logs in via quick-login, then tests 11 pages for beauty, professionalism, and visual quality.
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

async function login(page) {
  console.log('Navigating to login page...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Look for quick login buttons
  const adminButton = await page.$('button:has-text("Admin"), [data-testid*="admin" i], button:has-text("admin")');
  if (adminButton) {
    console.log('Found Admin quick-login button, clicking...');
    await adminButton.click();
    await page.waitForTimeout(3000);

    // Check if we're now on the dashboard or still on login
    const currentUrl = page.url();
    console.log(`After admin click, URL: ${currentUrl}`);

    if (currentUrl.includes('/login') || currentUrl === `${BASE_URL}/`) {
      // The admin button may have just filled in the credentials - look for LOGIN button
      const loginButton = await page.$('button:has-text("LOGIN"), button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]');
      if (loginButton) {
        console.log('Clicking LOGIN button...');
        await loginButton.click();
        await page.waitForTimeout(5000);
      }
    }
  } else {
    // Manual login fallback
    console.log('No quick-login button found. Trying manual login...');
    const emailInput = await page.$('input[type="email"], input[name="email"], input[name="username"], input[placeholder*="email" i], input[placeholder*="user" i]');
    const passwordInput = await page.$('input[type="password"]');

    if (emailInput && passwordInput) {
      await emailInput.fill('admin@example.com');
      await passwordInput.fill('password123');

      const submitBtn = await page.$('button[type="submit"], button:has-text("LOGIN"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(5000);
      }
    }
  }

  const finalUrl = page.url();
  console.log(`Login result URL: ${finalUrl}`);
  const isLoggedIn = !finalUrl.includes('/login');
  console.log(`Authenticated: ${isLoggedIn}`);
  return isLoggedIn;
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

  const consoleMessages = [];
  const consoleHandler = (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out known HMR/Vite noise
      if (!text.includes('__vite_ping') && !text.includes('favicon')) {
        pageResult.consoleErrors.push(text);
      }
    } else if (msg.type() === 'warning') {
      pageResult.consoleWarnings.push(msg.text());
    }
  };
  page.on('console', consoleHandler);

  const networkHandler = (request) => {
    const url = request.url();
    if (!url.includes('__vite') && !url.startsWith('data:') && !url.includes('chrome-extension:')) {
      pageResult.networkErrors.push({
        url: url,
        failure: request.failure()?.errorText,
      });
    }
  };
  page.on('requestfailed', networkHandler);

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
    page.off('console', consoleHandler);
    page.off('requestfailed', networkHandler);
    return pageResult;
  }

  // Wait for content to render
  await page.waitForTimeout(3000);

  // Check if we got redirected to login
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    pageResult.issues.push({
      severity: 'CRITICAL',
      category: 'Auth',
      description: 'Page redirected to login - authentication lost',
    });
  }

  // Take screenshots at all breakpoints
  for (const bp of BREAKPOINTS) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(1000);

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
      currentUrl: window.location.href,
      bodyTextPreview: document.body.innerText.substring(0, 300),
      totalElements: document.querySelectorAll('*').length,
      interactiveElements: document.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex]').length,
      images: document.querySelectorAll('img').length,
      headings: [],
      overflowIssues: [],
      missingAltText: [],
      buttonsWithoutNames: [],
      fontSizes: new Set(),
      backgroundColors: new Set(),
      textColors: new Set(),
      sectionCount: document.querySelectorAll('section, [class*="section"]').length,
      cardCount: document.querySelectorAll('[class*="card"], [class*="Card"]').length,
      tableCount: document.querySelectorAll('table, [class*="e-grid"]').length,
      buttonCount: document.querySelectorAll('button').length,
      inputCount: document.querySelectorAll('input, select, textarea').length,
      hasSidebar: !!document.querySelector('[class*="sidebar"], [class*="Sidebar"], nav, aside'),
      hasHeader: !!document.querySelector('header, [class*="header"], [class*="Header"], [class*="topbar"]'),
      darkModeClass: document.documentElement.classList.contains('dark'),
      pageHasContent: document.body.innerText.trim().length > 100,
    };

    // Check headings hierarchy
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      analysis.headings.push({
        level: h.tagName,
        text: h.textContent.trim().substring(0, 80),
      });
    });

    // Check for overflow issues
    const viewportWidth = window.innerWidth;
    document.querySelectorAll('*').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.right > viewportWidth + 5 && style.position === 'static' && rect.width > 10) {
        analysis.overflowIssues.push({
          tag: el.tagName,
          class: el.className?.toString().substring(0, 100),
          right: Math.round(rect.right),
          viewportWidth,
        });
      }
    });

    // Check images without alt text
    document.querySelectorAll('img').forEach((img) => {
      if (!img.alt && !img.getAttribute('aria-label')) {
        analysis.missingAltText.push({ src: img.src?.substring(0, 100) });
      }
    });

    // Check buttons without accessible names
    document.querySelectorAll('button, [role="button"]').forEach((btn) => {
      const name = btn.textContent?.trim() || btn.getAttribute('aria-label') || btn.getAttribute('title');
      if (!name) {
        analysis.buttonsWithoutNames.push({
          html: btn.outerHTML.substring(0, 150),
        });
      }
    });

    // Sample font sizes and colors
    const visibleEls = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, button, a, label, td, th, li');
    let count = 0;
    visibleEls.forEach((el) => {
      if (count > 40) return;
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
        count++;
      }
    });

    analysis.fontSizes = [...analysis.fontSizes];
    analysis.backgroundColors = [...analysis.backgroundColors];
    analysis.textColors = [...analysis.textColors];

    return analysis;
  });

  pageResult.domAnalysis = domAnalysis;

  // Get full visible text
  pageResult.visibleText = await page.evaluate(() => document.body.innerText.substring(0, 3000));

  // Detailed layout checks
  pageResult.layoutChecks = await page.evaluate(() => {
    const checks = {
      hasProperSpacing: true,
      hasVisualHierarchy: false,
      contentAreaWidth: 0,
      contentAreaHeight: 0,
      scrollableWidth: document.documentElement.scrollWidth,
      scrollableHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      emptyPageDetected: false,
      overlappingElements: [],
    };

    // Check if page appears empty
    const bodyText = document.body.innerText.trim();
    checks.emptyPageDetected = bodyText.length < 50;

    // Check for heading hierarchy (visual hierarchy)
    const headings = document.querySelectorAll('h1, h2, h3, h4');
    checks.hasVisualHierarchy = headings.length > 0;

    // Check content area
    const mainContent = document.querySelector('main') || document.querySelector('[class*="content"]') || document.querySelector('#root > div');
    if (mainContent) {
      const rect = mainContent.getBoundingClientRect();
      checks.contentAreaWidth = Math.round(rect.width);
      checks.contentAreaHeight = Math.round(rect.height);
    }

    return checks;
  });

  page.off('console', consoleHandler);
  page.off('requestfailed', networkHandler);

  return pageResult;
}

async function main() {
  console.log('=== Visual Beauty & Quality QA (Authenticated) ===');
  console.log(`Testing ${PAGES.length} pages at ${BASE_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const page = await context.newPage();

  // Login first
  const isAuthenticated = await login(page);
  if (!isAuthenticated) {
    console.log('WARNING: Authentication may have failed. Continuing anyway...');
  }

  // Take screenshot of post-login state
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'post-login-state.png'),
    fullPage: true,
  });

  for (const pageConfig of PAGES) {
    console.log(`\n--- Testing: ${pageConfig.name} (${pageConfig.path}) ---`);

    const result = await analyzePageVisuals(page, pageConfig.name, pageConfig.path);
    results[pageConfig.name] = result;

    // Print summary for this page
    console.log(`  URL: ${result.domAnalysis?.currentUrl || 'unknown'}`);
    console.log(`  Screenshots: ${Object.keys(result.screenshots).length}`);
    console.log(`  Console Errors: ${result.consoleErrors.length}`);
    console.log(`  Console Warnings: ${result.consoleWarnings.length}`);
    console.log(`  Network Errors: ${result.networkErrors.length}`);
    console.log(`  Total Elements: ${result.domAnalysis?.totalElements || 0}`);
    console.log(`  Interactive Elements: ${result.domAnalysis?.interactiveElements || 0}`);
    console.log(`  Headings: ${JSON.stringify(result.domAnalysis?.headings || [])}`);
    console.log(`  Overflow Issues: ${result.domAnalysis?.overflowIssues?.length || 0}`);
    console.log(`  Buttons: ${result.domAnalysis?.buttonCount || 0}, Inputs: ${result.domAnalysis?.inputCount || 0}`);
    console.log(`  Tables: ${result.domAnalysis?.tableCount || 0}, Cards: ${result.domAnalysis?.cardCount || 0}`);
    console.log(`  Sidebar: ${result.domAnalysis?.hasSidebar}, Header: ${result.domAnalysis?.hasHeader}`);
    console.log(`  Has Content: ${result.domAnalysis?.pageHasContent}`);
    console.log(`  Layout: horizontal-overflow=${result.layoutChecks?.horizontalOverflow}, content-width=${result.layoutChecks?.contentAreaWidth}`);
    console.log(`  Font Sizes: ${result.domAnalysis?.fontSizes?.join(', ')}`);

    if (result.consoleErrors.length > 0) {
      console.log(`  CONSOLE ERRORS:`);
      result.consoleErrors.forEach((e) => console.log(`    - ${e.substring(0, 200)}`));
    }

    if (result.networkErrors.length > 0) {
      console.log(`  NETWORK ERRORS:`);
      result.networkErrors.slice(0, 5).forEach((e) => console.log(`    - ${e.url}: ${e.failure}`));
      if (result.networkErrors.length > 5) {
        console.log(`    ... and ${result.networkErrors.length - 5} more`);
      }
    }

    // Print first 500 chars of visible text
    console.log(`  VISIBLE TEXT (preview): ${(result.visibleText || '').substring(0, 400).replace(/\n/g, ' | ')}`);
  }

  // Write full results to JSON
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'results-authenticated.json'),
    JSON.stringify(results, null, 2)
  );

  await browser.close();
  console.log(`\n\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('Results saved to: results-authenticated.json');
}

main().catch(console.error);
