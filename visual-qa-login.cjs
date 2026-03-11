const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:4444';
const OUTPUT_DIR = path.join(__dirname, '..', 'visual-qa-screenshots');

const DASHBOARD_PAGES = [
  { name: 'dashboard-overview', path: '/dashboard/home/overview' },
  { name: 'dashboard-metrics', path: '/dashboard/home/metrics' },
  { name: 'dashboard-kpis', path: '/dashboard/home/kpis' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

async function loginAndCapture() {
  const browser = await chromium.launch({ headless: true });

  // First, login with a full-size viewport
  const loginContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const loginPage = await loginContext.newPage();

  console.log('Navigating to login page...');
  await loginPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await loginPage.waitForTimeout(1000);

  // Fill in credentials and submit
  console.log('Filling in credentials...');
  const usernameInput = loginPage.locator('input[type="text"]').first();
  const passwordInput = loginPage.locator('input[type="password"]').first();

  await usernameInput.clear();
  await usernameInput.fill('admin@example.com');
  await passwordInput.clear();
  await passwordInput.fill('admin123');

  // Click the Admin demo credential button if available
  const adminBtn = loginPage.locator('[data-testid="login-demo-admin"]');
  if (await adminBtn.count() > 0) {
    console.log('Clicking Admin demo credential button...');
    await adminBtn.click();
    await loginPage.waitForTimeout(500);
  }

  // Click login
  console.log('Clicking login...');
  const loginBtn = loginPage.locator('[data-testid="login-submit"]');
  await loginBtn.click();

  // Wait for navigation
  await loginPage.waitForTimeout(3000);
  const afterLoginUrl = loginPage.url();
  console.log(`After login URL: ${afterLoginUrl}`);

  // Save storage state for reuse
  const storageState = await loginContext.storageState();
  console.log(`Cookies: ${storageState.cookies.length}`);
  console.log(`LocalStorage entries: ${storageState.origins.length}`);

  // Take a screenshot to see where we are
  await loginPage.screenshot({
    path: path.join(OUTPUT_DIR, 'after-login.png'),
    fullPage: true
  });
  console.log('Captured: after-login.png');

  // Now capture dashboard pages using the same login session
  for (const pg of DASHBOARD_PAGES) {
    for (const viewport of VIEWPORTS) {
      // Create new context with saved storage state
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        storageState: storageState,
      });
      const tab = await context.newPage();

      const consoleErrors = [];
      tab.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      try {
        await tab.goto(`${BASE_URL}${pg.path}`, {
          waitUntil: 'networkidle',
          timeout: 15000
        });
        await tab.waitForTimeout(2000);
      } catch (e) {
        console.log(`WARN: ${pg.name} at ${viewport.name} - ${e.message}`);
        await tab.waitForTimeout(3000);
      }

      const currentUrl = tab.url();
      if (!currentUrl.includes(pg.path)) {
        console.log(`  REDIRECT: ${pg.name} at ${viewport.name} -> ${currentUrl}`);
      }

      const filename = `${pg.name}_${viewport.name}_auth.png`;
      await tab.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage: true
      });
      console.log(`Captured: ${filename}`);

      if (consoleErrors.length > 0) {
        console.log(`  ERRORS:`);
        consoleErrors.slice(0, 5).forEach(e => console.log(`    [E] ${e}`));
      }

      await context.close();
    }
  }

  await loginContext.close();
  await browser.close();
  console.log('\nDashboard screenshots captured.');
}

loginAndCapture().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
