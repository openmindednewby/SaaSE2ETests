const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:4444';
const OUTPUT_DIR = path.join(__dirname, '..', 'visual-qa-screenshots');

async function detailedAnalysis() {
  const browser = await chromium.launch({ headless: true });

  // Login first
  const loginCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const loginPage = await loginCtx.newPage();
  await loginPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await loginPage.waitForTimeout(1000);

  const adminBtn = loginPage.locator('[data-testid="login-demo-admin"]');
  if (await adminBtn.count() > 0) {
    await adminBtn.click();
    await loginPage.waitForTimeout(500);
  }
  await loginPage.locator('[data-testid="login-submit"]').click();
  await loginPage.waitForTimeout(3000);
  const storageState = await loginCtx.storageState();
  await loginCtx.close();

  // 1. Check if Vite error overlay exists on landing page
  console.log('\n=== VITE ERROR OVERLAY CHECK ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    const overlay = await page.evaluate(() => {
      const el = document.querySelector('vite-error-overlay');
      if (!el) return null;
      return {
        visible: el.offsetWidth > 0 || el.offsetHeight > 0,
        zIndex: window.getComputedStyle(el).zIndex,
        display: window.getComputedStyle(el).display,
        html: el.outerHTML.substring(0, 500),
      };
    });
    console.log('Vite error overlay on landing:', overlay ? JSON.stringify(overlay, null, 2) : 'NOT FOUND');
    await ctx.close();
  }

  // 2. Check the landing page hero section for the error display
  console.log('\n=== LANDING PAGE HERO SECTION ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    const heroCheck = await page.evaluate(() => {
      // Check if the hero section has the error code visible
      const body = document.body;
      const text = body.innerText.substring(0, 2000);
      const hasErrorCode = text.includes('plugin:vite:react-babel') || text.includes('FormResult');

      // Find the hero section
      const heroH1 = document.querySelector('h1');
      const heroText = heroH1 ? heroH1.textContent : 'NO H1 FOUND';

      return { hasErrorCode, heroText, firstText: text.substring(0, 500) };
    });
    console.log('Hero check:', JSON.stringify(heroCheck, null, 2));
    await ctx.close();
  }

  // 3. Light mode test on landing page
  console.log('\n=== LIGHT MODE CHECK (LANDING) ===');
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: 'light',
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'landing_desktop_lightmode.png'),
      fullPage: true
    });
    console.log('Captured: landing_desktop_lightmode.png');
    await ctx.close();
  }

  // 4. Check login page for the error overlay visibility
  console.log('\n=== LOGIN PAGE ERROR OVERLAY ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    const overlay = await page.evaluate(() => {
      const el = document.querySelector('vite-error-overlay');
      if (!el) return { exists: false };
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        exists: true,
        visible: rect.width > 0 && rect.height > 0,
        display: style.display,
        zIndex: style.zIndex,
        position: style.position,
        width: rect.width,
        height: rect.height,
      };
    });
    console.log('Login Vite overlay:', JSON.stringify(overlay, null, 2));

    // Check if login form is visible behind the overlay
    const loginFormVisible = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return { formFound: false };
      const rect = form.getBoundingClientRect();
      return {
        formFound: true,
        visible: rect.width > 0 && rect.height > 0,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    });
    console.log('Login form visibility:', JSON.stringify(loginFormVisible, null, 2));
    await ctx.close();
  }

  // 5. Pricing page - check for error overlay blocking content
  console.log('\n=== PRICING PAGE ERROR OVERLAY ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/pricing`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    const overlay = await page.evaluate(() => {
      const el = document.querySelector('vite-error-overlay');
      if (!el) return { exists: false };
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        exists: true,
        visible: rect.width > 0 && rect.height > 0,
        display: style.display,
        zIndex: style.zIndex,
        position: style.position,
        width: rect.width,
        height: rect.height,
      };
    });
    console.log('Pricing Vite overlay:', JSON.stringify(overlay, null, 2));

    // Check if pricing cards/sections are visible
    const pricingContent = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasFree: text.includes('Free'),
        hasPro: text.includes('Pro'),
        hasEnterprise: text.includes('Enterprise'),
        hasComparisonTable: text.includes('Feature Comparison'),
        hasFAQ: text.includes('Frequently Asked'),
        firstVisibleText: text.substring(0, 500),
      };
    });
    console.log('Pricing content:', JSON.stringify(pricingContent, null, 2));
    await ctx.close();
  }

  // 6. Dashboard KPIs - check for missing sparklines
  console.log('\n=== DASHBOARD KPIS - MISSING SPARKLINES CHECK ===');
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      storageState,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/dashboard/home/kpis`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const kpiCheck = await page.evaluate(() => {
      const svgs = document.querySelectorAll('svg');
      const canvases = document.querySelectorAll('canvas');
      const allText = document.body.innerText;

      return {
        svgCount: svgs.length,
        canvasCount: canvases.length,
        hasSparklines: allText.includes('sparkline') || svgs.length > 5 || canvases.length > 0,
        kpiCards: allText.includes('$730,500'),
        pageTitle: allText.includes('Key Performance Indicators'),
        contentHeight: document.body.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });
    console.log('KPI page check:', JSON.stringify(kpiCheck, null, 2));
    await ctx.close();
  }

  // 7. Check the floating Tanstack Query button
  console.log('\n=== FLOATING DEBUG BUTTONS CHECK ===');
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      storageState,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/dashboard/home/overview`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const debugButtons = await page.evaluate(() => {
      // Check for TanStack Query DevTools button
      const tsqdBtn = document.querySelector('.tsqd-open-btn-container');
      const results = {};
      if (tsqdBtn) {
        const rect = tsqdBtn.getBoundingClientRect();
        results.tanstackQuery = {
          found: true,
          position: { top: rect.top, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom },
          zIndex: window.getComputedStyle(tsqdBtn).zIndex,
        };
      }

      // Check for any floating elements at corners
      const allElements = document.querySelectorAll('*');
      const floatingCornerElements = [];
      allElements.forEach(el => {
        const cs = window.getComputedStyle(el);
        if (cs.position === 'fixed' && parseInt(cs.zIndex) > 1000) {
          const rect = el.getBoundingClientRect();
          floatingCornerElements.push({
            tag: el.tagName,
            class: el.className?.substring?.(0, 80),
            zIndex: cs.zIndex,
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          });
        }
      });
      results.floatingElements = floatingCornerElements;

      return results;
    });
    console.log('Debug buttons:', JSON.stringify(debugButtons, null, 2));
    await ctx.close();
  }

  // 8. Landing page navigation check
  console.log('\n=== LANDING PAGE NAVIGATION ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    const navCheck = await page.evaluate(() => {
      const header = document.querySelector('header') || document.querySelector('nav');
      const footer = document.querySelector('footer');
      const links = document.querySelectorAll('a');
      const navLinks = [];
      links.forEach(a => {
        const href = a.getAttribute('href');
        const text = a.textContent?.trim();
        if (text && href) navLinks.push({ text, href });
      });

      return {
        hasHeader: !!header,
        hasFooter: !!footer,
        navLinks: navLinks.slice(0, 20),
      };
    });
    console.log('Navigation:', JSON.stringify(navCheck, null, 2));
    await ctx.close();
  }

  await browser.close();
  console.log('\nDetailed analysis complete.');
}

detailedAnalysis().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
