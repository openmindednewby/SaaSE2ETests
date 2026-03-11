import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:4444';
const OUTPUT_DIR = path.join(__dirname, 'qa-screenshots', 'showcase');

const PAGES = [
  { route: '/components/toolbar/native', name: '01-toolbar-native' },
  { route: '/components/toolbar/syncfusion', name: '02-toolbar-syncfusion' },
  { route: '/components/menu/native', name: '03-menu-native' },
  { route: '/components/menu/syncfusion', name: '04-menu-syncfusion' },
  { route: '/components/accordion/native', name: '05-accordion-native' },
  { route: '/components/accordion/syncfusion', name: '06-accordion-syncfusion' },
  { route: '/components/breadcrumb/native', name: '07-breadcrumb-native' },
  { route: '/components/breadcrumb/syncfusion', name: '08-breadcrumb-syncfusion' },
  { route: '/components/tabs/native', name: '09-tabs-native' },
  { route: '/components/tabs/syncfusion', name: '10-tabs-syncfusion' },
  { route: '/components/timeline/native', name: '11-timeline-native' },
  { route: '/components/timeline/syncfusion', name: '12-timeline-syncfusion' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  
  // The form is pre-filled with demo@example.com / demo123. Just click LOGIN.
  const loginBtn = page.locator('button:has-text("LOGIN")');
  if (await loginBtn.isVisible({ timeout: 3000 })) {
    await loginBtn.click();
    // Wait for navigation to complete
    await page.waitForTimeout(3000);
    console.log(`  Current URL after login: ${page.url()}`);
  } else {
    console.log('  LOGIN button not found, trying form submit...');
    // Try clicking any submit button
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForTimeout(3000);
    console.log(`  Current URL after submit: ${page.url()}`);
  }
}

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = {};
  
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    
    // Login first
    await login(page);
    console.log(`Logged in for ${viewport.name} viewport`);
    
    for (const p of PAGES) {
      const url = `${BASE_URL}${p.route}`;
      const filename = `${p.name}_${viewport.name}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);
      
      // Collect console errors
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });
      
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000); // Wait for animations/renders
        
        await page.screenshot({ 
          path: filepath, 
          fullPage: true,
        });
        
        if (errors.length > 0) {
          consoleErrors[`${p.name}_${viewport.name}`] = errors;
        }
        
        console.log(`OK: ${filename} (url: ${page.url()})`);
      } catch (e) {
        console.log(`FAIL: ${filename} - ${e.message}`);
      }
      
      page.removeAllListeners('console');
    }
    
    await context.close();
  }
  
  // Write console errors report
  if (Object.keys(consoleErrors).length > 0) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'console-errors.json'),
      JSON.stringify(consoleErrors, null, 2)
    );
    console.log('\nConsole errors found - see console-errors.json');
  } else {
    console.log('\nNo console errors found');
  }
  
  await browser.close();
  console.log('\nDone! Screenshots saved to:', OUTPUT_DIR);
}

run().catch(console.error);
