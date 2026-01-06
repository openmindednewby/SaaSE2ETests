import { chromium, FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { LoginPage } from '../pages/LoginPage.js';
import { TenantsPage } from '../pages/TenantsPage.js';
import { UsersPage } from '../pages/UsersPage.js';

/**
 * Multi-tenant test teardown
 * 
 * Cleans up:
 * - All e2e-* users
 * - All e2e-* tenants
 */

const setupStateFile = path.resolve(__dirname, '../playwright/.auth/multi-tenant-setup.json');

async function globalTeardown(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || process.env.BASE_URL || 'http://localhost:8082';
  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;

  // Skip cleanup if no credentials
  if (!username || !password) {
    console.log('⏭️ Skipping cleanup: no credentials configured');
    return;
  }

  // Check if setup was run
  if (!fs.existsSync(setupStateFile)) {
    console.log('⏭️ Skipping cleanup: no setup state found');
    return;
  }

  let setupState;
  try {
    setupState = JSON.parse(fs.readFileSync(setupStateFile, 'utf-8'));
  } catch {
    console.log('⏭️ Skipping cleanup: invalid setup state file');
    return;
  }

  console.log('🧹 Starting multi-tenant cleanup...');

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    // Navigate and login
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWait(username, password);
    console.log('✅ Logged in as super user');

    // Delete users first
    const usersPage = new UsersPage(page);
    await usersPage.goto();

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Delete each test user
    for (const username of setupState.users || []) {
      try {
        if (await usersPage.userExists(username)) {
          console.log(`🗑️ Deleting user: ${username}`);
          await usersPage.deleteUser(username);
          console.log(`✅ Deleted user: ${username}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to delete user ${username}: ${error.message}`);
      }
    }

    // Delete tenants
    const tenantsPage = new TenantsPage(page);
    await tenantsPage.goto();

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Delete each test tenant
    for (const tenantName of setupState.tenants || []) {
      try {
        if (await tenantsPage.tenantExists(tenantName)) {
          console.log(`🗑️ Deleting tenant: ${tenantName}`);
          await tenantsPage.deleteTenant(tenantName);
          await page.waitForTimeout(500);
          console.log(`✅ Deleted tenant: ${tenantName}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to delete tenant ${tenantName}: ${error.message}`);
      }
    }

    // Remove setup state file
    fs.unlinkSync(setupStateFile);
    console.log('✅ Multi-tenant cleanup complete!');

  } catch (error: any) {
    console.error('❌ Cleanup failed:', error.message);
  } finally {
    await browser.close();
  }
}

export default globalTeardown;
