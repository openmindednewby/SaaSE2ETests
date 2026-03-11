/**
 * Targeted console error and network error collection for specific pages.
 */
import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:4444';

const PAGES_WITH_ISSUES = [
  '/dashboard/home/overview',
  '/chat',
  '/components/externallink/native',
  '/pricing',
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Login first
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const adminBtn = await page.$('[data-testid="login-demo-admin"]');
  if (adminBtn) await adminBtn.click();
  await page.waitForTimeout(1000);
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) await submitBtn.click();
  await page.waitForTimeout(3000);

  for (const routePath of PAGES_WITH_ISSUES) {
    console.log(`\n=== Testing: ${routePath} ===`);

    const consoleMessages = [];
    const handler = (msg) => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location ? `${msg.location().url}:${msg.location().lineNumber}` : '',
      });
    };
    page.on('console', handler);

    const networkErrors = [];
    const netHandler = (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.includes('__vite') && !url.includes('hot-update')) {
        networkErrors.push({ status, url: url.substring(0, 200) });
      }
    };
    page.on('response', netHandler);

    await page.goto(`${BASE_URL}${routePath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    page.off('console', handler);
    page.off('response', netHandler);

    // Print errors
    const errors = consoleMessages.filter(m => m.type === 'error');
    const warnings = consoleMessages.filter(m => m.type === 'warning');

    if (errors.length > 0) {
      console.log(`  CONSOLE ERRORS (${errors.length}):`);
      errors.forEach(e => {
        console.log(`    [ERROR] ${e.text.substring(0, 500)}`);
        if (e.location) console.log(`      at ${e.location}`);
      });
    } else {
      console.log('  No console errors');
    }

    if (warnings.length > 0) {
      console.log(`  WARNINGS (${warnings.length}):`);
      warnings.forEach(w => {
        console.log(`    [WARN] ${w.text.substring(0, 300)}`);
      });
    }

    if (networkErrors.length > 0) {
      console.log(`  NETWORK ERRORS (${networkErrors.length}):`);
      networkErrors.forEach(e => {
        console.log(`    [${e.status}] ${e.url}`);
      });
    } else {
      console.log('  No network errors');
    }
  }

  await browser.close();
  console.log('\nDone.');
}

run().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
