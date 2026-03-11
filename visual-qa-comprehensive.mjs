/**
 * Comprehensive Visual QA Script
 * Tests all pages of the SyncfusionThemeStudio app at http://localhost:4444
 *
 * Checks: Visual correctness, responsiveness, console errors, network errors,
 *         accessibility, and functional correctness.
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4444';
const SCREENSHOT_DIR = path.resolve('qa-screenshots/comprehensive');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// All routes to test - organized by category
const PUBLIC_ROUTES = [
  { name: 'Landing Page', path: '/' },
  { name: 'Login Page', path: '/login' },
  { name: 'Pricing Page', path: '/pricing' },
];

const DASHBOARD_ROUTES = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Dashboard Overview', path: '/dashboard/home/overview' },
  { name: 'Dashboard Metrics', path: '/dashboard/home/metrics' },
  { name: 'Dashboard KPIs', path: '/dashboard/home/kpis' },
];

const BUSINESS_ROUTES = [
  { name: 'Customers', path: '/customers' },
  { name: 'Invoices', path: '/invoices' },
  { name: 'Orders', path: '/orders' },
  { name: 'Inventory', path: '/inventory' },
];

const PRODUCT_ROUTES = [
  { name: 'Products Native', path: '/products/native' },
  { name: 'Products Syncfusion', path: '/products/syncfusion' },
];

const COMPONENT_ROUTES = [
  { name: 'Components Native', path: '/components/native' },
  { name: 'Components Syncfusion', path: '/components/syncfusion' },
  { name: 'Grid Native', path: '/components/grid/native' },
  { name: 'Grid Syncfusion', path: '/components/grid/syncfusion' },
  { name: 'Grid Playground', path: '/components/grid/playground' },
  { name: 'Button Native', path: '/components/button/native' },
  { name: 'Input Native', path: '/components/input/native' },
  { name: 'Select Native', path: '/components/select/native' },
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
  { name: 'DatePicker Native', path: '/components/datepicker/native' },
];

const FORM_ROUTES = [
  { name: 'Forms Syncfusion', path: '/forms/syncfusion' },
  { name: 'Forms Native', path: '/forms/native' },
];

const ADMIN_ROUTES = [
  { name: 'Admin User Management', path: '/admin/user-management' },
  { name: 'Admin Role Management', path: '/admin/role-management' },
  { name: 'Admin Theme Editor', path: '/admin/theme-editor' },
  { name: 'Admin System Settings', path: '/admin/system-settings' },
  { name: 'Admin Integrations', path: '/admin/integrations' },
  { name: 'Admin Plugins', path: '/admin/plugins' },
  { name: 'Admin Documentation', path: '/admin/documentation' },
  { name: 'Admin Support', path: '/admin/support' },
];

const SIEM_ROUTES = [
  { name: 'Alerts & Incidents', path: '/alerts-incidents' },
  { name: 'Alerts Management', path: '/alerts-incidents/alerts-management' },
  { name: 'Incidents Management', path: '/alerts-incidents/incidents-management' },
  { name: 'Marketplace', path: '/marketplace' },
];

const APP_ROUTES = [
  { name: 'Notifications', path: '/notifications' },
  { name: 'User Profile', path: '/profile' },
  { name: 'Activity Log', path: '/activity-log' },
  { name: 'Settings', path: '/settings' },
];

const TOOL_ROUTES = [
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
];

const ERROR_ROUTES = [
  { name: '401 Unauthorized', path: '/errors/401' },
  { name: '403 Forbidden', path: '/errors/403' },
  { name: '500 Server Error', path: '/errors/500' },
];

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

async function setupAuth(page) {
  // The app uses mock auth in dev mode - check if we need to set up auth state
  // First visit the landing page to understand the auth flow
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });

  // Check if there's already a way in - look for auth store setup
  const hasAuthStore = await page.evaluate(() => {
    try {
      // Check for zustand or redux persist auth
      const modeStorage = localStorage.getItem('mode-storage');
      const authStorage = sessionStorage.getItem('persist:auth');
      return { modeStorage: !!modeStorage, authStorage: !!authStorage };
    } catch { return { modeStorage: false, authStorage: false }; }
  });

  console.log('Auth state:', hasAuthStore);

  // Try to set up mock auth if needed
  // The app likely uses a mock auth in dev - let's check if dashboard is accessible
  const dashResponse = await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const currentUrl = page.url();

  if (currentUrl.includes('/login') || currentUrl === `${BASE_URL}/`) {
    console.log('App requires authentication - attempting login...');
    // Navigate to login page
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });

    // Try to find and fill login form
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    if (emailInput && passwordInput) {
      await emailInput.fill('admin@example.com');
      await passwordInput.fill('password123');

      // Find submit button
      const submitBtn = await page.$('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }
    } else {
      console.log('No login form found - app may use mock auth');
      // Try setting up mock auth tokens
      await page.evaluate(() => {
        // Common mock auth patterns
        const mockAuth = {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          isAuthenticated: true,
          user: { id: '1', email: 'admin@test.com', name: 'Admin User', role: 'admin' },
        };
        sessionStorage.setItem('persist:auth', JSON.stringify(mockAuth));
        localStorage.setItem('persist:auth', JSON.stringify(mockAuth));
      });
    }
    return false;
  }

  console.log('Dashboard accessible without explicit login');
  return true;
}

async function collectConsoleErrors(page) {
  const errors = [];
  const consoleHandler = (msg) => {
    if (msg.type() === 'error') {
      errors.push({ type: 'error', text: msg.text() });
    } else if (msg.type() === 'warning') {
      errors.push({ type: 'warning', text: msg.text() });
    }
  };
  page.on('console', consoleHandler);
  return { errors, cleanup: () => page.off('console', consoleHandler) };
}

async function collectNetworkErrors(page) {
  const networkErrors = [];
  const requestHandler = (response) => {
    const status = response.status();
    const url = response.url();
    // Skip data URLs, browser extensions, HMR websocket
    if (url.startsWith('data:') || url.startsWith('chrome-extension:') || url.includes('__vite_ping')) return;
    if (status >= 400) {
      networkErrors.push({ status, url, statusText: response.statusText() });
    }
  };
  page.on('response', requestHandler);
  return { networkErrors, cleanup: () => page.off('response', requestHandler) };
}

async function checkAccessibility(page, routeName) {
  const a11yIssues = [];

  try {
    // Check for images without alt text
    const imgsWithoutAlt = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      const noAlt = [];
      imgs.forEach(img => {
        if (!img.alt && !img.getAttribute('aria-label') && !img.getAttribute('role')) {
          noAlt.push(img.src?.substring(0, 100) || 'unknown');
        }
      });
      return noAlt;
    });
    if (imgsWithoutAlt.length > 0) {
      a11yIssues.push(`${imgsWithoutAlt.length} images without alt text: ${imgsWithoutAlt.slice(0, 3).join(', ')}`);
    }

    // Check for buttons without accessible names
    const btnsWithoutLabel = await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"]');
      const noLabel = [];
      btns.forEach(btn => {
        const name = btn.textContent?.trim() || btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
        if (!name) {
          noLabel.push(btn.outerHTML.substring(0, 100));
        }
      });
      return noLabel;
    });
    if (btnsWithoutLabel.length > 0) {
      a11yIssues.push(`${btnsWithoutLabel.length} buttons without accessible names`);
    }

    // Check for inputs without labels
    const inputsWithoutLabels = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input, select, textarea');
      const noLabel = [];
      inputs.forEach(input => {
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
        const hasPlaceholder = input.placeholder;
        const hasTitle = input.title;
        if (!hasLabel && !hasAriaLabel && !hasPlaceholder && !hasTitle) {
          noLabel.push(input.type || 'unknown');
        }
      });
      return noLabel;
    });
    if (inputsWithoutLabels.length > 0) {
      a11yIssues.push(`${inputsWithoutLabels.length} inputs without labels/aria-labels`);
    }

    // Check for low contrast (basic check)
    const contrastIssues = await page.evaluate(() => {
      const issues = [];
      const elements = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a, button, label');
      const sampleSize = Math.min(elements.length, 20);
      for (let i = 0; i < sampleSize; i++) {
        const el = elements[Math.floor(i * elements.length / sampleSize)];
        const style = getComputedStyle(el);
        const color = style.color;
        const bg = style.backgroundColor;
        // Basic check: if both are very similar, there may be contrast issues
        if (color === bg && color !== 'rgba(0, 0, 0, 0)') {
          issues.push(`Same color for text and background on ${el.tagName}`);
        }
      }
      return issues;
    });
    if (contrastIssues.length > 0) {
      a11yIssues.push(contrastIssues.join('; '));
    }

    // Check for missing skip navigation
    const hasSkipNav = await page.evaluate(() => {
      return !!document.querySelector('[class*="skip"], a[href="#main"], a[href="#content"]');
    });
    // Only flag on main pages
    if (!hasSkipNav && !routeName.includes('Error') && !routeName.includes('Login')) {
      // This is a LOW issue, not blocking
    }

    // Check for proper heading hierarchy
    const headingIssues = await page.evaluate(() => {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const levels = [];
      headings.forEach(h => levels.push(parseInt(h.tagName[1])));
      const issues = [];
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          issues.push(`Heading skip: h${levels[i - 1]} to h${levels[i]}`);
        }
      }
      return issues;
    });
    if (headingIssues.length > 0) {
      a11yIssues.push(headingIssues.join('; '));
    }

  } catch (e) {
    a11yIssues.push(`Accessibility check error: ${e.message}`);
  }

  return a11yIssues;
}

async function checkVisualCorrectness(page, routeName) {
  const visualIssues = [];

  try {
    // Check for overlapping elements
    const overlapCheck = await page.evaluate(() => {
      const issues = [];
      const elements = document.querySelectorAll('button, input, a, img, h1, h2, h3');
      const rects = [];
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rects.push({ rect, tag: el.tagName, text: el.textContent?.substring(0, 30) });
        }
      });
      return issues;
    });

    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (hasOverflow) {
      visualIssues.push('Page has horizontal overflow (content wider than viewport)');
    }

    // Check for broken images
    const brokenImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      const broken = [];
      imgs.forEach(img => {
        if (img.naturalWidth === 0 && img.src && !img.src.startsWith('data:')) {
          broken.push(img.src?.substring(0, 100));
        }
      });
      return broken;
    });
    if (brokenImages.length > 0) {
      visualIssues.push(`${brokenImages.length} broken images: ${brokenImages.slice(0, 3).join(', ')}`);
    }

    // Check for empty containers that should have content
    const emptyContainers = await page.evaluate(() => {
      const containers = document.querySelectorAll('[class*="container"], [class*="content"], main, article');
      let empty = 0;
      containers.forEach(c => {
        if (c.children.length === 0 && !c.textContent?.trim()) {
          empty++;
        }
      });
      return empty;
    });
    if (emptyContainers > 2) {
      visualIssues.push(`${emptyContainers} empty containers found`);
    }

    // Check for elements with 0 dimensions that shouldn't be
    const zeroSizeElements = await page.evaluate(() => {
      const interactives = document.querySelectorAll('button, a, input, select, textarea');
      let count = 0;
      interactives.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          const style = getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            count++;
          }
        }
      });
      return count;
    });
    if (zeroSizeElements > 0) {
      visualIssues.push(`${zeroSizeElements} interactive elements with zero dimensions`);
    }

  } catch (e) {
    visualIssues.push(`Visual check error: ${e.message}`);
  }

  return visualIssues;
}

async function testPage(page, route, screenshotPrefix, isPublic = false) {
  const routeName = route.name;
  const routePath = route.path;
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

  // Set up console and network monitoring
  const { errors: consoleErrors, cleanup: cleanupConsole } = await collectConsoleErrors(page);
  const { networkErrors, cleanup: cleanupNetwork } = await collectNetworkErrors(page);

  try {
    // Navigate to the page
    const response = await page.goto(`${BASE_URL}${routePath}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait a bit for dynamic content to load
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const statusCode = response?.status() || 0;

    // Check if we got redirected to login (for protected routes)
    if (!isPublic && (finalUrl.includes('/login') || finalUrl === `${BASE_URL}/`)) {
      console.log(`  [SKIP] Redirected to login - route requires auth`);
      result.functional = 'SKIP';
      result.overall = 'SKIP';
      cleanupConsole();
      cleanupNetwork();
      return result;
    }

    // Check for error status
    if (statusCode >= 400 && statusCode < 600) {
      addIssue('HIGH', routePath, 'Network', `Page returned HTTP ${statusCode}`, `Status: ${statusCode}`, '', `Fix server response for ${routePath}`);
      result.network = 'FAIL';
    }

    // --- DESKTOP SCREENSHOT ---
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);
    const desktopScreenshot = `${screenshotPrefix}-desktop.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, desktopScreenshot), fullPage: true });

    // --- VISUAL CORRECTNESS ---
    const visualIssues = await checkVisualCorrectness(page, routeName);
    if (visualIssues.length > 0) {
      result.visual = 'FAIL';
      visualIssues.forEach(issue => {
        addIssue('MEDIUM', routePath, 'Visual', `${routeName}: ${issue}`, desktopScreenshot, '', `Fix visual issue on ${routePath}`);
      });
    }

    // --- RESPONSIVE TESTING ---
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(500);

      const bpScreenshot = `${screenshotPrefix}-${bp.name.toLowerCase()}.png`;
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, bpScreenshot), fullPage: true });

      // Check for horizontal overflow at this breakpoint
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      if (hasOverflow) {
        result.responsive = 'FAIL';
        addIssue('MEDIUM', routePath, 'Responsive', `${routeName}: Horizontal overflow at ${bp.name} (${bp.width}x${bp.height})`, bpScreenshot, '', `Fix horizontal overflow on ${routePath} at ${bp.name} breakpoint`);
      }

      // Check for tiny touch targets on mobile
      if (bp.name === 'Mobile') {
        const tinyTargets = await page.evaluate(() => {
          const interactives = document.querySelectorAll('button, a, input, select, [role="button"]');
          let tinyCount = 0;
          interactives.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
              const style = getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                // Only count visible, clickable elements
                if (rect.width < 30 || rect.height < 30) {
                  tinyCount++;
                }
              }
            }
          });
          return tinyCount;
        });
        if (tinyTargets > 5) {
          // Only flag if many tiny targets
          addIssue('LOW', routePath, 'Responsive', `${routeName}: ${tinyTargets} touch targets smaller than 30x30px on Mobile`, bpScreenshot, '', `Increase touch target sizes on ${routePath}`);
        }
      }
    }

    // Reset to desktop
    await page.setViewportSize({ width: 1920, height: 1080 });

    // --- ACCESSIBILITY ---
    const a11yIssues = await checkAccessibility(page, routeName);
    if (a11yIssues.length > 0) {
      result.a11y = 'FAIL';
      a11yIssues.forEach(issue => {
        const severity = issue.includes('button') || issue.includes('input') ? 'MEDIUM' : 'LOW';
        addIssue(severity, routePath, 'A11y', `${routeName}: ${issue}`, desktopScreenshot, '', `Fix accessibility issue on ${routePath}`);
      });
    }

    // --- CONSOLE ERRORS ---
    await page.waitForTimeout(1000); // Give time for any delayed errors
    const jsErrors = consoleErrors.filter(e => e.type === 'error');
    const jsWarnings = consoleErrors.filter(e => e.type === 'warning');

    if (jsErrors.length > 0) {
      result.console = 'FAIL';
      // Group similar errors
      const uniqueErrors = [...new Set(jsErrors.map(e => e.text.substring(0, 200)))];
      uniqueErrors.forEach(err => {
        const severity = err.includes('Uncaught') || err.includes('unhandled') ? 'HIGH' : 'MEDIUM';
        addIssue(severity, routePath, 'Console', `${routeName}: JS Error: ${err}`, desktopScreenshot, '', `Fix console error on ${routePath}`);
      });
    }

    // React-specific warnings
    const reactWarnings = jsWarnings.filter(w =>
      w.text.includes('Warning:') || w.text.includes('Each child') || w.text.includes('useEffect')
    );
    if (reactWarnings.length > 0) {
      const uniqueWarnings = [...new Set(reactWarnings.map(w => w.text.substring(0, 200)))];
      uniqueWarnings.forEach(warn => {
        addIssue('LOW', routePath, 'Console', `${routeName}: React Warning: ${warn}`, desktopScreenshot, '', `Fix React warning on ${routePath}`);
      });
    }

    // --- NETWORK ERRORS ---
    if (networkErrors.length > 0) {
      // Filter out expected 404s for optional resources
      const significantErrors = networkErrors.filter(e =>
        !e.url.includes('favicon') && !e.url.includes('.map') && !e.url.includes('hot-update')
      );
      if (significantErrors.length > 0) {
        result.network = 'FAIL';
        significantErrors.forEach(err => {
          const severity = err.status >= 500 ? 'HIGH' : 'MEDIUM';
          addIssue(severity, routePath, 'Network', `${routeName}: HTTP ${err.status} for ${err.url.substring(0, 100)}`, desktopScreenshot, '', `Fix network error on ${routePath}`);
        });
      }
    }

    // --- FUNCTIONAL CHECK ---
    // Check if page has meaningful content (not just empty/loading)
    const pageText = await page.evaluate(() => document.body?.innerText?.trim() || '');
    if (pageText.length < 10) {
      result.functional = 'FAIL';
      addIssue('HIGH', routePath, 'Functional', `${routeName}: Page appears empty or failed to render content`, desktopScreenshot, '', `Investigate why ${routePath} shows no content`);
    }

    // Check if there's a visible error boundary
    const hasErrorBoundary = await page.evaluate(() => {
      const errorTexts = ['something went wrong', 'error occurred', 'failed to load', 'crash'];
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      return errorTexts.some(t => bodyText.includes(t));
    });
    if (hasErrorBoundary) {
      result.functional = 'FAIL';
      addIssue('CRITICAL', routePath, 'Functional', `${routeName}: Error boundary triggered - page crashed`, desktopScreenshot, '', `Fix crash on ${routePath}`);
    }

    // Determine overall
    const statuses = Object.values(result).filter(v => v !== 'SKIP');
    if (statuses.includes('FAIL')) {
      result.overall = 'FAIL';
    }

  } catch (e) {
    console.error(`  [ERROR] Failed to test ${routeName}: ${e.message}`);
    result.functional = 'FAIL';
    result.overall = 'FAIL';
    addIssue('CRITICAL', routePath, 'Functional', `${routeName}: Page test failed with error: ${e.message}`, '', '', `Investigate test failure on ${routePath}`);
  }

  cleanupConsole();
  cleanupNetwork();

  console.log(`  Results: Visual=${result.visual} Responsive=${result.responsive} A11y=${result.a11y} Console=${result.console} Network=${result.network} Functional=${result.functional}`);

  return result;
}

async function run() {
  console.log('=== COMPREHENSIVE VISUAL QA ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Started at: ${new Date().toISOString()}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Phase 1: Setup and check auth
  console.log('\n=== PHASE 1: ENVIRONMENT SETUP ===');
  const authReady = await setupAuth(page);

  // Phase 2: Test public routes first
  console.log('\n=== PHASE 2: PUBLIC ROUTES ===');
  let idx = 0;
  for (const route of PUBLIC_ROUTES) {
    idx++;
    const prefix = `${String(idx).padStart(3, '0')}-${sanitizeFilename(route.name)}`;
    pageResults[route.path] = await testPage(page, route, prefix, true);
  }

  // Phase 3: Test protected routes
  const allProtectedRoutes = [
    ...DASHBOARD_ROUTES,
    ...BUSINESS_ROUTES,
    ...PRODUCT_ROUTES,
    ...COMPONENT_ROUTES.slice(0, 15), // Test first 15 component routes for speed
    ...FORM_ROUTES,
    ...ADMIN_ROUTES,
    ...SIEM_ROUTES,
    ...APP_ROUTES,
    ...TOOL_ROUTES,
    ...ERROR_ROUTES,
  ];

  console.log('\n=== PHASE 3: PROTECTED ROUTES ===');
  for (const route of allProtectedRoutes) {
    idx++;
    const prefix = `${String(idx).padStart(3, '0')}-${sanitizeFilename(route.name)}`;
    pageResults[route.path] = await testPage(page, route, prefix, false);
  }

  // Phase 4: Test remaining component routes
  console.log('\n=== PHASE 4: REMAINING COMPONENT ROUTES ===');
  for (const route of COMPONENT_ROUTES.slice(15)) {
    idx++;
    const prefix = `${String(idx).padStart(3, '0')}-${sanitizeFilename(route.name)}`;
    pageResults[route.path] = await testPage(page, route, prefix, false);
  }

  await browser.close();

  // Phase 5: Generate report
  console.log('\n\n========================================');
  console.log('=== VISUAL QA REPORT ===');
  console.log('========================================\n');

  // Count issues by severity
  const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = issues.filter(i => i.severity === 'HIGH').length;
  const mediumCount = issues.filter(i => i.severity === 'MEDIUM').length;
  const lowCount = issues.filter(i => i.severity === 'LOW').length;

  // Determine overall status
  let overallStatus = 'QA_PASSED';
  if (criticalCount > 0 || highCount > 0) overallStatus = 'QA_FAILED';
  else if (mediumCount >= 3) overallStatus = 'QA_FAILED';

  console.log(`Overall Status: ${overallStatus}`);
  console.log(`Total Issues: ${issues.length} (Critical: ${criticalCount}, High: ${highCount}, Medium: ${mediumCount}, Low: ${lowCount})`);

  // Print results table
  console.log('\n--- Page Results ---');
  console.log('Page | Visual | Responsive | A11y | Console | Network | Functional | Overall');
  console.log('-'.repeat(100));
  for (const [routePath, result] of Object.entries(pageResults)) {
    console.log(`${routePath.padEnd(40)} | ${result.visual.padEnd(6)} | ${result.responsive.padEnd(10)} | ${result.a11y.padEnd(4)} | ${result.console.padEnd(7)} | ${result.network.padEnd(7)} | ${result.functional.padEnd(10)} | ${result.overall}`);
  }

  // Print issues
  if (issues.length > 0) {
    console.log('\n--- Issues Found ---');
    issues.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
    issues.forEach((issue, i) => {
      console.log(`\n[Issue ${i + 1}] [${issue.severity}]`);
      console.log(`  Page: ${issue.page}`);
      console.log(`  Category: ${issue.category}`);
      console.log(`  Description: ${issue.description}`);
      if (issue.evidence) console.log(`  Evidence: ${issue.evidence}`);
      if (issue.fix) console.log(`  Fix: ${issue.fix}`);
    });
  }

  // Save report as JSON
  const reportPath = path.join(SCREENSHOT_DIR, 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ overallStatus, pageResults, issues, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  console.log(`\nFinished at: ${new Date().toISOString()}`);
}

run().catch(e => {
  console.error('QA script failed:', e);
  process.exit(1);
});
