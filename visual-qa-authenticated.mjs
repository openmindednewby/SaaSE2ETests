/**
 * Comprehensive Visual QA Script - Authenticated Version
 * Tests all pages of the SyncfusionThemeStudio app at http://localhost:4444
 * Uses demo credentials: admin@example.com / admin123
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4444';
const SCREENSHOT_DIR = path.resolve('qa-screenshots/comprehensive-auth');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const BREAKPOINTS = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 375, height: 812 },
];

// Results storage
const issues = [];
const pageResults = {};

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
}

function addIssue(severity, page, category, description, evidence, filePath, fix) {
  issues.push({ severity, page, category, description, evidence, filePath, fix });
}

async function login(page) {
  console.log('Attempting login with demo credentials...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try clicking the Admin demo credential button first
  const adminBtn = await page.$('[data-testid="login-demo-admin"]');
  if (adminBtn) {
    console.log('  Found demo credentials button, clicking...');
    await adminBtn.click();
    await page.waitForTimeout(1000);
  } else {
    // Manually fill form
    console.log('  Filling login form manually...');
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"]');
    if (emailInput) await emailInput.fill('admin@example.com');
    if (passwordInput) await passwordInput.fill('admin123');
  }

  // Click submit/login button
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    console.log('  Clicked submit button');
  }

  // Wait for navigation
  await page.waitForTimeout(3000);

  // Verify login succeeded
  const currentUrl = page.url();
  console.log(`  Current URL after login: ${currentUrl}`);

  if (currentUrl.includes('/login')) {
    console.log('  Login may have failed - still on login page');

    // Try again with direct form fill
    const emailInput2 = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passwordInput2 = await page.$('input[type="password"]');
    if (emailInput2) {
      await emailInput2.fill('');
      await emailInput2.fill('admin@example.com');
    }
    if (passwordInput2) {
      await passwordInput2.fill('');
      await passwordInput2.fill('admin123');
    }
    const submitBtn2 = await page.$('button[type="submit"]');
    if (submitBtn2) await submitBtn2.click();
    await page.waitForTimeout(3000);
    console.log(`  URL after retry: ${page.url()}`);
  }

  // Check if we can access dashboard now
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  const dashUrl = page.url();
  const isLoggedIn = !dashUrl.includes('/login') && dashUrl !== `${BASE_URL}/`;
  console.log(`  Login ${isLoggedIn ? 'SUCCEEDED' : 'FAILED'} - dashboard URL: ${dashUrl}`);
  return isLoggedIn;
}

async function testPage(page, routeName, routePath, screenshotPrefix) {
  const result = {
    visual: 'PASS',
    responsive: 'PASS',
    a11y: 'PASS',
    console: 'PASS',
    network: 'PASS',
    functional: 'PASS',
    overall: 'PASS',
  };

  console.log(`\n--- Testing: ${routeName} (${routePath}) ---`);

  // Collect console errors
  const consoleErrors = [];
  const consoleHandler = (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ type: 'error', text: msg.text() });
    } else if (msg.type() === 'warning') {
      consoleErrors.push({ type: 'warning', text: msg.text() });
    }
  };
  page.on('console', consoleHandler);

  // Collect network errors
  const networkErrors = [];
  const responseHandler = (response) => {
    const status = response.status();
    const url = response.url();
    if (url.startsWith('data:') || url.includes('__vite') || url.includes('hot-update') || url.includes('@vite') || url.includes('node_modules')) return;
    if (status >= 400) {
      networkErrors.push({ status, url: url.substring(0, 150), statusText: response.statusText() });
    }
  };
  page.on('response', responseHandler);

  try {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate
    const response = await page.goto(`${BASE_URL}${routePath}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(2500);

    const finalUrl = page.url();

    // Check if redirected to login
    if (finalUrl.includes('/login') || (finalUrl === `${BASE_URL}/` && routePath !== '/')) {
      console.log(`  [AUTH REDIRECT] Redirected to: ${finalUrl}`);
      result.functional = 'AUTH_REDIRECT';
      result.overall = 'AUTH_REDIRECT';
      page.off('console', consoleHandler);
      page.off('response', responseHandler);
      return result;
    }

    // --- DESKTOP SCREENSHOT ---
    const desktopScreenshot = `${screenshotPrefix}-desktop.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, desktopScreenshot), fullPage: true });

    // --- VISUAL CHECKS ---
    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (hasOverflow) {
      result.visual = 'FAIL';
      addIssue('MEDIUM', routePath, 'Visual', `${routeName}: Horizontal overflow at desktop viewport`, desktopScreenshot, '', 'Fix horizontal overflow');
    }

    // Check for broken images
    const brokenImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      const broken = [];
      imgs.forEach(img => {
        if (img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith('data:')) {
          broken.push(img.src?.substring(0, 100));
        }
      });
      return broken;
    });
    if (brokenImages.length > 0) {
      result.visual = 'FAIL';
      addIssue('HIGH', routePath, 'Visual', `${routeName}: ${brokenImages.length} broken images: ${brokenImages.slice(0, 3).join(', ')}`, desktopScreenshot, '', 'Fix broken image sources');
    }

    // Check for error boundary
    const hasErrorBoundary = await page.evaluate(() => {
      const errorTexts = ['something went wrong', 'error occurred', 'an error', 'crashed', 'unexpected error'];
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      // Be more specific - check for error boundary patterns, not just any text
      const errorContainers = document.querySelectorAll('[class*="error-boundary"], [data-testid*="error"]');
      if (errorContainers.length > 0) return true;
      // Check if the page ONLY shows an error message (very short content with error text)
      if (bodyText.length < 200) {
        return errorTexts.some(t => bodyText.includes(t));
      }
      return false;
    });
    if (hasErrorBoundary) {
      result.functional = 'FAIL';
      addIssue('CRITICAL', routePath, 'Functional', `${routeName}: Error boundary triggered - page may have crashed`, desktopScreenshot, '', 'Fix page crash');
    }

    // Check for empty page
    const pageContent = await page.evaluate(() => {
      const main = document.querySelector('main, [role="main"], #root');
      return main?.innerText?.trim()?.length || 0;
    });
    if (pageContent < 5) {
      result.functional = 'FAIL';
      addIssue('HIGH', routePath, 'Functional', `${routeName}: Page appears empty (${pageContent} chars of content)`, desktopScreenshot, '', 'Investigate empty page');
    }

    // --- RESPONSIVE CHECKS ---
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(800);

      const bpScreenshot = `${screenshotPrefix}-${bp.name.toLowerCase()}.png`;
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, bpScreenshot), fullPage: true });

      const bpOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      if (bpOverflow) {
        result.responsive = 'FAIL';
        addIssue('MEDIUM', routePath, 'Responsive', `${routeName}: Horizontal overflow at ${bp.name} (${bp.width}x${bp.height})`, bpScreenshot, '', `Fix overflow at ${bp.name}`);
      }

      // Check for text truncation/overlap at mobile
      if (bp.name === 'Mobile') {
        const overflowElements = await page.evaluate(() => {
          let count = 0;
          const elements = document.querySelectorAll('h1, h2, h3, p, span, button, a');
          elements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth + 5) count++;
          });
          return count;
        });
        if (overflowElements > 3) {
          addIssue('LOW', routePath, 'Responsive', `${routeName}: ${overflowElements} elements extend beyond viewport on Mobile`, bpScreenshot, '', 'Fix mobile overflow');
        }
      }
    }

    // Reset viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // --- ACCESSIBILITY CHECKS ---
    const a11yResult = await page.evaluate(() => {
      const issues = [];

      // Buttons without accessible names
      const btns = document.querySelectorAll('button, [role="button"]');
      let unlabeledBtns = 0;
      btns.forEach(btn => {
        const name = btn.textContent?.trim() || btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
        if (!name && getComputedStyle(btn).display !== 'none') unlabeledBtns++;
      });
      if (unlabeledBtns > 0) issues.push(`${unlabeledBtns} buttons without accessible names`);

      // Images without alt
      const imgs = document.querySelectorAll('img');
      let noAltImgs = 0;
      imgs.forEach(img => {
        if (!img.alt && !img.getAttribute('aria-label') && img.getAttribute('role') !== 'presentation' && !img.src?.startsWith('data:')) {
          noAltImgs++;
        }
      });
      if (noAltImgs > 0) issues.push(`${noAltImgs} images without alt text`);

      // Inputs without labels
      const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
      let unlabeledInputs = 0;
      inputs.forEach(input => {
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
        const hasPlaceholder = input.placeholder;
        if (!hasLabel && !hasAriaLabel && !hasPlaceholder && getComputedStyle(input).display !== 'none') {
          unlabeledInputs++;
        }
      });
      if (unlabeledInputs > 0) issues.push(`${unlabeledInputs} form inputs without labels`);

      // Heading hierarchy
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const levels = headings.map(h => parseInt(h.tagName[1]));
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          issues.push(`Heading skip: h${levels[i - 1]} to h${levels[i]}`);
          break;
        }
      }

      // Check for focusable elements without visible focus indicator (basic)
      const focusableCount = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length;

      return { issues, focusableCount };
    });

    if (a11yResult.issues.length > 0) {
      result.a11y = 'FAIL';
      a11yResult.issues.forEach(issue => {
        const severity = issue.includes('button') || issue.includes('input') ? 'MEDIUM' : 'LOW';
        addIssue(severity, routePath, 'A11y', `${routeName}: ${issue}`, desktopScreenshot, '', 'Fix accessibility issue');
      });
    }

    // --- CONSOLE ERRORS ---
    await page.waitForTimeout(500);
    const jsErrors = consoleErrors.filter(e => e.type === 'error');
    if (jsErrors.length > 0) {
      const uniqueErrors = [...new Set(jsErrors.map(e => e.text.substring(0, 300)))];
      // Filter out known non-issues
      const realErrors = uniqueErrors.filter(e =>
        !e.includes('favicon') && !e.includes('manifest') && !e.includes('service-worker') &&
        !e.includes('Failed to load resource: the server responded with a status of 404') // common for optional resources
      );
      if (realErrors.length > 0) {
        result.console = 'FAIL';
        realErrors.forEach(err => {
          const severity = err.includes('Uncaught') || err.includes('TypeError') || err.includes('ReferenceError') ? 'HIGH' : 'MEDIUM';
          addIssue(severity, routePath, 'Console', `${routeName}: ${err}`, desktopScreenshot, '', 'Fix console error');
        });
      }
    }

    // React warnings
    const reactWarnings = consoleErrors.filter(e =>
      e.type === 'warning' && (e.text.includes('Warning:') || e.text.includes('Each child'))
    );
    if (reactWarnings.length > 0) {
      const uniqueWarnings = [...new Set(reactWarnings.map(w => w.text.substring(0, 200)))];
      uniqueWarnings.forEach(warn => {
        addIssue('LOW', routePath, 'Console', `${routeName}: React Warning: ${warn}`, '', '', 'Fix React warning');
      });
    }

    // --- NETWORK ERRORS ---
    const significantNetErrors = networkErrors.filter(e =>
      !e.url.includes('favicon') && !e.url.includes('.map') && !e.url.includes('hot-update') &&
      !e.url.includes('service-worker') && !e.url.includes('manifest') && !e.url.includes('__vite')
    );
    if (significantNetErrors.length > 0) {
      result.network = 'FAIL';
      significantNetErrors.forEach(err => {
        const severity = err.status >= 500 ? 'HIGH' : (err.status === 404 ? 'LOW' : 'MEDIUM');
        addIssue(severity, routePath, 'Network', `${routeName}: HTTP ${err.status} - ${err.url}`, desktopScreenshot, '', 'Fix network error');
      });
    }

    // Determine overall
    if (Object.values(result).some(v => v === 'FAIL')) {
      result.overall = 'FAIL';
    }

  } catch (e) {
    console.error(`  [ERROR] ${e.message}`);
    result.functional = 'FAIL';
    result.overall = 'FAIL';
    addIssue('CRITICAL', routePath, 'Functional', `${routeName}: Test failed - ${e.message}`, '', '', 'Investigate page failure');
  }

  page.off('console', consoleHandler);
  page.off('response', responseHandler);

  const statusStr = Object.entries(result).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`  ${statusStr}`);

  return result;
}

// All routes organized in testing order
const ALL_ROUTES = [
  // Public
  { name: 'Landing Page', path: '/', public: true },
  { name: 'Login Page', path: '/login', public: true },
  { name: 'Pricing Page', path: '/pricing', public: true },
  // Dashboard
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Dashboard Overview', path: '/dashboard/home/overview' },
  { name: 'Dashboard Metrics', path: '/dashboard/home/metrics' },
  { name: 'Dashboard KPIs', path: '/dashboard/home/kpis' },
  // Business
  { name: 'Customers', path: '/customers' },
  { name: 'Invoices', path: '/invoices' },
  { name: 'Orders', path: '/orders' },
  { name: 'Inventory', path: '/inventory' },
  // Products
  { name: 'Products Native', path: '/products/native' },
  { name: 'Products Syncfusion', path: '/products/syncfusion' },
  // Components (key ones)
  { name: 'Components Native', path: '/components/native' },
  { name: 'Components Syncfusion', path: '/components/syncfusion' },
  { name: 'Grid Native', path: '/components/grid/native' },
  { name: 'Grid Syncfusion', path: '/components/grid/syncfusion' },
  { name: 'Grid Playground', path: '/components/grid/playground' },
  { name: 'Button Native', path: '/components/button/native' },
  { name: 'Input Native', path: '/components/input/native' },
  { name: 'Select Native', path: '/components/select/native' },
  { name: 'DatePicker Native', path: '/components/datepicker/native' },
  { name: 'Dialog Native', path: '/components/dialog/native' },
  { name: 'Alert Native', path: '/components/alert/native' },
  { name: 'Toast Native', path: '/components/toast/native' },
  { name: 'Checkbox Native', path: '/components/checkbox/native' },
  { name: 'Toggle Native', path: '/components/toggle/native' },
  { name: 'Accordion Native', path: '/components/accordion/native' },
  { name: 'Tabs Native', path: '/components/tabs/native' },
  { name: 'Card Native', path: '/components/card/native' },
  { name: 'Badge Native', path: '/components/badge/native' },
  { name: 'Avatar Native', path: '/components/avatar/native' },
  { name: 'Pagination Native', path: '/components/pagination/native' },
  { name: 'Tooltip Native', path: '/components/tooltip/native' },
  { name: 'ProgressBar Native', path: '/components/progressbar/native' },
  { name: 'Tag Native', path: '/components/tag/native' },
  { name: 'Chip Native', path: '/components/chip/native' },
  { name: 'Colors Native', path: '/components/colors/native' },
  { name: 'Icons Native', path: '/components/icons/native' },
  { name: 'Typography Native', path: '/components/typography/native' },
  { name: 'Breadcrumb Native', path: '/components/breadcrumb/native' },
  { name: 'Timeline Native', path: '/components/timeline/native' },
  { name: 'Menu Native', path: '/components/menu/native' },
  { name: 'Toolbar Native', path: '/components/toolbar/native' },
  { name: 'Sidebar Native', path: '/components/sidebar/native' },
  { name: 'SearchPanel Native', path: '/components/searchpanel/native' },
  { name: 'FlexBox Native', path: '/components/flexbox/native' },
  { name: 'TextDescription Native', path: '/components/textdescription/native' },
  { name: 'NavMenu Native', path: '/components/navmenu/native' },
  { name: 'ExternalLink Native', path: '/components/externallink/native' },
  { name: 'Image Native', path: '/components/image/native' },
  { name: 'Loader Native', path: '/components/loader/native' },
  { name: 'SkeletonLoader Native', path: '/components/skeletonloader/native' },
  { name: 'Slider Native', path: '/components/slider/native' },
  { name: 'ThemeToggle Native', path: '/components/themetoggle/native' },
  { name: 'AlertBadge Native', path: '/components/alertbadge/native' },
  // Syncfusion Components
  { name: 'Button Syncfusion', path: '/components/button/syncfusion' },
  { name: 'Input Syncfusion', path: '/components/input/syncfusion' },
  { name: 'Select Syncfusion', path: '/components/select/syncfusion' },
  { name: 'DatePicker Syncfusion', path: '/components/datepicker/syncfusion' },
  { name: 'Dialog Syncfusion', path: '/components/dialog/syncfusion' },
  { name: 'Alert Syncfusion', path: '/components/alert/syncfusion' },
  { name: 'Toast Syncfusion', path: '/components/toast/syncfusion' },
  { name: 'Checkbox Syncfusion', path: '/components/checkbox/syncfusion' },
  { name: 'Toggle Syncfusion', path: '/components/toggle/syncfusion' },
  { name: 'Accordion Syncfusion', path: '/components/accordion/syncfusion' },
  { name: 'Tabs Syncfusion', path: '/components/tabs/syncfusion' },
  { name: 'Card Syncfusion', path: '/components/card/syncfusion' },
  { name: 'Badge Syncfusion', path: '/components/badge/syncfusion' },
  { name: 'Avatar Syncfusion', path: '/components/avatar/syncfusion' },
  { name: 'Chip Syncfusion', path: '/components/chip/syncfusion' },
  { name: 'ProgressBar Syncfusion', path: '/components/progressbar/syncfusion' },
  { name: 'Tooltip Syncfusion', path: '/components/tooltip/syncfusion' },
  { name: 'Tag Syncfusion', path: '/components/tag/syncfusion' },
  { name: 'Breadcrumb Syncfusion', path: '/components/breadcrumb/syncfusion' },
  { name: 'Timeline Syncfusion', path: '/components/timeline/syncfusion' },
  { name: 'Menu Syncfusion', path: '/components/menu/syncfusion' },
  { name: 'Toolbar Syncfusion', path: '/components/toolbar/syncfusion' },
  { name: 'TextDescription Syncfusion', path: '/components/textdescription/syncfusion' },
  // Forms
  { name: 'Forms Syncfusion', path: '/forms/syncfusion' },
  { name: 'Forms Native', path: '/forms/native' },
  // Admin Hub
  { name: 'Admin User Management', path: '/admin/user-management' },
  { name: 'Admin Role Management', path: '/admin/role-management' },
  { name: 'Admin Theme Editor', path: '/admin/theme-editor' },
  { name: 'Admin System Settings', path: '/admin/system-settings' },
  { name: 'Admin Integrations', path: '/admin/integrations' },
  { name: 'Admin Plugins', path: '/admin/plugins' },
  { name: 'Admin Documentation', path: '/admin/documentation' },
  { name: 'Admin Support', path: '/admin/support' },
  // SIEM
  { name: 'Alerts & Incidents', path: '/alerts-incidents' },
  { name: 'Alerts Management', path: '/alerts-incidents/alerts-management' },
  { name: 'Incidents Management', path: '/alerts-incidents/incidents-management' },
  { name: 'Marketplace', path: '/marketplace' },
  // App Pages
  { name: 'Notifications', path: '/notifications' },
  { name: 'User Profile', path: '/profile' },
  { name: 'Activity Log', path: '/activity-log' },
  { name: 'Settings', path: '/settings' },
  // Tools
  { name: 'Calendar', path: '/calendar' },
  { name: 'Kanban', path: '/kanban' },
  { name: 'Gantt', path: '/gantt' },
  { name: 'Editor', path: '/editor' },
  { name: 'File Manager', path: '/file-manager' },
  { name: 'Maps', path: '/maps' },
  { name: 'Chat', path: '/chat' },
  { name: 'PDF Viewer', path: '/pdf-viewer' },
  { name: 'Spreadsheet', path: '/spreadsheet' },
  { name: 'Diagram', path: '/diagram' },
  // Error Pages
  { name: '401 Unauthorized', path: '/errors/401' },
  { name: '403 Forbidden', path: '/errors/403' },
  { name: '500 Server Error', path: '/errors/500' },
];

async function run() {
  console.log('=== COMPREHENSIVE VISUAL QA (AUTHENTICATED) ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Total routes to test: ${ALL_ROUTES.length}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Phase 1: Login
  console.log('=== PHASE 1: AUTHENTICATION ===');
  const isLoggedIn = await login(page);

  if (!isLoggedIn) {
    console.log('\nWARNING: Login failed. Protected routes will be tested but may redirect to login.\n');
  }

  // Phase 2: Test all routes
  console.log('\n=== PHASE 2: PAGE TESTING ===');
  let idx = 0;
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const route of ALL_ROUTES) {
    idx++;
    const prefix = `${String(idx).padStart(3, '0')}-${sanitizeFilename(route.name)}`;
    const result = await testPage(page, route.name, route.path, prefix);
    pageResults[route.path] = result;

    if (result.overall === 'PASS') passCount++;
    else if (result.overall === 'FAIL') failCount++;
    else skipCount++;
  }

  await browser.close();

  // Phase 3: Generate report
  console.log('\n\n' + '='.repeat(80));
  console.log('=== VISUAL QA REPORT ===');
  console.log('='.repeat(80));

  // Count issues by severity
  const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = issues.filter(i => i.severity === 'HIGH').length;
  const mediumCount = issues.filter(i => i.severity === 'MEDIUM').length;
  const lowCount = issues.filter(i => i.severity === 'LOW').length;

  // Determine overall status
  let overallStatus = 'QA_PASSED';
  if (criticalCount > 0 || highCount > 0) overallStatus = 'QA_FAILED';
  else if (mediumCount >= 3) overallStatus = 'QA_FAILED';

  console.log(`\nOverall Status: ${overallStatus}`);
  console.log(`Pages Tested: ${Object.keys(pageResults).length}`);
  console.log(`Results: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP/AUTH_REDIRECT`);
  console.log(`Total Issues: ${issues.length} (CRITICAL: ${criticalCount}, HIGH: ${highCount}, MEDIUM: ${mediumCount}, LOW: ${lowCount})`);

  // Print results summary table
  console.log('\n--- Results Summary ---');
  console.log(`${'Page'.padEnd(50)} | ${'Visual'.padEnd(6)} | ${'Resp'.padEnd(6)} | ${'A11y'.padEnd(6)} | ${'Console'.padEnd(7)} | ${'Net'.padEnd(5)} | ${'Func'.padEnd(12)} | Overall`);
  console.log('-'.repeat(120));
  for (const [routePath, result] of Object.entries(pageResults)) {
    if (result.overall !== 'AUTH_REDIRECT') {
      console.log(`${routePath.padEnd(50)} | ${result.visual.padEnd(6)} | ${result.responsive.padEnd(6)} | ${result.a11y.padEnd(6)} | ${result.console.padEnd(7)} | ${result.network.padEnd(5)} | ${result.functional.padEnd(12)} | ${result.overall}`);
    }
  }

  // Print auth-redirected routes
  const authRedirected = Object.entries(pageResults).filter(([, r]) => r.overall === 'AUTH_REDIRECT');
  if (authRedirected.length > 0) {
    console.log(`\n--- Auth-Redirected Routes (${authRedirected.length}) ---`);
    authRedirected.forEach(([path]) => console.log(`  ${path}`));
  }

  // Print issues sorted by severity
  if (issues.length > 0) {
    console.log('\n--- Issues Found ---');
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    issues.forEach((issue, i) => {
      console.log(`\n[Issue ${i + 1}] [${issue.severity}]`);
      console.log(`  Page: ${issue.page}`);
      console.log(`  Category: ${issue.category}`);
      console.log(`  Description: ${issue.description}`);
      if (issue.evidence) console.log(`  Evidence: ${issue.evidence}`);
      if (issue.fix) console.log(`  Fix: ${issue.fix}`);
    });
  }

  // Issue counts
  console.log('\n--- Issue Counts ---');
  console.log(`CRITICAL: ${criticalCount}`);
  console.log(`HIGH: ${highCount}`);
  console.log(`MEDIUM: ${mediumCount}`);
  console.log(`LOW: ${lowCount}`);

  // Pass/Fail Reasoning
  console.log('\n--- Pass/Fail Reasoning ---');
  if (overallStatus === 'QA_PASSED') {
    console.log('QA_PASSED: No CRITICAL or HIGH issues found, and fewer than 3 MEDIUM issues.');
  } else {
    const reasons = [];
    if (criticalCount > 0) reasons.push(`${criticalCount} CRITICAL issues`);
    if (highCount > 0) reasons.push(`${highCount} HIGH issues`);
    if (mediumCount >= 3) reasons.push(`${mediumCount} MEDIUM issues (threshold: 3)`);
    console.log(`QA_FAILED: ${reasons.join(', ')}`);
  }

  // Save report
  const reportPath = path.join(SCREENSHOT_DIR, 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    overallStatus,
    timestamp: new Date().toISOString(),
    summary: { passCount, failCount, skipCount, criticalCount, highCount, mediumCount, lowCount },
    pageResults,
    issues,
  }, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log(`\nFinished at: ${new Date().toISOString()}`);
}

run().catch(e => {
  console.error('QA script failed:', e);
  process.exit(1);
});
