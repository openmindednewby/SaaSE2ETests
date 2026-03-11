/**
 * Comprehensive UX & Styling Audit Script
 * Captures screenshots at all breakpoints for every major page.
 * Performs detailed DOM analysis for styling/UX issues.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4444';
const SCREENSHOT_DIR = path.resolve('qa-screenshots/ux-audit');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// All major pages to audit
const PAGES = [
  // Public pages
  { name: '00-landing', path: '/', auth: false },
  { name: '01-login', path: '/login', auth: false },
  { name: '02-pricing', path: '/pricing', auth: false },
  // Dashboard
  { name: '03-dashboard', path: '/dashboard', auth: true },
  { name: '04-dashboard-metrics', path: '/dashboard/home/metrics', auth: true },
  { name: '05-dashboard-kpis', path: '/dashboard/home/kpis', auth: true },
  // Business pages
  { name: '06-customers', path: '/customers', auth: true },
  { name: '07-invoices', path: '/invoices', auth: true },
  { name: '08-orders', path: '/orders', auth: true },
  { name: '09-inventory', path: '/inventory', auth: true },
  // Products
  { name: '10-products-native', path: '/products/native', auth: true },
  { name: '11-products-syncfusion', path: '/products/syncfusion', auth: true },
  // Components showcase
  { name: '12-components-native', path: '/components/native', auth: true },
  { name: '13-components-syncfusion', path: '/components/syncfusion', auth: true },
  // Grids
  { name: '14-grid-native', path: '/components/grid/native', auth: true },
  { name: '15-grid-syncfusion', path: '/components/grid/syncfusion', auth: true },
  { name: '16-grid-playground', path: '/components/grid/playground', auth: true },
  // Forms
  { name: '17-forms-syncfusion', path: '/forms/syncfusion', auth: true },
  { name: '18-forms-native', path: '/forms/native', auth: true },
  // Admin
  { name: '19-admin-users', path: '/admin/user-management', auth: true },
  { name: '20-admin-roles', path: '/admin/role-management', auth: true },
  { name: '21-admin-theme', path: '/admin/theme-editor', auth: true },
  { name: '22-admin-settings', path: '/admin/system-settings', auth: true },
  { name: '23-admin-integrations', path: '/admin/integrations', auth: true },
  { name: '24-admin-plugins', path: '/admin/plugins', auth: true },
  { name: '25-admin-docs', path: '/admin/documentation', auth: true },
  { name: '26-admin-support', path: '/admin/support', auth: true },
  // SIEM
  { name: '27-alerts-mgmt', path: '/alerts-incidents/alerts-management', auth: true },
  { name: '28-incidents-mgmt', path: '/alerts-incidents/incidents-management', auth: true },
  { name: '29-marketplace', path: '/marketplace', auth: true },
  // App pages
  { name: '30-notifications', path: '/notifications', auth: true },
  { name: '31-profile', path: '/profile', auth: true },
  { name: '32-activity-log', path: '/activity-log', auth: true },
  { name: '33-settings', path: '/settings', auth: true },
  // Productivity
  { name: '34-calendar', path: '/calendar', auth: true },
  { name: '35-kanban', path: '/kanban', auth: true },
  { name: '36-gantt', path: '/gantt', auth: true },
  { name: '37-editor', path: '/editor', auth: true },
  { name: '38-file-manager', path: '/file-manager', auth: true },
  { name: '39-chat', path: '/chat', auth: true },
  { name: '40-maps', path: '/maps', auth: true },
  { name: '41-spreadsheet', path: '/spreadsheet', auth: true },
  { name: '42-diagram', path: '/diagram', auth: true },
  // Error pages
  { name: '43-error-401', path: '/errors/401', auth: true },
  { name: '44-error-403', path: '/errors/403', auth: true },
  { name: '45-error-500', path: '/errors/500', auth: true },
];

const BREAKPOINTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

async function login(page) {
  console.log('Logging in...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const adminButton = await page.$('button:has-text("Admin"), [data-testid*="admin" i], button:has-text("admin")');
  if (adminButton) {
    await adminButton.click();
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl === `${BASE_URL}/`) {
      const loginButton = await page.$('button:has-text("LOGIN"), button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]');
      if (loginButton) {
        await loginButton.click();
        await page.waitForTimeout(5000);
      }
    }
  }
  const isLoggedIn = !page.url().includes('/login');
  console.log(`Authenticated: ${isLoggedIn}`);
  return isLoggedIn;
}

async function analyzePage(page, pageConfig) {
  const result = {
    name: pageConfig.name,
    path: pageConfig.path,
    consoleErrors: [],
    consoleWarnings: [],
    screenshots: {},
  };

  const consoleHandler = (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('__vite') && !text.includes('favicon')) {
      result.consoleErrors.push(text.substring(0, 300));
    }
    if (msg.type() === 'warning') {
      result.consoleWarnings.push(text.substring(0, 300));
    }
  };
  page.on('console', consoleHandler);

  try {
    await page.goto(`${BASE_URL}${pageConfig.path}`, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    result.error = e.message;
    page.off('console', consoleHandler);
    return result;
  }

  await page.waitForTimeout(3000);

  // Take screenshots at all breakpoints
  for (const bp of BREAKPOINTS) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(1000);
    const filename = `${pageConfig.name}_${bp.name}.png`;
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, filename),
      fullPage: true,
    });
    result.screenshots[bp.name] = filename;
  }

  // Reset to desktop
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);

  // Detailed UX/styling analysis
  result.analysis = await page.evaluate(() => {
    const a = {
      url: window.location.href,
      title: document.title,
      bodyText: document.body.innerText.substring(0, 2000),
      totalElements: document.querySelectorAll('*').length,
      headings: [],
      buttons: { total: 0, withoutHover: 0, withoutFocus: 0, small: 0, details: [] },
      inputs: { total: 0, withoutLabels: 0, details: [] },
      links: { total: 0, withoutHoverEffect: 0 },
      cards: { total: 0, withoutShadow: 0, withoutRadius: 0 },
      spacing: { inconsistent: [] },
      fontSizes: [],
      colors: { bg: [], text: [], borders: [] },
      overflow: [],
      emptyStates: false,
      missingTransitions: 0,
      touchTargets: { tooSmall: [] },
      images: { total: 0, withoutAlt: 0 },
      darkMode: document.documentElement.classList.contains('dark'),
      hasSidebar: !!document.querySelector('nav, aside, [class*="sidebar"]'),
      hasHeader: !!document.querySelector('header, [class*="header"]'),
    };

    // Headings
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      a.headings.push({ level: h.tagName, text: h.textContent.trim().substring(0, 80) });
    });

    // Buttons analysis
    document.querySelectorAll('button, [role="button"]').forEach(btn => {
      a.buttons.total++;
      const style = window.getComputedStyle(btn);
      const rect = btn.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        a.buttons.small++;
        a.touchTargets.tooSmall.push({
          text: (btn.textContent || btn.getAttribute('aria-label') || '').trim().substring(0, 50),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
      if (!style.transition || style.transition === 'all 0s ease 0s' || style.transition === 'none 0s ease 0s') {
        a.missingTransitions++;
      }
    });

    // Inputs without labels
    document.querySelectorAll('input, select, textarea').forEach(input => {
      a.inputs.total++;
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const hasPlaceholder = input.placeholder;
      if (!hasLabel && !hasAriaLabel && !hasPlaceholder) {
        a.inputs.withoutLabels++;
      }
    });

    // Cards without shadow/radius
    document.querySelectorAll('[class*="card"], [class*="Card"], [class*="panel"], [class*="Panel"]').forEach(card => {
      a.cards.total++;
      const style = window.getComputedStyle(card);
      if (style.boxShadow === 'none') a.cards.withoutShadow++;
      if (style.borderRadius === '0px') a.cards.withoutRadius++;
    });

    // Font sizes used
    const fontSizeSet = new Set();
    document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, button, a, label, td, th, li, div').forEach(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && el.textContent.trim()) {
        fontSizeSet.add(style.fontSize);
      }
    });
    a.fontSizes = [...fontSizeSet].sort();

    // Color analysis
    const bgSet = new Set(), textSet = new Set(), borderSet = new Set();
    document.querySelectorAll('div, section, main, aside, nav, header, footer, [class*="card"]').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') bgSet.add(style.backgroundColor);
      if (style.borderColor !== 'rgb(0, 0, 0)' && style.borderWidth !== '0px') borderSet.add(style.borderColor);
    });
    document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a, button, label').forEach(el => {
      const style = window.getComputedStyle(el);
      if (el.textContent.trim()) textSet.add(style.color);
    });
    a.colors.bg = [...bgSet].slice(0, 20);
    a.colors.text = [...textSet].slice(0, 20);
    a.colors.borders = [...borderSet].slice(0, 20);

    // Overflow check
    const vw = window.innerWidth;
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 10 && rect.width > 20) {
        a.overflow.push({
          tag: el.tagName,
          className: (el.className?.toString() || '').substring(0, 80),
          overflowBy: Math.round(rect.right - vw),
        });
      }
    });
    a.overflow = a.overflow.slice(0, 10);

    // Images
    document.querySelectorAll('img').forEach(img => {
      a.images.total++;
      if (!img.alt && !img.getAttribute('aria-label')) a.images.withoutAlt++;
    });

    // Check for empty state patterns
    const bodyText = document.body.innerText.toLowerCase();
    a.emptyStates = bodyText.includes('no data') || bodyText.includes('no results') ||
                    bodyText.includes('nothing here') || bodyText.includes('empty');

    return a;
  });

  // Check hover/focus states with CSS analysis
  result.cssAnalysis = await page.evaluate(() => {
    const sheets = document.styleSheets;
    let hoverRules = 0;
    let focusRules = 0;
    let transitionRules = 0;
    let animationRules = 0;

    try {
      for (const sheet of sheets) {
        try {
          for (const rule of sheet.cssRules) {
            const text = rule.selectorText || '';
            if (text.includes(':hover')) hoverRules++;
            if (text.includes(':focus')) focusRules++;
            if (rule.cssText?.includes('transition')) transitionRules++;
            if (rule.cssText?.includes('animation')) animationRules++;
          }
        } catch (e) { /* cross-origin sheets */ }
      }
    } catch (e) {}

    return { hoverRules, focusRules, transitionRules, animationRules };
  });

  page.off('console', consoleHandler);
  return result;
}

async function main() {
  console.log('=== Comprehensive UX & Styling Audit ===');
  console.log(`Testing ${PAGES.length} pages at ${BASE_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const page = await context.newPage();
  const allResults = {};

  // Test public pages first
  for (const pageConfig of PAGES.filter(p => !p.auth)) {
    console.log(`Testing: ${pageConfig.name} (${pageConfig.path})`);
    allResults[pageConfig.name] = await analyzePage(page, pageConfig);
    console.log(`  Done - ${allResults[pageConfig.name].consoleErrors.length} errors`);
  }

  // Login for authenticated pages
  const isAuth = await login(page);
  if (!isAuth) {
    console.log('WARNING: Authentication failed!');
  }

  // Test authenticated pages
  for (const pageConfig of PAGES.filter(p => p.auth)) {
    console.log(`Testing: ${pageConfig.name} (${pageConfig.path})`);
    allResults[pageConfig.name] = await analyzePage(page, pageConfig);
    const r = allResults[pageConfig.name];
    console.log(`  Done - errors:${r.consoleErrors.length} btns:${r.analysis?.buttons?.total || 0} inputs:${r.analysis?.inputs?.total || 0} overflow:${r.analysis?.overflow?.length || 0}`);
  }

  // Also test in light mode for a few key pages
  console.log('\n--- Light Mode Tests ---');
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('mode-storage', JSON.stringify({ state: { mode: 'light' } }));
  });
  await page.waitForTimeout(500);

  const lightModePages = [
    { name: 'light-dashboard', path: '/dashboard' },
    { name: 'light-customers', path: '/customers' },
    { name: 'light-forms', path: '/forms/syncfusion' },
    { name: 'light-grid', path: '/components/grid/syncfusion' },
    { name: 'light-marketplace', path: '/marketplace' },
  ];

  for (const lp of lightModePages) {
    console.log(`Testing light mode: ${lp.name}`);
    await page.goto(`${BASE_URL}${lp.path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${lp.name}_desktop.png`),
      fullPage: true,
    });
  }

  // Write results
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'ux-audit-results.json'),
    JSON.stringify(allResults, null, 2)
  );

  await browser.close();
  console.log(`\nAudit complete! Screenshots in: ${SCREENSHOT_DIR}`);
  console.log(`Results in: ${SCREENSHOT_DIR}/ux-audit-results.json`);
}

main().catch(console.error);
