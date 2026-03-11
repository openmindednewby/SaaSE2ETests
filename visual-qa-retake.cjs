const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:4444';
const OUTPUT_DIR = path.join(__dirname, '..', 'visual-qa-screenshots');

const PAGES = [
  { name: 'landing', path: '/', auth: false },
  { name: 'login', path: '/login', auth: false },
  { name: 'pricing', path: '/pricing', auth: false },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

async function retake() {
  const browser = await chromium.launch({ headless: true });

  for (const pg of PAGES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const tab = await context.newPage();

      const consoleErrors = [];
      tab.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const failedRequests = [];
      tab.on('response', response => {
        if (response.status() >= 400) {
          failedRequests.push({ url: response.url(), status: response.status() });
        }
      });

      try {
        await tab.goto(`${BASE_URL}${pg.path}`, {
          waitUntil: 'networkidle',
          timeout: 15000
        });
        await tab.waitForTimeout(1500);
      } catch (e) {
        console.log(`WARN: ${pg.name} at ${viewport.name}: ${e.message}`);
        await tab.waitForTimeout(3000);
      }

      const filename = `${pg.name}_${viewport.name}_v2.png`;
      await tab.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage: true
      });
      console.log(`Captured: ${filename}`);

      if (consoleErrors.length > 0) {
        console.log(`  Console errors:`);
        consoleErrors.forEach(e => console.log(`    [E] ${e}`));
      }
      if (failedRequests.length > 0) {
        console.log(`  Failed requests:`);
        failedRequests.forEach(r => console.log(`    [${r.status}] ${r.url}`));
      }

      // Check for vite error overlay
      const hasOverlay = await tab.evaluate(() => {
        const el = document.querySelector('vite-error-overlay');
        return el ? 'PRESENT' : 'none';
      });
      if (hasOverlay !== 'none') {
        console.log(`  VITE ERROR OVERLAY: ${hasOverlay}`);
      }

      await context.close();
    }
  }

  await browser.close();
  console.log('\nRetake complete.');
}

retake().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
