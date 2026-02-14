import { test } from '@playwright/test';
import { TenantsPage } from '../pages/TenantsPage.js';

test('check tenants', async ({ page }) => {
  test.skip(true, 'Debug-only test (enable manually when needed)');
  const tenantsPage = new TenantsPage(page);
  await tenantsPage.goto();

  await page.waitForLoadState('domcontentloaded');
  const _bodyText = await page.innerText('body');

  const _names = await tenantsPage.getTenantNames();
});
