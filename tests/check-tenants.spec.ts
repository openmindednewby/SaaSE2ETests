import { test } from '@playwright/test';
import { TenantsPage } from '../pages/TenantsPage.js';

test('check tenants', async ({ page }) => {
  test.skip(true, 'Debug-only test (enable manually when needed)');
  const tenantsPage = new TenantsPage(page);
  await tenantsPage.goto();
  
  await page.waitForTimeout(3000);
  const bodyText = await page.innerText('body');
  console.log('--- BODY TEXT START ---');
  console.log(bodyText);
  console.log('--- BODY TEXT END ---');
  
  const names = await tenantsPage.getTenantNames();
  console.log('--- TENANT NAMES ---');
  console.log(names);
});
