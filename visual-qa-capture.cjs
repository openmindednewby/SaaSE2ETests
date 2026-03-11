const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:4444';
const OUTPUT_DIR = path.join(__dirname, '..', 'visual-qa-screenshots');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'pricing', path: '/pricing' },
  { name: 'dashboard-overview', path: '/dashboard/home/overview' },
  { name: 'dashboard-metrics', path: '/dashboard/home/metrics' },
  { name: 'dashboard-kpis', path: '/dashboard/home/kpis' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

async function capture() {
  const browser = await chromium.launch({ headless: true });

  for (const pg of PAGES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const tab = await context.newPage();

      const consoleErrors = [];
      const consoleWarnings = [];
      tab.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
        if (msg.type() === 'warning') consoleWarnings.push(msg.text());
      });

      try {
        await tab.goto(`${BASE_URL}${pg.path}`, {
          waitUntil: 'networkidle',
          timeout: 15000
        });
        await tab.waitForTimeout(1500);
      } catch (e) {
        console.log(`WARN: ${pg.name} at ${viewport.name} - navigation issue: ${e.message}`);
        try { await tab.waitForTimeout(3000); } catch(_) {}
      }

      const filename = `${pg.name}_${viewport.name}.png`;
      await tab.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage: true
      });
      console.log(`Captured: ${filename}`);

      if (consoleErrors.length > 0) {
        console.log(`  ERRORS on ${pg.name} (${viewport.name}):`);
        consoleErrors.forEach(e => console.log(`    [E] ${e}`));
      }
      if (consoleWarnings.length > 0) {
        console.log(`  WARNINGS on ${pg.name} (${viewport.name}):`);
        consoleWarnings.slice(0, 5).forEach(w => console.log(`    [W] ${w}`));
      }

      await context.close();
    }
  }

  await browser.close();
  console.log('\nAll screenshots captured successfully.');
}

capture().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
